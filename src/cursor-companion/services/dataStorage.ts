import * as vscode from 'vscode';
import * as path from 'path';
import { IDataStorage } from './interfaces';
import { Conversation } from '../models/conversation';
import { Message } from '../models/message';
import { ConversationFilter, MessageFilter } from '../models/common';
import { StorageError, DataIntegrityError } from '../models/errors';
import { SnapshotCollection } from '../models/fileSnapshot';
import { SerializationUtil } from '../utils/serialization';
import { DataMigration, MigrationResult } from '../utils/dataMigration';
import { ErrorCategory } from '../models/errors';
import { 
  verifySnapshotIntegrity, 
  detectConversationCorruption, 
  repairConversation,
  verifyDataConsistency,
  safeParseAndValidate,
  assertDataValidity
} from '../utils/dataIntegrity';
import { validateConversation, validateMessage } from '../models/validation';
import { DATA_INTEGRITY } from '../utils/constants';

/**
 * Local file-based storage implementation for conversation data
 */
export class DataStorage implements IDataStorage {
  private readonly storageRoot: string;
  private readonly conversationsDir: string;
  private readonly messagesDir: string;
  private readonly snapshotsDir: string;
  private readonly backupsDir: string;

  constructor(private context: vscode.ExtensionContext) {
    this.storageRoot = path.join(context.globalStorageUri.fsPath, 'cursor-companion');
    this.conversationsDir = path.join(this.storageRoot, 'conversations');
    this.messagesDir = path.join(this.storageRoot, 'messages');
    this.snapshotsDir = path.join(this.storageRoot, 'snapshots');
    this.backupsDir = path.join(this.storageRoot, 'backups');
  }

