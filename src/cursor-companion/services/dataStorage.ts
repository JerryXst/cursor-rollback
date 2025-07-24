import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { IDataStorage } from './interfaces';
import { Conversation, ConversationFilter } from '../models/conversation';
import { Message, MessageFilter } from '../models/message';
import { StorageError, DataIntegrityError } from '../models/errors';
import { SnapshotCollection, FileSnapshot } from '../models/fileSnapshot';
import { SerializationUtil } from '../utils/serialization';
import { DataMigration, MigrationResult } from '../utils/dataMigration';
import { ErrorCategory } from '../models/errors';
import { 
  verifySnapshotIntegrity, 
  detectConversationCorruption, 
  detectMessageCorruption,
  repairConversation,
  verifyDataConsistency,
  assertDataValidity
} from '../utils/dataIntegrity';
import { validateConversation, validateMessage } from '../models/validation';
import { DATA_INTEGRITY } from '../utils/constants';

/**
 * Local file-based storage implementation for conversation data
 * Implements comprehensive CRUD operations with data integrity and snapshot management
 */
export class DataStorage implements IDataStorage {
  private readonly storageRoot: string;
  private readonly conversationsDir: string;
  private readonly messagesDir: string;
  private readonly snapshotsDir: string;
  private readonly backupsDir: string;
  private readonly indexDir: string;
  private readonly tempDir: string;
  
  // In-memory caches for performance
  private conversationCache = new Map<string, Conversation>();
  private messageCache = new Map<string, Message>();
  private snapshotCache = new Map<string, SnapshotCollection>();
  
  // File locks for concurrent access protection
  private fileLocks = new Map<string, Promise<void>>();

  constructor(private context: vscode.ExtensionContext) {
    this.storageRoot = path.join(context.globalStorageUri.fsPath, 'cursor-companion');
    this.conversationsDir = path.join(this.storageRoot, 'conversations');
    this.messagesDir = path.join(this.storageRoot, 'messages');
    this.snapshotsDir = path.join(this.storageRoot, 'snapshots');
    this.backupsDir = path.join(this.storageRoot, 'backups');
    this.indexDir = path.join(this.storageRoot, 'indexes');
    this.tempDir = path.join(this.storageRoot, 'temp');
  }