  async initialize(): Promise<void> {
    try {
      // Create storage directories
      await this.ensureDirectoryExists(this.storageRoot);
      await this.ensureDirectoryExists(this.conversationsDir);
      await this.ensureDirectoryExists(this.messagesDir);
      await this.ensureDirectoryExists(this.snapshotsDir);
      await this.ensureDirectoryExists(this.backupsDir);

      console.log('Cursor Companion: Data storage initialized');
    } catch (error) {
      throw new Error(`Failed to initialize data storage: ${error}`);
    }
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    try {
      // Validate conversation data before saving
      assertDataValidity(
        conversation, 
        validateConversation, 
        `Invalid conversation data for ${conversation.id}`
      );
      
      // Check for data corruption
      const corruptionResult = detectConversationCorruption(conversation);
      if (corruptionResult.isCorrupted) {
        if (corruptionResult.canRepair && DATA_INTEGRITY.AUTO_REPAIR_MINOR_ISSUES) {
          // Auto-repair minor issues
          const repairResult = await this.repairConversationData(conversation);
          if (!repairResult.success) {
            throw new DataIntegrityError(
              `Failed to repair corrupted conversation ${conversation.id}`,
              { errors: repairResult.errors }
            );
          }
        } else {
          throw new DataIntegrityError(
            `Cannot save corrupted conversation ${conversation.id}`,
            { corruptedFields: corruptionResult.corruptedFields }
          );
        }
      }
      
      // Check data consistency
      const consistencyResult = verifyDataConsistency(conversation);
      if (!consistencyResult.isValid) {
        throw new DataIntegrityError(
          `Data consistency issues in conversation ${conversation.id}`,
          { errors: consistencyResult.errors }
        );
      }
      
      const filePath = path.join(this.conversationsDir, `${conversation.id}.json`);
      const data = SerializationUtil.serializeConversation(conversation, { prettyPrint: true });
      await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), Buffer.from(data, 'utf8'));
    } catch (error) {
      throw new StorageError(`Failed to save conversation ${conversation.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getConversations(filter?: ConversationFilter): Promise<Conversation[]> {
    try {
      const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(this.conversationsDir));
      const conversations: Conversation[] = [];

      for (const [fileName] of files) {
        if (fileName.endsWith('.json')) {
          try {
            const filePath = path.join(this.conversationsDir, fileName);
            const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
            const conversation = SerializationUtil.deserializeConversation(data.toString(), {
              autoMigrate: true,
              validate: false // Skip validation for bulk loading
            });
            
            if (this.matchesFilter(conversation, filter)) {
              conversations.push(conversation);
            }
          } catch (error) {
            console.warn(`Failed to load conversation from ${fileName}:`, error);
          }
        }
      }

      // Sort by timestamp (newest first)
      return conversations.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      throw new StorageError(`Failed to get conversations: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getConversation(id: string): Promise<Conversation | null> {
    try {
      const filePath = path.join(this.conversationsDir, `${id}.json`);
      const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      return SerializationUtil.deserializeConversation(data.toString(), { 
        autoMigrate: true,
        validate: true 
      });
    } catch (error) {
      if (error instanceof StorageError) {
        console.error(`Error deserializing conversation ${id}:`, error);
      }
      // File not found or parse error
      return null;
    }
  }

  async deleteConversation(id: string): Promise<void> {
    try {
      const filePath = path.join(this.conversationsDir, `${id}.json`);
      await vscode.workspace.fs.delete(vscode.Uri.file(filePath));
      
      // Also delete associated messages and snapshots
      await this.deleteConversationMessages(id);
      await this.deleteConversationSnapshots(id);
    } catch (error) {
      throw new Error(`Failed to delete conversation ${id}: ${error}`);
    }
  }

  async archiveConversation(id: string): Promise<void> {
    try {
      const conversation = await this.getConversation(id);
      if (conversation) {
        conversation.status = 'archived';
        await this.saveConversation(conversation);
      }
    } catch (error) {
      throw new Error(`Failed to archive conversation ${id}: ${error}`);
    }
  }

  async saveMessage(message: Message): Promise<void> {
    try {
      // Validate message data before saving
      assertDataValidity(
        message, 
        validateMessage, 
        `Invalid message data for ${message.id}`
      );
      
      // Check for data corruption
      const corruptionResult = detectMessageCorruption(message);
      if (corruptionResult.isCorrupted) {
        throw new DataIntegrityError(
          `Cannot save corrupted message ${message.id}`,
          { corruptedFields: corruptionResult.corruptedFields }
        );
      }
      
      // Verify snapshot integrity if present
      if (Array.isArray(message.snapshot) && message.snapshot.length > 0) {
        for (const snapshot of message.snapshot) {
          const integrityResult = verifySnapshotIntegrity(snapshot);
          if (!integrityResult.isValid) {
            throw new DataIntegrityError(
              `Snapshot integrity issues in message ${message.id}`,
              { errors: integrityResult.errors }
            );
          }
        }
      }
      
      const filePath = path.join(this.messagesDir, `${message.id}.json`);
      const data = SerializationUtil.serializeMessage(message, { prettyPrint: true });
      await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), Buffer.from(data, 'utf8'));
    } catch (error) {
      throw new StorageError(`Failed to save message ${message.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getMessages(conversationId: string, filter?: MessageFilter): Promise<Message[]> {
    try {
      const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(this.messagesDir));
      const messages: Message[] = [];

      for (const [fileName] of files) {
        if (fileName.endsWith('.json')) {
          try {
            const filePath = path.join(this.messagesDir, fileName);
            const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
            const message = SerializationUtil.deserializeMessage(data.toString(), {
              autoMigrate: true,
              validate: false // Skip validation for bulk loading
            });
            
            if (message.conversationId === conversationId && this.matchesMessageFilter(message, filter)) {
              messages.push(message);
            }
          } catch (error) {
            console.warn(`Failed to load message from ${fileName}:`, error);
          }
        }
      }

      // Sort by timestamp (oldest first)
      return messages.sort((a, b) => a.timestamp - b.timestamp);
    } catch (error) {
      throw new StorageError(`Failed to get messages for conversation ${conversationId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getMessage(id: string): Promise<Message | null> {
    try {
      const filePath = path.join(this.messagesDir, `${id}.json`);
      const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      return SerializationUtil.deserializeMessage(data.toString(), { 
        autoMigrate: true,
        validate: true 
      });
    } catch (error) {
      if (error instanceof StorageError) {
        console.error(`Error deserializing message ${id}:`, error);
      }
      return null;
    }
  }

  async saveSnapshot(snapshot: SnapshotCollection): Promise<void> {
    try {
      // Verify snapshot collection integrity
      if (!snapshot.id || typeof snapshot.id !== 'string' || snapshot.id.trim() === '') {
        throw new DataIntegrityError('Snapshot ID is required');
      }
      
      if (!snapshot.messageId || typeof snapshot.messageId !== 'string' || snapshot.messageId.trim() === '') {
        throw new DataIntegrityError('Message ID is required for snapshot');
      }
      
      if (!Array.isArray(snapshot.snapshots)) {
        throw new DataIntegrityError('Snapshots must be an array');
      }
      
      // Verify each snapshot in the collection
      for (const fileSnapshot of snapshot.snapshots) {
        const integrityResult = verifySnapshotIntegrity(fileSnapshot);
        if (!integrityResult.isValid) {
          throw new DataIntegrityError(
            `Snapshot integrity issues for file ${fileSnapshot.filePath}`,
            { errors: integrityResult.errors }
          );
        }
      }
      
      const filePath = path.join(this.snapshotsDir, `${snapshot.id}.json`);
      const data = SerializationUtil.serializeSnapshot(snapshot, { prettyPrint: true });
      await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), Buffer.from(data, 'utf8'));
    } catch (error) {
      throw new StorageError(`Failed to save snapshot ${snapshot.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getSnapshot(messageId: string): Promise<SnapshotCollection | null> {
    try {
      const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(this.snapshotsDir));
      
      for (const [fileName] of files) {
        if (fileName.endsWith('.json')) {
          try {
            const filePath = path.join(this.snapshotsDir, fileName);
            const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
            const snapshot = SerializationUtil.deserializeSnapshot(data.toString(), {
              autoMigrate: true,
              validate: true
            });
            
            if (snapshot.messageId === messageId) {
              return snapshot;
            }
          } catch (error) {
            console.warn(`Failed to load snapshot from ${fileName}:`, error);
          }
        }
      }
      
      return null;
    } catch (error) {
      throw new StorageError(`Failed to get snapshot for message ${messageId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async cleanup(olderThanDays: number): Promise<void> {
    const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    
    try {
      // Clean up old conversations
      await this.cleanupDirectory(this.conversationsDir, cutoffTime);
      await this.cleanupDirectory(this.messagesDir, cutoffTime);
      await this.cleanupDirectory(this.snapshotsDir, cutoffTime);
      await this.cleanupDirectory(this.backupsDir, cutoffTime);
    } catch (error) {
      throw new StorageError(`Failed to cleanup old data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Verify data integrity of all stored conversations
   * 
   * @returns Integrity check results
   */
  async verifyDataIntegrity(): Promise<{
    totalChecked: number;
    corruptedItems: number;
    errors: Error[];
  }> {
    const result = {
      totalChecked: 0,
      corruptedItems: 0,
      errors: [] as Error[]
    };
    
    try {
      // Check conversations
      const conversations = await this.getConversations();
      result.totalChecked += conversations.length;
      
      for (const conversation of conversations) {
        try {
          // Verify conversation data
          const corruptionResult = detectConversationCorruption(conversation);
          if (corruptionResult.isCorrupted) {
            result.corruptedItems++;
            
            // Auto-repair if enabled and possible
            if (DATA_INTEGRITY.AUTO_REPAIR_MINOR_ISSUES && corruptionResult.canRepair) {
              await this.repairConversationData(conversation);
            }
          }
          
          // Verify data consistency
          const consistencyResult = verifyDataConsistency(conversation);
          if (!consistencyResult.isValid) {
            result.corruptedItems++;
            result.errors.push(
              new DataIntegrityError(
                `Data consistency issues in conversation ${conversation.id}`,
                { errors: consistencyResult.errors }
              )
            );
          }
        } catch (error) {
          result.errors.push(error instanceof Error ? error : new Error(String(error)));
        }
      }
      
      // Check snapshots
      const snapshotFiles = await vscode.workspace.fs.readDirectory(vscode.Uri.file(this.snapshotsDir));
      for (const [fileName] of snapshotFiles) {
        if (fileName.endsWith('.json')) {
          try {
            const filePath = path.join(this.snapshotsDir, fileName);
            const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
            const snapshot = SerializationUtil.deserializeSnapshot(data.toString(), {
              autoMigrate: false,
              validate: true
            });
            
            result.totalChecked++;
            
            // Verify snapshot integrity
            for (const fileSnapshot of snapshot.snapshots) {
              const integrityResult = verifySnapshotIntegrity(fileSnapshot);
              if (!integrityResult.isValid) {
                result.corruptedItems++;
                result.errors.push(
                  new DataIntegrityError(
                    `Snapshot integrity issues in ${fileSnapshot.filePath}`,
                    { errors: integrityResult.errors }
                  )
                );
              }
            }
          } catch (error) {
            result.errors.push(error instanceof Error ? error : new Error(String(error)));
          }
        }
      }
      
      return result;
    } catch (error) {
      throw new DataIntegrityError(
        `Failed to verify data integrity: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  
  /**
   * Repair corrupted conversation data
   * 
   * @param conversation The conversation to repair
   * @returns Repair result
   */
  async repairConversationData(conversation: Conversation): Promise<{
    success: boolean;
    repairedFields: string[];
    errors: Error[];
  }> {
    try {
      // Create backup before repair if enabled
      if (DATA_INTEGRITY.CREATE_BACKUP_BEFORE_REPAIR) {
        await this.createBackup(conversation.id);
      }
      
      // Attempt to repair the conversation
      const repairResult = repairConversation(conversation, {
        generateMissingIds: false, // Don't generate new IDs
        setDefaultValues: true,    // Set default values for missing fields
        removeCorruptedItems: true, // Remove items that can't be repaired
        createBackup: false        // We already created a backup
      });
      
      if (repairResult.success) {
        // Save the repaired conversation
        await this.saveConversation(conversation);
      }
      
      return {
        success: repairResult.success,
        repairedFields: repairResult.repairedFields,
        errors: repairResult.errors
      };
    } catch (error) {
      return {
        success: false,
        repairedFields: [],
        errors: [error instanceof Error ? error : new Error(String(error))]
      };
    }
  }
  
  /**
   * Create a backup of a conversation
   * 
   * @param conversationId The ID of the conversation to backup
   * @returns The backup ID
   */
  async createBackup(conversationId: string): Promise<string> {
    try {
      const conversation = await this.getConversation(conversationId);
      if (!conversation) {
        throw new Error(`Conversation ${conversationId} not found`);
      }
      
      const backupId = `backup-${conversationId}-${Date.now()}`;
      const backupDir = path.join(this.backupsDir, backupId);
      
      // Create backup directory
      await this.ensureDirectoryExists(backupDir);
      
      // Backup conversation
      const conversationBackupPath = path.join(backupDir, `${conversationId}.json`);
      const conversationData = SerializationUtil.serializeConversation(conversation, { prettyPrint: true });
      await vscode.workspace.fs.writeFile(vscode.Uri.file(conversationBackupPath), Buffer.from(conversationData, 'utf8'));
      
      // Backup messages
      const messages = await this.getMessages(conversationId);
      for (const message of messages) {
        const messageBackupPath = path.join(backupDir, `message-${message.id}.json`);
        const messageData = SerializationUtil.serializeMessage(message, { prettyPrint: true });
        await vscode.workspace.fs.writeFile(vscode.Uri.file(messageBackupPath), Buffer.from(messageData, 'utf8'));
      }
      
      return backupId;
    } catch (error) {
      throw new StorageError(
        `Failed to create backup for conversation ${conversationId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  
  /**
   * Migrate all data to the current schema version
   * 
   * @param options Migration options
   * @returns Migration result
   */
  async migrateData(options: {
    createBackups?: boolean;
    progressCallback?: (current: number, total: number) => void;
  } = {}): Promise<MigrationResult> {
    try {
      // Use the DataMigration utility to migrate all data
      return await DataMigration.migrateStorage(this.storageRoot, {
        createBackups: options.createBackups ?? true,
        validateAfterMigration: true,
        continueOnError: true,
        progressCallback: options.progressCallback
      });
    } catch (error) {
      throw new StorageError(
        `Failed to migrate data: ${error instanceof Error ? error.message : String(error)}`,
        { category: ErrorCategory.STORAGE }
      );
    }
  }

  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
    } catch (error) {
      // Directory might already exist, which is fine
    }
  }

  private matchesFilter(conversation: Conversation, filter?: ConversationFilter): boolean {
    if (!filter) {return true;}

    if (filter.status && filter.status !== 'all' && conversation.status !== filter.status) {
      return false;
    }

    if (filter.searchQuery) {
      const query = filter.searchQuery.toLowerCase();
      if (!conversation.title.toLowerCase().includes(query)) {
        return false;
      }
    }

    if (filter.dateRange) {
      if (conversation.timestamp < filter.dateRange.start || conversation.timestamp > filter.dateRange.end) {
        return false;
      }
    }

    return true;
  }

  private matchesMessageFilter(message: Message, filter?: MessageFilter): boolean {
    if (!filter) {return true;}

    if (filter.sender && filter.sender !== 'all' && message.sender !== filter.sender) {
      return false;
    }

    if (filter.searchQuery) {
      const query = filter.searchQuery.toLowerCase();
      if (!message.content.toLowerCase().includes(query)) {
        return false;
      }
    }

    if (filter.hasCodeChanges !== undefined) {
      const hasChanges = message.codeChanges.length > 0;
      if (filter.hasCodeChanges !== hasChanges) {
        return false;
      }
    }

    if (filter.dateRange) {
      if (message.timestamp < filter.dateRange.start || message.timestamp > filter.dateRange.end) {
        return false;
      }
    }

    return true;
  }

  private async deleteConversationMessages(conversationId: string): Promise<void> {
    try {
      const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(this.messagesDir));
      
      for (const [fileName] of files) {
        if (fileName.endsWith('.json')) {
          try {
            const filePath = path.join(this.messagesDir, fileName);
            const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
            const message: Message = JSON.parse(data.toString());
            
            if (message.conversationId === conversationId) {
              await vscode.workspace.fs.delete(vscode.Uri.file(filePath));
            }
          } catch (error) {
            console.warn(`Failed to check message file ${fileName}:`, error);
          }
        }
      }
    } catch (error) {
      console.warn(`Failed to delete messages for conversation ${conversationId}:`, error);
    }
  }

  private async deleteConversationSnapshots(conversationId: string): Promise<void> {
    // TODO: Implement snapshot cleanup for conversation
    // This would require tracking which snapshots belong to which conversation
  }

  private async cleanupDirectory(dirPath: string, cutoffTime: number): Promise<void> {
    try {
      const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dirPath));
      
      for (const [fileName] of files) {
        try {
          const filePath = path.join(dirPath, fileName);
          const stat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
          
          if (stat.mtime < cutoffTime) {
            await vscode.workspace.fs.delete(vscode.Uri.file(filePath));
          }
        } catch (error) {
          console.warn(`Failed to cleanup file ${fileName}:`, error);
        }
      }
    } catch (error) {
      console.warn(`Failed to cleanup directory ${dirPath}:`, error);
    }
  }
}