  async initialize(): Promise<void> {
    try {
      // Create all storage directories
      await this.ensureDirectoryExists(this.storageRoot);
      await this.ensureDirectoryExists(this.conversationsDir);
      await this.ensureDirectoryExists(this.messagesDir);
      await this.ensureDirectoryExists(this.snapshotsDir);
      await this.ensureDirectoryExists(this.backupsDir);
      await this.ensureDirectoryExists(this.indexDir);
      await this.ensureDirectoryExists(this.tempDir);
      
      // Initialize storage metadata
      await this.initializeStorageMetadata();
      
      // Perform data integrity check on startup
      await this.performStartupIntegrityCheck();
      
      // Clean up temporary files from previous sessions
      await this.cleanupTempFiles();

      console.log('Cursor Companion: Data storage initialized successfully');
    } catch (error) {
      throw new StorageError(`Failed to initialize data storage: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    try {
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
      
      // Use atomic save operation
      await this.saveConversationAtomic(conversation);
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
          const conversationId = fileName.replace('.json', '');
          
          try {
            let conversation: Conversation;
            
            // Check cache first
            if (this.conversationCache.has(conversationId)) {
              conversation = this.conversationCache.get(conversationId)!;
            } else {
              // Load from file
              const filePath = path.join(this.conversationsDir, fileName);
              const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
              conversation = SerializationUtil.deserializeConversation(data.toString(), {
                autoMigrate: true,
                validate: false // Skip validation for bulk loading
              });
              
              // Cache the result
              this.conversationCache.set(conversationId, conversation);
            }
            
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
      // Check cache first
      if (this.conversationCache.has(id)) {
        return this.conversationCache.get(id)!;
      }
      
      const filePath = path.join(this.conversationsDir, `${id}.json`);
      const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      const conversation = SerializationUtil.deserializeConversation(data.toString(), { 
        autoMigrate: true,
        validate: true 
      });
      
      // Cache the result
      this.conversationCache.set(id, conversation);
      return conversation;
    } catch (error) {
      if (error instanceof StorageError) {
        console.error(`Error deserializing conversation ${id}:`, error);
      }
      // File not found or parse error
      return null;
    }
  }

  async deleteConversation(id: string): Promise<void> {
    return this.withFileLock(`conversation-${id}`, async () => {
      try {
        const filePath = path.join(this.conversationsDir, `${id}.json`);
        await vscode.workspace.fs.delete(vscode.Uri.file(filePath));
        
        // Clear from cache
        this.conversationCache.delete(id);
        
        // Also delete associated messages and snapshots
        await this.deleteConversationMessages(id);
        await this.deleteConversationSnapshots(id);
      } catch (error) {
        throw new StorageError(`Failed to delete conversation ${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
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
      
      // Use atomic save operation
      await this.saveMessageAtomic(message);
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
          const messageId = fileName.replace('.json', '');
          
          try {
            let message: Message;
            
            // Check cache first
            if (this.messageCache.has(messageId)) {
              message = this.messageCache.get(messageId)!;
            } else {
              // Load from file
              const filePath = path.join(this.messagesDir, fileName);
              const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
              message = SerializationUtil.deserializeMessage(data.toString(), {
                autoMigrate: true,
                validate: false // Skip validation for bulk loading
              });
              
              // Cache the result
              this.messageCache.set(messageId, message);
            }
            
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
      // Check cache first
      if (this.messageCache.has(id)) {
        return this.messageCache.get(id)!;
      }
      
      const filePath = path.join(this.messagesDir, `${id}.json`);
      const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      const message = SerializationUtil.deserializeMessage(data.toString(), { 
        autoMigrate: true,
        validate: true 
      });
      
      // Cache the result
      this.messageCache.set(id, message);
      return message;
    } catch (error) {
      if (error instanceof StorageError) {
        console.error(`Error deserializing message ${id}:`, error);
      }
      return null;
    }
  }

  async saveSnapshot(snapshot: SnapshotCollection): Promise<void> {
    return this.withFileLock(`snapshot-${snapshot.id}`, async () => {
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
        
        // Use optimized storage for large snapshots
        if (this.shouldUseOptimizedStorage(snapshot)) {
          await this.saveSnapshotOptimized(snapshot);
        } else {
          await this.saveSnapshotStandard(snapshot);
        }
        
        // Update cache
        this.snapshotCache.set(snapshot.id, snapshot);
        
        // Update snapshot index for faster retrieval
        await this.updateSnapshotIndex(snapshot);
        
      } catch (error) {
        throw new StorageError(`Failed to save snapshot ${snapshot.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  async getSnapshot(messageId: string): Promise<SnapshotCollection | null> {
    try {
      // Check cache first
      for (const [, snapshot] of this.snapshotCache) {
        if (snapshot.messageId === messageId) {
          return snapshot;
        }
      }
      
      // Use index for faster lookup
      const snapshotId = await this.getSnapshotIdByMessageId(messageId);
      if (snapshotId) {
        return await this.getSnapshotById(snapshotId);
      }
      
      // Fallback to directory scan (for backward compatibility)
      return await this.getSnapshotByMessageIdScan(messageId);
      
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
   * Create a full system backup of all data
   */
  async createFullBackup(description?: string): Promise<string> {
    try {
      const backupId = `full-backup-${Date.now()}`;
      const backupDir = path.join(this.backupsDir, backupId);
      
      // Create backup directory structure
      await this.ensureDirectoryExists(backupDir);
      await this.ensureDirectoryExists(path.join(backupDir, 'conversations'));
      await this.ensureDirectoryExists(path.join(backupDir, 'messages'));
      await this.ensureDirectoryExists(path.join(backupDir, 'snapshots'));
      await this.ensureDirectoryExists(path.join(backupDir, 'indexes'));
      
      // Create backup metadata
      const metadata = {
        id: backupId,
        type: 'full',
        description: description || 'Full system backup',
        timestamp: Date.now(),
        version: '1.0.0'
      };
      
      const metadataPath = path.join(backupDir, 'metadata.json');
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(metadataPath), 
        Buffer.from(JSON.stringify(metadata, null, 2), 'utf8')
      );
      
      // Backup all conversations
      await this.copyDirectory(this.conversationsDir, path.join(backupDir, 'conversations'));
      
      // Backup all messages
      await this.copyDirectory(this.messagesDir, path.join(backupDir, 'messages'));
      
      // Backup all snapshots
      await this.copyDirectory(this.snapshotsDir, path.join(backupDir, 'snapshots'));
      
      // Backup indexes
      await this.copyDirectory(this.indexDir, path.join(backupDir, 'indexes'));
      
      // Create backup summary
      const stats = await this.getStorageStats();
      const summary = {
        ...stats,
        backupId,
        timestamp: Date.now(),
        description
      };
      
      const summaryPath = path.join(backupDir, 'summary.json');
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(summaryPath), 
        Buffer.from(JSON.stringify(summary, null, 2), 'utf8')
      );
      
      console.log(`Full backup created: ${backupId}`);
      return backupId;
    } catch (error) {
      throw new StorageError(`Failed to create full backup: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Create an incremental backup (only changed data since last backup)
   */
  async createIncrementalBackup(lastBackupTimestamp: number, description?: string): Promise<string> {
    try {
      const backupId = `incremental-backup-${Date.now()}`;
      const backupDir = path.join(this.backupsDir, backupId);
      
      // Create backup directory structure
      await this.ensureDirectoryExists(backupDir);
      await this.ensureDirectoryExists(path.join(backupDir, 'conversations'));
      await this.ensureDirectoryExists(path.join(backupDir, 'messages'));
      await this.ensureDirectoryExists(path.join(backupDir, 'snapshots'));
      
      // Create backup metadata
      const metadata = {
        id: backupId,
        type: 'incremental',
        description: description || 'Incremental backup',
        timestamp: Date.now(),
        lastBackupTimestamp,
        version: '1.0.0'
      };
      
      const metadataPath = path.join(backupDir, 'metadata.json');
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(metadataPath), 
        Buffer.from(JSON.stringify(metadata, null, 2), 'utf8')
      );
      
      let changedFiles = 0;
      
      // Backup changed conversations
      changedFiles += await this.backupChangedFiles(
        this.conversationsDir, 
        path.join(backupDir, 'conversations'),
        lastBackupTimestamp
      );
      
      // Backup changed messages
      changedFiles += await this.backupChangedFiles(
        this.messagesDir, 
        path.join(backupDir, 'messages'),
        lastBackupTimestamp
      );
      
      // Backup changed snapshots
      changedFiles += await this.backupChangedFiles(
        this.snapshotsDir, 
        path.join(backupDir, 'snapshots'),
        lastBackupTimestamp
      );
      
      // Create backup summary
      const summary = {
        backupId,
        type: 'incremental',
        timestamp: Date.now(),
        lastBackupTimestamp,
        changedFiles,
        description
      };
      
      const summaryPath = path.join(backupDir, 'summary.json');
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(summaryPath), 
        Buffer.from(JSON.stringify(summary, null, 2), 'utf8')
      );
      
      console.log(`Incremental backup created: ${backupId} (${changedFiles} changed files)`);
      return backupId;
    } catch (error) {
      throw new StorageError(`Failed to create incremental backup: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Restore data from a backup
   */
  async restoreFromBackup(backupId: string, options?: {
    restoreConversations?: boolean;
    restoreMessages?: boolean;
    restoreSnapshots?: boolean;
    restoreIndexes?: boolean;
    createBackupBeforeRestore?: boolean;
  }): Promise<{
    success: boolean;
    restoredItems: number;
    errors: string[];
    preRestoreBackupId?: string;
  }> {
    const restoreOptions = {
      restoreConversations: true,
      restoreMessages: true,
      restoreSnapshots: true,
      restoreIndexes: true,
      createBackupBeforeRestore: true,
      ...options
    };
    
    try {
      const backupDir = path.join(this.backupsDir, backupId);
      
      // Verify backup exists
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(backupDir));
      } catch {
        throw new Error(`Backup ${backupId} not found`);
      }
      
      // Load backup metadata
      const metadataPath = path.join(backupDir, 'metadata.json');
      const metadataData = await vscode.workspace.fs.readFile(vscode.Uri.file(metadataPath));
      const metadata = JSON.parse(metadataData.toString());
      
      let preRestoreBackupId: string | undefined;
      
      // Create backup before restore if requested
      if (restoreOptions.createBackupBeforeRestore) {
        preRestoreBackupId = await this.createFullBackup(`Pre-restore backup before restoring ${backupId}`);
      }
      
      const result = {
        success: true,
        restoredItems: 0,
        errors: [] as string[],
        preRestoreBackupId
      };
      
      // Clear caches before restore
      this.conversationCache.clear();
      this.messageCache.clear();
      this.snapshotCache.clear();
      
      // Restore conversations
      if (restoreOptions.restoreConversations) {
        try {
          const conversationsBackupDir = path.join(backupDir, 'conversations');
          const restoredCount = await this.restoreDirectory(conversationsBackupDir, this.conversationsDir);
          result.restoredItems += restoredCount;
        } catch (error) {
          result.errors.push(`Failed to restore conversations: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      // Restore messages
      if (restoreOptions.restoreMessages) {
        try {
          const messagesBackupDir = path.join(backupDir, 'messages');
          const restoredCount = await this.restoreDirectory(messagesBackupDir, this.messagesDir);
          result.restoredItems += restoredCount;
        } catch (error) {
          result.errors.push(`Failed to restore messages: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      // Restore snapshots
      if (restoreOptions.restoreSnapshots) {
        try {
          const snapshotsBackupDir = path.join(backupDir, 'snapshots');
          const restoredCount = await this.restoreDirectory(snapshotsBackupDir, this.snapshotsDir);
          result.restoredItems += restoredCount;
        } catch (error) {
          result.errors.push(`Failed to restore snapshots: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      // Restore indexes
      if (restoreOptions.restoreIndexes) {
        try {
          const indexesBackupDir = path.join(backupDir, 'indexes');
          const restoredCount = await this.restoreDirectory(indexesBackupDir, this.indexDir);
          result.restoredItems += restoredCount;
        } catch (error) {
          result.errors.push(`Failed to restore indexes: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      // If there were errors, mark as not fully successful
      if (result.errors.length > 0) {
        result.success = false;
      }
      
      console.log(`Restore completed: ${result.restoredItems} items restored, ${result.errors.length} errors`);
      return result;
    } catch (error) {
      throw new StorageError(`Failed to restore from backup ${backupId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * List all available backups
   */
  async listBackups(): Promise<Array<{
    id: string;
    type: 'full' | 'incremental' | 'conversation';
    timestamp: number;
    description?: string;
    size?: number;
  }>> {
    try {
      const backups: Array<{
        id: string;
        type: 'full' | 'incremental' | 'conversation';
        timestamp: number;
        description?: string;
        size?: number;
      }> = [];
      
      const backupDirs = await vscode.workspace.fs.readDirectory(vscode.Uri.file(this.backupsDir));
      
      for (const [backupId, fileType] of backupDirs) {
        if (fileType === vscode.FileType.Directory) {
          try {
            const backupDir = path.join(this.backupsDir, backupId);
            const metadataPath = path.join(backupDir, 'metadata.json');
            
            try {
              const metadataData = await vscode.workspace.fs.readFile(vscode.Uri.file(metadataPath));
              const metadata = JSON.parse(metadataData.toString());
              
              // Calculate backup size
              const size = await this.calculateDirectorySize(backupDir);
              
              backups.push({
                id: backupId,
                type: metadata.type || 'conversation',
                timestamp: metadata.timestamp || 0,
                description: metadata.description,
                size
              });
            } catch {
              // Fallback for backups without metadata
              const stat = await vscode.workspace.fs.stat(vscode.Uri.file(backupDir));
              const size = await this.calculateDirectorySize(backupDir);
              
              backups.push({
                id: backupId,
                type: backupId.startsWith('full-') ? 'full' : 
                      backupId.startsWith('incremental-') ? 'incremental' : 'conversation',
                timestamp: stat.ctime,
                size
              });
            }
          } catch (error) {
            console.warn(`Failed to read backup ${backupId}:`, error);
          }
        }
      }
      
      // Sort by timestamp (newest first)
      return backups.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      throw new StorageError(`Failed to list backups: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Delete a backup
   */
  async deleteBackup(backupId: string): Promise<void> {
    try {
      const backupDir = path.join(this.backupsDir, backupId);
      await vscode.workspace.fs.delete(vscode.Uri.file(backupDir), { recursive: true });
      console.log(`Backup deleted: ${backupId}`);
    } catch (error) {
      throw new StorageError(`Failed to delete backup ${backupId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Clean up old backups based on retention policy
   */
  async cleanupOldBackups(options?: {
    maxAge?: number; // in days
    maxCount?: number;
    keepFullBackups?: boolean;
  }): Promise<{
    deletedBackups: string[];
    keptBackups: string[];
  }> {
    const cleanupOptions = {
      maxAge: 30, // 30 days
      maxCount: 10,
      keepFullBackups: true,
      ...options
    };
    
    try {
      const backups = await this.listBackups();
      const cutoffTime = Date.now() - (cleanupOptions.maxAge * 24 * 60 * 60 * 1000);
      
      const deletedBackups: string[] = [];
      const keptBackups: string[] = [];
      
      // Sort backups by timestamp (oldest first for deletion)
      const sortedBackups = [...backups].sort((a, b) => a.timestamp - b.timestamp);
      
      for (let i = 0; i < sortedBackups.length; i++) {
        const backup = sortedBackups[i];
        const shouldDelete = 
          // Delete if too old
          (backup.timestamp < cutoffTime) ||
          // Delete if exceeding max count (but keep full backups if specified)
          (i < sortedBackups.length - cleanupOptions.maxCount && 
           !(cleanupOptions.keepFullBackups && backup.type === 'full'));
        
        if (shouldDelete) {
          try {
            await this.deleteBackup(backup.id);
            deletedBackups.push(backup.id);
          } catch (error) {
            console.warn(`Failed to delete backup ${backup.id}:`, error);
            keptBackups.push(backup.id);
          }
        } else {
          keptBackups.push(backup.id);
        }
      }
      
      console.log(`Backup cleanup completed: ${deletedBackups.length} deleted, ${keptBackups.length} kept`);
      return { deletedBackups, keptBackups };
    } catch (error) {
      throw new StorageError(`Failed to cleanup old backups: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Export data to external format (JSON)
   */
  async exportData(options?: {
    includeConversations?: boolean;
    includeMessages?: boolean;
    includeSnapshots?: boolean;
    conversationIds?: string[];
    format?: 'json' | 'csv';
  }): Promise<string> {
    const exportOptions = {
      includeConversations: true,
      includeMessages: true,
      includeSnapshots: false, // Snapshots can be very large
      format: 'json' as const,
      ...options
    };
    
    try {
      const exportData: any = {
        metadata: {
          exportTimestamp: Date.now(),
          version: '1.0.0',
          options: exportOptions
        }
      };
      
      // Export conversations
      if (exportOptions.includeConversations) {
        let conversations = await this.getConversations();
        
        // Filter by conversation IDs if specified
        if (exportOptions.conversationIds) {
          conversations = conversations.filter(c => exportOptions.conversationIds!.includes(c.id));
        }
        
        exportData.conversations = conversations;
        
        // Export messages for each conversation
        if (exportOptions.includeMessages) {
          exportData.messages = {};
          
          for (const conversation of conversations) {
            const messages = await this.getMessages(conversation.id);
            exportData.messages[conversation.id] = messages;
          }
        }
        
        // Export snapshots if requested
        if (exportOptions.includeSnapshots) {
          exportData.snapshots = {};
          
          for (const conversation of conversations) {
            const messages = await this.getMessages(conversation.id);
            
            for (const message of messages) {
              const snapshot = await this.getSnapshot(message.id);
              if (snapshot) {
                exportData.snapshots[message.id] = snapshot;
              }
            }
          }
        }
      }
      
      // Create export file
      const exportId = `export-${Date.now()}`;
      const exportPath = path.join(this.tempDir, `${exportId}.json`);
      
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(exportPath), 
        Buffer.from(JSON.stringify(exportData, null, 2), 'utf8')
      );
      
      console.log(`Data exported to: ${exportPath}`);
      return exportPath;
    } catch (error) {
      throw new StorageError(`Failed to export data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Import data from external format
   */
  async importData(filePath: string, options?: {
    overwriteExisting?: boolean;
    validateData?: boolean;
    createBackupBeforeImport?: boolean;
  }): Promise<{
    success: boolean;
    importedConversations: number;
    importedMessages: number;
    importedSnapshots: number;
    errors: string[];
    preImportBackupId?: string;
  }> {
    const importOptions = {
      overwriteExisting: false,
      validateData: true,
      createBackupBeforeImport: true,
      ...options
    };
    
    try {
      // Read import file
      const importData = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      const data = JSON.parse(importData.toString());
      
      const result = {
        success: true,
        importedConversations: 0,
        importedMessages: 0,
        importedSnapshots: 0,
        errors: [] as string[],
        preImportBackupId: undefined as string | undefined
      };
      
      // Create backup before import if requested
      if (importOptions.createBackupBeforeImport) {
        result.preImportBackupId = await this.createFullBackup('Pre-import backup');
      }
      
      // Import conversations
      if (data.conversations) {
        for (const conversationData of data.conversations) {
          try {
            // Check if conversation already exists
            if (!importOptions.overwriteExisting) {
              const existing = await this.getConversation(conversationData.id);
              if (existing) {
                result.errors.push(`Conversation ${conversationData.id} already exists (skipped)`);
                continue;
              }
            }
            
            // Validate data if requested
            if (importOptions.validateData) {
              assertDataValidity(conversationData, validateConversation, `Invalid conversation data for ${conversationData.id}`);
            }
            
            await this.saveConversation(conversationData);
            result.importedConversations++;
          } catch (error) {
            result.errors.push(`Failed to import conversation ${conversationData.id}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      
      // Import messages
      if (data.messages) {
        for (const [conversationId, messages] of Object.entries(data.messages)) {
          for (const messageData of messages as any[]) {
            try {
              // Check if message already exists
              if (!importOptions.overwriteExisting) {
                const existing = await this.getMessage(messageData.id);
                if (existing) {
                  result.errors.push(`Message ${messageData.id} already exists (skipped)`);
                  continue;
                }
              }
              
              // Validate data if requested
              if (importOptions.validateData) {
                assertDataValidity(messageData, validateMessage, `Invalid message data for ${messageData.id}`);
              }
              
              await this.saveMessage(messageData);
              result.importedMessages++;
            } catch (error) {
              result.errors.push(`Failed to import message ${messageData.id}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        }
      }
      
      // Import snapshots
      if (data.snapshots) {
        for (const [messageId, snapshotData] of Object.entries(data.snapshots)) {
          try {
            await this.saveSnapshot(snapshotData as SnapshotCollection);
            result.importedSnapshots++;
          } catch (error) {
            result.errors.push(`Failed to import snapshot for message ${messageId}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      
      // If there were errors, mark as not fully successful
      if (result.errors.length > 0) {
        result.success = false;
      }
      
      console.log(`Import completed: ${result.importedConversations} conversations, ${result.importedMessages} messages, ${result.importedSnapshots} snapshots imported, ${result.errors.length} errors`);
      return result;
    } catch (error) {
      throw new StorageError(`Failed to import data: ${error instanceof Error ? error.message : String(error)}`);
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
          const messageId = fileName.replace('.json', '');
          
          try {
            let message: Message;
            
            // Check cache first
            if (this.messageCache.has(messageId)) {
              message = this.messageCache.get(messageId)!;
            } else {
              // Load from file to check conversation ID
              const filePath = path.join(this.messagesDir, fileName);
              const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
              message = JSON.parse(data.toString());
            }
            
            if (message.conversationId === conversationId) {
              const filePath = path.join(this.messagesDir, fileName);
              await vscode.workspace.fs.delete(vscode.Uri.file(filePath));
              
              // Clear from cache
              this.messageCache.delete(messageId);
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
    try {
      // Get all messages for this conversation to find associated snapshots
      const messages = await this.getMessages(conversationId);
      
      for (const message of messages) {
        try {
          const snapshot = await this.getSnapshot(message.id);
          if (snapshot) {
            // Delete standard format snapshot
            const standardPath = path.join(this.snapshotsDir, `${snapshot.id}.json`);
            try {
              await vscode.workspace.fs.delete(vscode.Uri.file(standardPath));
            } catch {}
            
            // Delete optimized format snapshot directory
            const optimizedPath = path.join(this.snapshotsDir, snapshot.id);
            try {
              await vscode.workspace.fs.delete(vscode.Uri.file(optimizedPath), { recursive: true });
            } catch {}
            
            // Clear from cache
            this.snapshotCache.delete(snapshot.id);
          }
        } catch (error) {
          console.warn(`Failed to delete snapshot for message ${message.id}:`, error);
        }
      }
      
      // Update snapshot index to remove deleted entries
      await this.cleanupSnapshotIndex(conversationId);
      
    } catch (error) {
      console.warn(`Failed to delete snapshots for conversation ${conversationId}:`, error);
    }
  }
  
  /**
   * Clean up snapshot index entries for deleted conversation
   */
  private async cleanupSnapshotIndex(conversationId: string): Promise<void> {
    try {
      const indexPath = path.join(this.indexDir, 'snapshots.json');
      let index: Record<string, string> = {};
      
      try {
        const indexData = await vscode.workspace.fs.readFile(vscode.Uri.file(indexPath));
        index = JSON.parse(indexData.toString());
      } catch {
        return; // Index doesn't exist
      }
      
      // Get messages for this conversation to identify which index entries to remove
      const messages = await this.getMessages(conversationId);
      const messageIds = new Set(messages.map(m => m.id));
      
      // Remove index entries for deleted messages
      for (const messageId of messageIds) {
        delete index[messageId];
      }
      
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(indexPath), 
        Buffer.from(JSON.stringify(index, null, 2), 'utf8')
      );
    } catch (error) {
      console.warn('Failed to cleanup snapshot index:', error);
    }
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
  
  /**
   * Initialize storage metadata and configuration
   */
  private async initializeStorageMetadata(): Promise<void> {
    const metadataPath = path.join(this.storageRoot, 'metadata.json');
    const metadata = {
      version: '1.0.0',
      created: Date.now(),
      lastAccessed: Date.now(),
      schemaVersion: 1
    };
    
    try {
      // Check if metadata exists
      await vscode.workspace.fs.stat(vscode.Uri.file(metadataPath));
      
      // Update last accessed time
      const existingData = await vscode.workspace.fs.readFile(vscode.Uri.file(metadataPath));
      const existingMetadata = JSON.parse(existingData.toString());
      existingMetadata.lastAccessed = Date.now();
      
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(metadataPath), 
        Buffer.from(JSON.stringify(existingMetadata, null, 2), 'utf8')
      );
    } catch {
      // Create new metadata file
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(metadataPath), 
        Buffer.from(JSON.stringify(metadata, null, 2), 'utf8')
      );
    }
  }
  
  /**
   * Perform startup integrity check
   */
  private async performStartupIntegrityCheck(): Promise<void> {
    try {
      const result = await this.verifyDataIntegrity();
      if (result.corruptedItems > 0) {
        console.warn(`Found ${result.corruptedItems} corrupted items during startup integrity check`);
        
        // Log errors for debugging
        result.errors.forEach(error => {
          console.error('Data integrity error:', error.message);
        });
      }
    } catch (error) {
      console.error('Failed to perform startup integrity check:', error);
    }
  }
  
  /**
   * Clean up temporary files from previous sessions
   */
  private async cleanupTempFiles(): Promise<void> {
    try {
      const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(this.tempDir));
      
      for (const [fileName] of files) {
        try {
          const filePath = path.join(this.tempDir, fileName);
          await vscode.workspace.fs.delete(vscode.Uri.file(filePath));
        } catch (error) {
          console.warn(`Failed to cleanup temp file ${fileName}:`, error);
        }
      }
    } catch (error) {
      // Temp directory might not exist yet
    }
  }
  
  /**
   * Determine if optimized storage should be used for large snapshots
   */
  private shouldUseOptimizedStorage(snapshot: SnapshotCollection): boolean {
    const totalSize = snapshot.snapshots.reduce((sum, s) => sum + s.content.length, 0);
    const fileCount = snapshot.snapshots.length;
    
    // Use optimized storage for large snapshots (>1MB or >50 files)
    return totalSize > 1024 * 1024 || fileCount > 50;
  }
  
  /**
   * Save snapshot using standard JSON format
   */
  private async saveSnapshotStandard(snapshot: SnapshotCollection): Promise<void> {
    const filePath = path.join(this.snapshotsDir, `${snapshot.id}.json`);
    const data = SerializationUtil.serializeSnapshot(snapshot, { prettyPrint: true });
    await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), Buffer.from(data, 'utf8'));
  }
  
  /**
   * Save snapshot using optimized format (separate files for large content)
   */
  private async saveSnapshotOptimized(snapshot: SnapshotCollection): Promise<void> {
    const snapshotDir = path.join(this.snapshotsDir, snapshot.id);
    await this.ensureDirectoryExists(snapshotDir);
    
    // Save metadata
    const metadata = {
      id: snapshot.id,
      messageId: snapshot.messageId,
      timestamp: snapshot.timestamp,
      description: snapshot.description,
      fileCount: snapshot.snapshots.length,
      optimized: true
    };
    
    const metadataPath = path.join(snapshotDir, 'metadata.json');
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(metadataPath), 
      Buffer.from(JSON.stringify(metadata, null, 2), 'utf8')
    );
    
    // Save individual file snapshots
    for (let i = 0; i < snapshot.snapshots.length; i++) {
      const fileSnapshot = snapshot.snapshots[i];
      const fileName = `file_${i}.json`;
      const filePath = path.join(snapshotDir, fileName);
      
      const fileData = {
        filePath: fileSnapshot.filePath,
        content: fileSnapshot.content,
        timestamp: fileSnapshot.timestamp,
        checksum: fileSnapshot.checksum,
        metadata: fileSnapshot.metadata
      };
      
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(filePath), 
        Buffer.from(JSON.stringify(fileData, null, 2), 'utf8')
      );
    }
  }
  
  /**
   * Get snapshot by ID (handles both standard and optimized formats)
   */
  private async getSnapshotById(snapshotId: string): Promise<SnapshotCollection | null> {
    // Check cache first
    if (this.snapshotCache.has(snapshotId)) {
      return this.snapshotCache.get(snapshotId)!;
    }
    
    try {
      // Try standard format first
      const standardPath = path.join(this.snapshotsDir, `${snapshotId}.json`);
      try {
        const data = await vscode.workspace.fs.readFile(vscode.Uri.file(standardPath));
        const snapshot = SerializationUtil.deserializeSnapshot(data.toString(), {
          autoMigrate: true,
          validate: true
        });
        
        // Cache the result
        this.snapshotCache.set(snapshotId, snapshot);
        return snapshot;
      } catch {
        // Try optimized format
        return await this.getSnapshotOptimized(snapshotId);
      }
    } catch (error) {
      console.warn(`Failed to load snapshot ${snapshotId}:`, error);
      return null;
    }
  }
  
  /**
   * Get snapshot from optimized storage format
   */
  private async getSnapshotOptimized(snapshotId: string): Promise<SnapshotCollection | null> {
    const snapshotDir = path.join(this.snapshotsDir, snapshotId);
    
    try {
      // Read metadata
      const metadataPath = path.join(snapshotDir, 'metadata.json');
      const metadataData = await vscode.workspace.fs.readFile(vscode.Uri.file(metadataPath));
      const metadata = JSON.parse(metadataData.toString());
      
      // Read individual file snapshots
      const snapshots: FileSnapshot[] = [];
      const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(snapshotDir));
      
      for (const [fileName] of files) {
        if (fileName.startsWith('file_') && fileName.endsWith('.json')) {
          const filePath = path.join(snapshotDir, fileName);
          const fileData = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
          const fileSnapshot = JSON.parse(fileData.toString()) as FileSnapshot;
          snapshots.push(fileSnapshot);
        }
      }
      
      const snapshot: SnapshotCollection = {
        id: metadata.id,
        messageId: metadata.messageId,
        timestamp: metadata.timestamp,
        description: metadata.description,
        snapshots: snapshots
      };
      
      // Cache the result
      this.snapshotCache.set(snapshotId, snapshot);
      return snapshot;
      
    } catch (error) {
      console.warn(`Failed to load optimized snapshot ${snapshotId}:`, error);
      return null;
    }
  }
  
  /**
   * Update snapshot index for faster retrieval
   */
  private async updateSnapshotIndex(snapshot: SnapshotCollection): Promise<void> {
    try {
      const indexPath = path.join(this.indexDir, 'snapshots.json');
      let index: Record<string, string> = {};
      
      try {
        const indexData = await vscode.workspace.fs.readFile(vscode.Uri.file(indexPath));
        index = JSON.parse(indexData.toString());
      } catch {
        // Index doesn't exist yet
      }
      
      // Update index with messageId -> snapshotId mapping
      index[snapshot.messageId] = snapshot.id;
      
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(indexPath), 
        Buffer.from(JSON.stringify(index, null, 2), 'utf8')
      );
    } catch (error) {
      console.warn('Failed to update snapshot index:', error);
    }
  }
  
  /**
   * Get snapshot ID by message ID using index
   */
  private async getSnapshotIdByMessageId(messageId: string): Promise<string | null> {
    try {
      const indexPath = path.join(this.indexDir, 'snapshots.json');
      const indexData = await vscode.workspace.fs.readFile(vscode.Uri.file(indexPath));
      const index = JSON.parse(indexData.toString());
      
      return index[messageId] || null;
    } catch {
      return null;
    }
  }
  
  /**
   * Fallback method to find snapshot by scanning directory
   */
  private async getSnapshotByMessageIdScan(messageId: string): Promise<SnapshotCollection | null> {
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
              // Cache the result
              this.snapshotCache.set(snapshot.id, snapshot);
              return snapshot;
            }
          } catch (error) {
            console.warn(`Failed to load snapshot from ${fileName}:`, error);
          }
        }
      }
      
      return null;
    } catch (error) {
      throw new StorageError(`Failed to scan for snapshot with message ID ${messageId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * File locking mechanism to prevent concurrent access issues
   */
  private async withFileLock<T>(lockKey: string, operation: () => Promise<T>): Promise<T> {
    // Wait for any existing lock
    if (this.fileLocks.has(lockKey)) {
      await this.fileLocks.get(lockKey);
    }
    
    // Create new lock
    const lockPromise = operation();
    this.fileLocks.set(lockKey, lockPromise.then(() => {}, () => {}));
    
    try {
      const result = await lockPromise;
      return result;
    } finally {
      // Remove lock
      this.fileLocks.delete(lockKey);
    }
  }
  
  /**
   * Enhanced conversation saving with atomic operations
   */
  async saveConversationAtomic(conversation: Conversation): Promise<void> {
    return this.withFileLock(`conversation-${conversation.id}`, async () => {
      // Create temporary file first
      const tempPath = path.join(this.tempDir, `${conversation.id}-${Date.now()}.json`);
      const finalPath = path.join(this.conversationsDir, `${conversation.id}.json`);
      
      try {
        // Validate and serialize
        assertDataValidity(
          conversation, 
          validateConversation, 
          `Invalid conversation data for ${conversation.id}`
        );
        
        const data = SerializationUtil.serializeConversation(conversation, { prettyPrint: true });
        
        // Write to temporary file first
        await vscode.workspace.fs.writeFile(vscode.Uri.file(tempPath), Buffer.from(data, 'utf8'));
        
        // Verify the temporary file
        const verifyData = await vscode.workspace.fs.readFile(vscode.Uri.file(tempPath));
        SerializationUtil.deserializeConversation(verifyData.toString(), { validate: true });
        
        // Atomic move to final location
        await vscode.workspace.fs.rename(vscode.Uri.file(tempPath), vscode.Uri.file(finalPath));
        
        // Update cache
        this.conversationCache.set(conversation.id, conversation);
        
      } catch (error) {
        // Clean up temporary file on error
        try {
          await vscode.workspace.fs.delete(vscode.Uri.file(tempPath));
        } catch {}
        
        throw new StorageError(`Failed to save conversation ${conversation.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }
  
  /**
   * Enhanced message saving with atomic operations
   */
  async saveMessageAtomic(message: Message): Promise<void> {
    return this.withFileLock(`message-${message.id}`, async () => {
      const tempPath = path.join(this.tempDir, `${message.id}-${Date.now()}.json`);
      const finalPath = path.join(this.messagesDir, `${message.id}.json`);
      
      try {
        // Validate and serialize
        assertDataValidity(
          message, 
          validateMessage, 
          `Invalid message data for ${message.id}`
        );
        
        const data = SerializationUtil.serializeMessage(message, { prettyPrint: true });
        
        // Write to temporary file first
        await vscode.workspace.fs.writeFile(vscode.Uri.file(tempPath), Buffer.from(data, 'utf8'));
        
        // Verify the temporary file
        const verifyData = await vscode.workspace.fs.readFile(vscode.Uri.file(tempPath));
        SerializationUtil.deserializeMessage(verifyData.toString(), { validate: true });
        
        // Atomic move to final location
        await vscode.workspace.fs.rename(vscode.Uri.file(tempPath), vscode.Uri.file(finalPath));
        
        // Update cache
        this.messageCache.set(message.id, message);
        
      } catch (error) {
        // Clean up temporary file on error
        try {
          await vscode.workspace.fs.delete(vscode.Uri.file(tempPath));
        } catch {}
        
        throw new StorageError(`Failed to save message ${message.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }
  
  /**
   * Advanced search across conversations and messages
   */
  async searchConversations(query: string, options?: {
    includeMessages?: boolean;
    caseSensitive?: boolean;
    useRegex?: boolean;
    maxResults?: number;
  }): Promise<{
    conversations: Array<{
      conversation: Conversation;
      matches: Array<{
        field: 'title' | 'content';
        snippet: string;
        messageId?: string;
      }>;
    }>;
    totalMatches: number;
  }> {
    const searchOptions = {
      includeMessages: true,
      caseSensitive: false,
      useRegex: false,
      maxResults: 100,
      ...options
    };
    
    try {
      const results: Array<{
        conversation: Conversation;
        matches: Array<{
          field: 'title' | 'content';
          snippet: string;
          messageId?: string;
        }>;
      }> = [];
      
      let totalMatches = 0;
      const conversations = await this.getConversations();
      
      for (const conversation of conversations) {
        const matches: Array<{
          field: 'title' | 'content';
          snippet: string;
          messageId?: string;
        }> = [];
        
        // Search in conversation title
        if (this.matchesSearchQuery(conversation.title, query, searchOptions)) {
          matches.push({
            field: 'title',
            snippet: this.createSnippet(conversation.title, query, searchOptions)
          });
          totalMatches++;
        }
        
        // Search in messages if requested
        if (searchOptions.includeMessages) {
          const messages = await this.getMessages(conversation.id);
          
          for (const message of messages) {
            if (this.matchesSearchQuery(message.content, query, searchOptions)) {
              matches.push({
                field: 'content',
                snippet: this.createSnippet(message.content, query, searchOptions),
                messageId: message.id
              });
              totalMatches++;
              
              // Limit results per conversation to avoid overwhelming results
              if (matches.length >= 10) {
                break;
              }
            }
          }
        }
        
        if (matches.length > 0) {
          results.push({ conversation, matches });
          
          // Stop if we've reached the maximum results
          if (results.length >= searchOptions.maxResults) {
            break;
          }
        }
      }
      
      return { conversations: results, totalMatches };
    } catch (error) {
      throw new StorageError(`Failed to search conversations: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Get conversations with advanced filtering and sorting
   */
  async getConversationsAdvanced(options: {
    filter?: ConversationFilter;
    sortBy?: 'timestamp' | 'title' | 'messageCount' | 'lastActivity';
    sortOrder?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
  }): Promise<{
    conversations: Conversation[];
    total: number;
    hasMore: boolean;
  }> {
    try {
      const { filter, sortBy = 'timestamp', sortOrder = 'desc', limit = 50, offset = 0 } = options;
      
      // Get all conversations first
      let conversations = await this.getConversations(filter);
      const total = conversations.length;
      
      // Apply sorting
      conversations = this.sortConversations(conversations, sortBy, sortOrder);
      
      // Apply pagination
      const hasMore = offset + limit < total;
      conversations = conversations.slice(offset, offset + limit);
      
      return { conversations, total, hasMore };
    } catch (error) {
      throw new StorageError(`Failed to get conversations with advanced options: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Get messages with advanced filtering and sorting
   */
  async getMessagesAdvanced(conversationId: string, options: {
    filter?: MessageFilter;
    sortBy?: 'timestamp' | 'sender' | 'content';
    sortOrder?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
  }): Promise<{
    messages: Message[];
    total: number;
    hasMore: boolean;
  }> {
    try {
      const { filter, sortBy = 'timestamp', sortOrder = 'asc', limit = 100, offset = 0 } = options;
      
      // Get all messages first
      let messages = await this.getMessages(conversationId, filter);
      const total = messages.length;
      
      // Apply sorting
      messages = this.sortMessages(messages, sortBy, sortOrder);
      
      // Apply pagination
      const hasMore = offset + limit < total;
      messages = messages.slice(offset, offset + limit);
      
      return { messages, total, hasMore };
    } catch (error) {
      throw new StorageError(`Failed to get messages with advanced options: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Build and maintain search indexes for faster queries
   */
  async buildSearchIndex(): Promise<void> {
    try {
      console.log('Building search index...');
      
      const index = {
        conversations: new Map<string, {
          id: string;
          title: string;
          titleWords: string[];
          timestamp: number;
          messageCount: number;
          lastActivity: number;
        }>(),
        messages: new Map<string, {
          id: string;
          conversationId: string;
          content: string;
          contentWords: string[];
          sender: 'user' | 'ai';
          timestamp: number;
          hasCodeChanges: boolean;
        }>(),
        words: new Map<string, {
          conversations: Set<string>;
          messages: Set<string>;
        }>()
      };
      
      // Index conversations
      const conversations = await this.getConversations();
      for (const conversation of conversations) {
        const titleWords = this.extractWords(conversation.title);
        
        index.conversations.set(conversation.id, {
          id: conversation.id,
          title: conversation.title,
          titleWords,
          timestamp: conversation.timestamp,
          messageCount: conversation.metadata?.messageCount || 0,
          lastActivity: conversation.metadata?.lastActivity || conversation.timestamp
        });
        
        // Add words to word index
        for (const word of titleWords) {
          if (!index.words.has(word)) {
            index.words.set(word, { conversations: new Set(), messages: new Set() });
          }
          index.words.get(word)!.conversations.add(conversation.id);
        }
        
        // Index messages for this conversation
        const messages = await this.getMessages(conversation.id);
        for (const message of messages) {
          const contentWords = this.extractWords(message.content);
          
          index.messages.set(message.id, {
            id: message.id,
            conversationId: message.conversationId,
            content: message.content,
            contentWords,
            sender: message.sender,
            timestamp: message.timestamp,
            hasCodeChanges: message.codeChanges.length > 0
          });
          
          // Add words to word index
          for (const word of contentWords) {
            if (!index.words.has(word)) {
              index.words.set(word, { conversations: new Set(), messages: new Set() });
            }
            index.words.get(word)!.messages.add(message.id);
          }
        }
      }
      
      // Save index to disk
      await this.saveSearchIndex(index);
      
      console.log(`Search index built: ${index.conversations.size} conversations, ${index.messages.size} messages, ${index.words.size} unique words`);
    } catch (error) {
      throw new StorageError(`Failed to build search index: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Search using the built index for faster results
   */
  async searchWithIndex(query: string, options?: {
    type?: 'conversations' | 'messages' | 'both';
    maxResults?: number;
  }): Promise<{
    conversations: Conversation[];
    messages: Message[];
    totalMatches: number;
  }> {
    const searchOptions = {
      type: 'both' as const,
      maxResults: 100,
      ...options
    };
    
    try {
      const index = await this.loadSearchIndex();
      if (!index) {
        // Fallback to regular search if index doesn't exist
        const result = await this.searchConversations(query, { maxResults: searchOptions.maxResults });
        return {
          conversations: result.conversations.map(r => r.conversation),
          messages: [],
          totalMatches: result.totalMatches
        };
      }
      
      const queryWords = this.extractWords(query);
      const matchingConversationIds = new Set<string>();
      const matchingMessageIds = new Set<string>();
      
      // Find matching items using word index
      for (const word of queryWords) {
        const wordEntry = index.words.get(word);
        if (wordEntry) {
          if (searchOptions.type === 'conversations' || searchOptions.type === 'both') {
            wordEntry.conversations.forEach(id => matchingConversationIds.add(id));
          }
          if (searchOptions.type === 'messages' || searchOptions.type === 'both') {
            wordEntry.messages.forEach(id => matchingMessageIds.add(id));
          }
        }
      }
      
      // Load matching conversations
      const conversations: Conversation[] = [];
      for (const conversationId of matchingConversationIds) {
        const conversation = await this.getConversation(conversationId);
        if (conversation) {
          conversations.push(conversation);
        }
        if (conversations.length >= searchOptions.maxResults) {
          break;
        }
      }
      
      // Load matching messages
      const messages: Message[] = [];
      for (const messageId of matchingMessageIds) {
        const message = await this.getMessage(messageId);
        if (message) {
          messages.push(message);
        }
        if (messages.length >= searchOptions.maxResults) {
          break;
        }
      }
      
      return {
        conversations,
        messages,
        totalMatches: matchingConversationIds.size + matchingMessageIds.size
      };
    } catch (error) {
      throw new StorageError(`Failed to search with index: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Get conversation statistics and analytics
   */
  async getConversationAnalytics(conversationId?: string): Promise<{
    totalConversations: number;
    totalMessages: number;
    averageMessagesPerConversation: number;
    mostActiveDay: { date: string; count: number };
    messagesByType: { user: number; ai: number };
    conversationsByStatus: { active: number; archived: number };
    topWords: Array<{ word: string; count: number }>;
  }> {
    try {
      const conversations = conversationId 
        ? [await this.getConversation(conversationId)].filter(Boolean) as Conversation[]
        : await this.getConversations();
      
      let totalMessages = 0;
      const messagesByType = { user: 0, ai: 0 };
      const conversationsByStatus = { active: 0, archived: 0 };
      const dailyActivity = new Map<string, number>();
      const wordCounts = new Map<string, number>();
      
      for (const conversation of conversations) {
        // Count by status
        conversationsByStatus[conversation.status]++;
        
        // Get messages for this conversation
        const messages = await this.getMessages(conversation.id);
        totalMessages += messages.length;
        
        for (const message of messages) {
          // Count by sender type
          messagesByType[message.sender]++;
          
          // Track daily activity
          const date = new Date(message.timestamp).toISOString().split('T')[0];
          dailyActivity.set(date, (dailyActivity.get(date) || 0) + 1);
          
          // Count words in message content
          const words = this.extractWords(message.content);
          for (const word of words) {
            wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
          }
        }
      }
      
      // Find most active day
      let mostActiveDay = { date: '', count: 0 };
      for (const [date, count] of dailyActivity) {
        if (count > mostActiveDay.count) {
          mostActiveDay = { date, count };
        }
      }
      
      // Get top words
      const topWords = Array.from(wordCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([word, count]) => ({ word, count }));
      
      return {
        totalConversations: conversations.length,
        totalMessages,
        averageMessagesPerConversation: conversations.length > 0 ? totalMessages / conversations.length : 0,
        mostActiveDay,
        messagesByType,
        conversationsByStatus,
        topWords
      };
    } catch (error) {
      throw new StorageError(`Failed to get conversation analytics: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<{
    conversations: number;
    messages: number;
    snapshots: number;
    backups: number;
    totalSize: number;
  }> {
    try {
      const stats = {
        conversations: 0,
        messages: 0,
        snapshots: 0,
        backups: 0,
        totalSize: 0
      };
      
      // Count conversations
      const conversationFiles = await vscode.workspace.fs.readDirectory(vscode.Uri.file(this.conversationsDir));
      stats.conversations = conversationFiles.filter(([name]) => name.endsWith('.json')).length;
      
      // Count messages
      const messageFiles = await vscode.workspace.fs.readDirectory(vscode.Uri.file(this.messagesDir));
      stats.messages = messageFiles.filter(([name]) => name.endsWith('.json')).length;
      
      // Count snapshots
      const snapshotFiles = await vscode.workspace.fs.readDirectory(vscode.Uri.file(this.snapshotsDir));
      stats.snapshots = snapshotFiles.filter(([name]) => name.endsWith('.json') || name.length === 36).length; // UUID length
      
      // Count backups
      const backupFiles = await vscode.workspace.fs.readDirectory(vscode.Uri.file(this.backupsDir));
      stats.backups = backupFiles.length;
      
      // Calculate total size (approximate)
      const calculateDirSize = async (dirPath: string): Promise<number> => {
        let size = 0;
        try {
          const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dirPath));
          for (const [fileName, fileType] of files) {
            const filePath = path.join(dirPath, fileName);
            if (fileType === vscode.FileType.File) {
              const stat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
              size += stat.size;
            } else if (fileType === vscode.FileType.Directory) {
              size += await calculateDirSize(filePath);
            }
          }
        } catch {}
        return size;
      };
      
      stats.totalSize = await calculateDirSize(this.storageRoot);
      
      return stats;
    } catch (error) {
      throw new StorageError(`Failed to get storage statistics: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Helper method to check if text matches search query
   */
  private matchesSearchQuery(text: string, query: string, options: {
    caseSensitive?: boolean;
    useRegex?: boolean;
  }): boolean {
    try {
      if (options.useRegex) {
        const flags = options.caseSensitive ? 'g' : 'gi';
        const regex = new RegExp(query, flags);
        return regex.test(text);
      } else {
        const searchText = options.caseSensitive ? text : text.toLowerCase();
        const searchQuery = options.caseSensitive ? query : query.toLowerCase();
        return searchText.includes(searchQuery);
      }
    } catch (error) {
      // If regex is invalid, fall back to simple string search
      const searchText = options.caseSensitive ? text : text.toLowerCase();
      const searchQuery = options.caseSensitive ? query : query.toLowerCase();
      return searchText.includes(searchQuery);
    }
  }
  
  /**
   * Create a snippet around the matched text
   */
  private createSnippet(text: string, query: string, options: {
    caseSensitive?: boolean;
    useRegex?: boolean;
  }, maxLength: number = 200): string {
    try {
      const searchText = options.caseSensitive ? text : text.toLowerCase();
      const searchQuery = options.caseSensitive ? query : query.toLowerCase();
      
      let matchIndex: number;
      
      if (options.useRegex) {
        const flags = options.caseSensitive ? 'g' : 'gi';
        const regex = new RegExp(query, flags);
        const match = regex.exec(text);
        matchIndex = match ? match.index : -1;
      } else {
        matchIndex = searchText.indexOf(searchQuery);
      }
      
      if (matchIndex === -1) {
        return text.substring(0, maxLength) + (text.length > maxLength ? '...' : '');
      }
      
      // Calculate snippet boundaries
      const halfLength = Math.floor(maxLength / 2);
      const start = Math.max(0, matchIndex - halfLength);
      const end = Math.min(text.length, matchIndex + query.length + halfLength);
      
      let snippet = text.substring(start, end);
      
      // Add ellipsis if needed
      if (start > 0) {
        snippet = '...' + snippet;
      }
      if (end < text.length) {
        snippet = snippet + '...';
      }
      
      return snippet;
    } catch (error) {
      return text.substring(0, maxLength) + (text.length > maxLength ? '...' : '');
    }
  }
  
  /**
   * Sort conversations by specified criteria
   */
  private sortConversations(
    conversations: Conversation[], 
    sortBy: 'timestamp' | 'title' | 'messageCount' | 'lastActivity',
    sortOrder: 'asc' | 'desc'
  ): Conversation[] {
    return conversations.sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'timestamp':
          comparison = a.timestamp - b.timestamp;
          break;
        case 'title':
          comparison = a.title.localeCompare(b.title);
          break;
        case 'messageCount':
          const aCount = a.metadata?.messageCount || 0;
          const bCount = b.metadata?.messageCount || 0;
          comparison = aCount - bCount;
          break;
        case 'lastActivity':
          const aActivity = a.metadata?.lastActivity || a.timestamp;
          const bActivity = b.metadata?.lastActivity || b.timestamp;
          comparison = aActivity - bActivity;
          break;
      }
      
      return sortOrder === 'desc' ? -comparison : comparison;
    });
  }
  
  /**
   * Sort messages by specified criteria
   */
  private sortMessages(
    messages: Message[], 
    sortBy: 'timestamp' | 'sender' | 'content',
    sortOrder: 'asc' | 'desc'
  ): Message[] {
    return messages.sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'timestamp':
          comparison = a.timestamp - b.timestamp;
          break;
        case 'sender':
          comparison = a.sender.localeCompare(b.sender);
          break;
        case 'content':
          comparison = a.content.localeCompare(b.content);
          break;
      }
      
      return sortOrder === 'desc' ? -comparison : comparison;
    });
  }
  
  /**
   * Extract words from text for indexing
   */
  private extractWords(text: string): string[] {
    // Remove code blocks and special characters, then split into words
    const cleanText = text
      .replace(/```[\s\S]*?```/g, ' ') // Remove code blocks
      .replace(/`[^`]*`/g, ' ') // Remove inline code
      .replace(/[^\w\s]/g, ' ') // Remove special characters
      .toLowerCase();
    
    return cleanText
      .split(/\s+/)
      .filter(word => word.length > 2) // Filter out very short words
      .filter(word => !this.isStopWord(word)); // Filter out stop words
  }
  
  /**
   * Check if a word is a stop word (common words to ignore in search)
   */
  private isStopWord(word: string): boolean {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
      'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those',
      'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your',
      'his', 'her', 'its', 'our', 'their', 'what', 'when', 'where', 'why', 'how', 'who', 'which'
    ]);
    
    return stopWords.has(word);
  }
  
  /**
   * Save search index to disk
   */
  private async saveSearchIndex(index: {
    conversations: Map<string, any>;
    messages: Map<string, any>;
    words: Map<string, any>;
  }): Promise<void> {
    try {
      const indexData = {
        conversations: Object.fromEntries(index.conversations),
        messages: Object.fromEntries(index.messages),
        words: Object.fromEntries(
          Array.from(index.words.entries()).map(([word, data]) => [
            word,
            {
              conversations: Array.from(data.conversations),
              messages: Array.from(data.messages)
            }
          ])
        ),
        lastUpdated: Date.now()
      };
      
      const indexPath = path.join(this.indexDir, 'search-index.json');
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(indexPath), 
        Buffer.from(JSON.stringify(indexData, null, 2), 'utf8')
      );
    } catch (error) {
      console.warn('Failed to save search index:', error);
    }
  }
  
  /**
   * Load search index from disk
   */
  private async loadSearchIndex(): Promise<{
    conversations: Map<string, any>;
    messages: Map<string, any>;
    words: Map<string, { conversations: Set<string>; messages: Set<string> }>;
  } | null> {
    try {
      const indexPath = path.join(this.indexDir, 'search-index.json');
      const indexData = await vscode.workspace.fs.readFile(vscode.Uri.file(indexPath));
      const parsed = JSON.parse(indexData.toString());
      
      return {
        conversations: new Map(Object.entries(parsed.conversations)),
        messages: new Map(Object.entries(parsed.messages)),
        words: new Map(
          Object.entries(parsed.words).map(([word, data]: [string, any]) => [
            word,
            {
              conversations: new Set(data.conversations),
              messages: new Set(data.messages)
            }
          ])
        )
      };
    } catch (error) {
      return null; // Index doesn't exist or is corrupted
    }
  }
  
  /**
   * Copy entire directory recursively
   */
  private async copyDirectory(sourceDir: string, targetDir: string): Promise<void> {
    try {
      await this.ensureDirectoryExists(targetDir);
      
      const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(sourceDir));
      
      for (const [fileName, fileType] of files) {
        const sourcePath = path.join(sourceDir, fileName);
        const targetPath = path.join(targetDir, fileName);
        
        if (fileType === vscode.FileType.File) {
          const data = await vscode.workspace.fs.readFile(vscode.Uri.file(sourcePath));
          await vscode.workspace.fs.writeFile(vscode.Uri.file(targetPath), data);
        } else if (fileType === vscode.FileType.Directory) {
          await this.copyDirectory(sourcePath, targetPath);
        }
      }
    } catch (error) {
      // Source directory might not exist
      if (error instanceof Error && !error.message.includes('ENOENT')) {
        throw error;
      }
    }
  }
  
  /**
   * Backup only files that have changed since the specified timestamp
   */
  private async backupChangedFiles(sourceDir: string, targetDir: string, sinceTimestamp: number): Promise<number> {
    let changedFiles = 0;
    
    try {
      const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(sourceDir));
      
      for (const [fileName, fileType] of files) {
        const sourcePath = path.join(sourceDir, fileName);
        
        if (fileType === vscode.FileType.File) {
          const stat = await vscode.workspace.fs.stat(vscode.Uri.file(sourcePath));
          
          if (stat.mtime > sinceTimestamp) {
            const targetPath = path.join(targetDir, fileName);
            const data = await vscode.workspace.fs.readFile(vscode.Uri.file(sourcePath));
            await vscode.workspace.fs.writeFile(vscode.Uri.file(targetPath), data);
            changedFiles++;
          }
        } else if (fileType === vscode.FileType.Directory) {
          const subTargetDir = path.join(targetDir, fileName);
          await this.ensureDirectoryExists(subTargetDir);
          changedFiles += await this.backupChangedFiles(sourcePath, subTargetDir, sinceTimestamp);
        }
      }
    } catch (error) {
      // Source directory might not exist
      if (error instanceof Error && !error.message.includes('ENOENT')) {
        throw error;
      }
    }
    
    return changedFiles;
  }
  
  /**
   * Restore directory from backup
   */
  private async restoreDirectory(backupDir: string, targetDir: string): Promise<number> {
    let restoredFiles = 0;
    
    try {
      // Ensure target directory exists
      await this.ensureDirectoryExists(targetDir);
      
      const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(backupDir));
      
      for (const [fileName, fileType] of files) {
        const backupPath = path.join(backupDir, fileName);
        const targetPath = path.join(targetDir, fileName);
        
        if (fileType === vscode.FileType.File) {
          const data = await vscode.workspace.fs.readFile(vscode.Uri.file(backupPath));
          await vscode.workspace.fs.writeFile(vscode.Uri.file(targetPath), data);
          restoredFiles++;
        } else if (fileType === vscode.FileType.Directory) {
          restoredFiles += await this.restoreDirectory(backupPath, targetPath);
        }
      }
    } catch (error) {
      // Backup directory might not exist
      if (error instanceof Error && !error.message.includes('ENOENT')) {
        throw error;
      }
    }
    
    return restoredFiles;
  }
  
  /**
   * Calculate the total size of a directory
   */
  private async calculateDirectorySize(dirPath: string): Promise<number> {
    let totalSize = 0;
    
    try {
      const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dirPath));
      
      for (const [fileName, fileType] of files) {
        const filePath = path.join(dirPath, fileName);
        
        if (fileType === vscode.FileType.File) {
          const stat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
          totalSize += stat.size;
        } else if (fileType === vscode.FileType.Directory) {
          totalSize += await this.calculateDirectorySize(filePath);
        }
      }
    } catch (error) {
      // Directory might not exist
    }
    
    return totalSize;
  }
}