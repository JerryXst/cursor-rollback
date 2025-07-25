/**
 * Local file storage implementation for Cursor Companion
 * Handles file-based storage of conversations, messages, and snapshots
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { IDataStorage } from './interfaces';
import { 
  Conversation, 
  ConversationFilter, 
  Message, 
  MessageFilter,
  SnapshotCollection,
  FileSnapshot,
  StorageError,
  DataIntegrityError
} from '../models';
import { SerializationUtil } from '../utils/serialization';
import { 
  verifySnapshotIntegrity, 
  detectConversationCorruption, 
  detectMessageCorruption,
  repairConversation,
  verifyDataConsistency,
  assertDataValidity
} from '../utils/dataIntegrity';
import { DATA_INTEGRITY } from '../utils/constants';
import { calculateStrongChecksum } from '../utils/dataIntegrity';

/**
 * Local file-based storage implementation for conversation data
 * Implements comprehensive CRUD operations with data integrity and snapshot management
 */
export class LocalFileStorage implements IDataStorage {
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

  /**
   * Initialize the storage system
   * Creates necessary directories and performs startup checks
   */
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
      
      // Clean up temporary files from previous sessions
      await this.cleanupTempFiles();

      console.log('Cursor Companion: Local file storage initialized successfully');
    } catch (error) {
      throw new StorageError(`Failed to initialize local file storage: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Save a conversation
   * @param conversation The conversation to save
   */
  async saveConversation(conversation: Conversation): Promise<void> {
    return this.withFileLock(`conversation-${conversation.id}`, async () => {
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
        
        // Serialize conversation to JSON
        const serialized = SerializationUtil.serializeConversation(conversation, { prettyPrint: true });
        
        // Write to temporary file first
        const tempFilePath = path.join(this.tempDir, `${conversation.id}.json.tmp`);
        const finalFilePath = path.join(this.conversationsDir, `${conversation.id}.json`);
        
        await vscode.workspace.fs.writeFile(
          vscode.Uri.file(tempFilePath),
          Buffer.from(serialized, 'utf8')
        );
        
        // Move temporary file to final location (atomic operation)
        await this.moveFile(tempFilePath, finalFilePath);
        
        // Update cache
        this.conversationCache.set(conversation.id, conversation);
        
        // Update conversation index
        await this.updateConversationIndex(conversation);
        
      } catch (error) {
        throw new StorageError(`Failed to save conversation ${conversation.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  /**
   * Get all conversations with optional filtering
   * @param filter Optional filter criteria
   * @returns Array of conversations
   */
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

  /**
   * Get a specific conversation by ID
   * @param id Conversation ID
   * @returns The conversation or null if not found
   */
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

  /**
   * Delete a conversation and all associated data
   * @param id Conversation ID
   */
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
        
        // Remove from index
        await this.removeFromConversationIndex(id);
        
      } catch (error) {
        throw new StorageError(`Failed to delete conversation ${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  /**
   * Archive a conversation
   * @param id Conversation ID
   */
  async archiveConversation(id: string): Promise<void> {
    try {
      const conversation = await this.getConversation(id);
      if (conversation) {
        conversation.status = 'archived';
        await this.saveConversation(conversation);
      }
    } catch (error) {
      throw new StorageError(`Failed to archive conversation ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Save a message
   * @param message The message to save
   */
  async saveMessage(message: Message): Promise<void> {
    return this.withFileLock(`message-${message.id}`, async () => {
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
        
        // Serialize message to JSON
        const serialized = SerializationUtil.serializeMessage(message, { prettyPrint: true });
        
        // Write to temporary file first
        const tempFilePath = path.join(this.tempDir, `${message.id}.json.tmp`);
        const finalFilePath = path.join(this.messagesDir, `${message.id}.json`);
        
        await vscode.workspace.fs.writeFile(
          vscode.Uri.file(tempFilePath),
          Buffer.from(serialized, 'utf8')
        );
        
        // Move temporary file to final location (atomic operation)
        await this.moveFile(tempFilePath, finalFilePath);
        
        // Update cache
        this.messageCache.set(message.id, message);
        
        // Update message index
        await this.updateMessageIndex(message);
        
        // Update conversation to include this message if needed
        await this.addMessageToConversation(message);
        
      } catch (error) {
        throw new StorageError(`Failed to save message ${message.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  /**
   * Get messages for a conversation
   * @param conversationId Conversation ID
   * @param filter Optional filter criteria
   * @returns Array of messages
   */
  async getMessages(conversationId: string, filter?: MessageFilter): Promise<Message[]> {
    try {
      const conversation = await this.getConversation(conversationId);
      if (!conversation) {
        return [];
      }
      
      const messages: Message[] = [];
      
      // Load each message by ID
      for (const message of conversation.messages) {
        try {
          if (message && this.matchesMessageFilter(message, filter)) {
            messages.push(message);
          }
        } catch (error) {
          console.warn(`Failed to load message ${message.conversationId}:`, error);
        }
      }
      
      // Sort by timestamp (oldest first)
      return messages.sort((a, b) => a.timestamp - b.timestamp);
    } catch (error) {
      throw new StorageError(`Failed to get messages for conversation ${conversationId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get a specific message by ID
   * @param id Message ID
   * @returns The message or null if not found
   */
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

  /**
   * Save a snapshot collection
   * @param snapshot The snapshot collection to save
   */
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

  /**
   * Get snapshot by message ID
   * @param messageId Message ID
   * @returns The snapshot collection or null if not found
   */
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

  /**
   * Clean up old data
   * @param olderThanDays Delete data older than this many days
   */
  async cleanup(olderThanDays: number): Promise<void> {
    const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    
    try {
      // Clean up old conversations
      await this.cleanupDirectory(this.conversationsDir, cutoffTime);
      await this.cleanupDirectory(this.messagesDir, cutoffTime);
      await this.cleanupDirectory(this.snapshotsDir, cutoffTime);
      await this.cleanupDirectory(this.backupsDir, cutoffTime);
      
      // Clear caches for deleted items
      this.clearCachesForOldItems(cutoffTime);
      
    } catch (error) {
      throw new StorageError(`Failed to cleanup old data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Verify data integrity of all stored conversations
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
        
        // Backup snapshots for this message
        const snapshot = await this.getSnapshot(message.id);
        if (snapshot) {
          const snapshotBackupPath = path.join(backupDir, `snapshot-${snapshot.id}.json`);
          const snapshotData = SerializationUtil.serializeSnapshot(snapshot, { prettyPrint: true });
          await vscode.workspace.fs.writeFile(vscode.Uri.file(snapshotBackupPath), Buffer.from(snapshotData, 'utf8'));
        }
      }
      
      // Create backup metadata
      const metadata = {
        id: backupId,
        conversationId,
        timestamp: Date.now(),
        messageCount: messages.length
      };
      
      const metadataPath = path.join(backupDir, 'metadata.json');
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(metadataPath), 
        Buffer.from(JSON.stringify(metadata, null, 2), 'utf8')
      );
      
      return backupId;
    } catch (error) {
      throw new StorageError(
        `Failed to create backup for conversation ${conversationId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  
  /**
   * Migrate all data to the current schema version
   * @param options Migration options
   */
  async migrateData(options?: {
    createBackups?: boolean;
    progressCallback?: (current: number, total: number) => void;
  }): Promise<any> {
    // This is a placeholder for actual migration logic
    // In a real implementation, this would use the DataMigration utilities
    return { success: true, migratedItems: 0 };
  }

  // Private helper methods

  /**
   * Ensure a directory exists
   * @param dirPath Directory path
   */
  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(dirPath));
    } catch {
      // Directory doesn't exist, create it
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
    }
  }

  /**
   * Initialize storage metadata
   */
  private async initializeStorageMetadata(): Promise<void> {
    const metadataPath = path.join(this.storageRoot, 'metadata.json');
    
    try {
      // Check if metadata file exists
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(metadataPath));
        return; // Metadata already exists
      } catch {
        // Metadata doesn't exist, create it
      }
      
      const metadata = {
        version: '1.0.0',
        created: Date.now(),
        lastAccess: Date.now()
      };
      
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(metadataPath),
        Buffer.from(JSON.stringify(metadata, null, 2), 'utf8')
      );
    } catch (error) {
      console.error('Failed to initialize storage metadata:', error);
      // Non-critical error, continue without metadata
    }
  }

  /**
   * Clean up temporary files
   */
  private async cleanupTempFiles(): Promise<void> {
    try {
      const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(this.tempDir));
      
      for (const [fileName] of files) {
        try {
          const filePath = path.join(this.tempDir, fileName);
          await vscode.workspace.fs.delete(vscode.Uri.file(filePath));
        } catch (error) {
          console.warn(`Failed to delete temporary file ${fileName}:`, error);
        }
      }
    } catch (error) {
      console.error('Failed to cleanup temporary files:', error);
      // Non-critical error, continue without cleanup
    }
  }

  /**
   * Move a file (atomic operation if possible)
   * @param sourcePath Source file path
   * @param targetPath Target file path
   */
  private async moveFile(sourcePath: string, targetPath: string): Promise<void> {
    try {
      // Read source file
      const data = await vscode.workspace.fs.readFile(vscode.Uri.file(sourcePath));
      
      // Write to target file
      await vscode.workspace.fs.writeFile(vscode.Uri.file(targetPath), data);
      
      // Delete source file
      await vscode.workspace.fs.delete(vscode.Uri.file(sourcePath));
    } catch (error) {
      throw new Error(`Failed to move file from ${sourcePath} to ${targetPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check if a conversation matches the filter criteria
   * @param conversation The conversation to check
   * @param filter Filter criteria
   * @returns Whether the conversation matches the filter
   */
  private matchesFilter(conversation: Conversation, filter?: ConversationFilter): boolean {
    if (!filter) {
      return true;
    }
    
    // Check status
    if (filter.status && filter.status !== 'all') {
      if (conversation.status !== filter.status) {
        return false;
      }
    }
    
    // Check search query
    if (filter.searchQuery && filter.searchQuery.trim() !== '') {
      const query = filter.searchQuery.toLowerCase();
      const title = conversation.title.toLowerCase();
      
      if (!title.includes(query)) {
        return false;
      }
    }
    
    // Check tags
    if (filter.tags && filter.tags.length > 0) {
      const conversationTags = conversation.metadata?.tags || [];
      
      // Check if conversation has at least one of the filter tags
      if (!filter.tags.some(tag => conversationTags.includes(tag))) {
        return false;
      }
    }
    
    // Check date range
    if (filter.dateRange) {
      if (conversation.timestamp < filter.dateRange.start || conversation.timestamp > filter.dateRange.end) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Check if a message matches the filter criteria
   * @param message The message to check
   * @param filter Filter criteria
   * @returns Whether the message matches the filter
   */
  private matchesMessageFilter(message: Message, filter?: MessageFilter): boolean {
    if (!filter) {
      return true;
    }
    
    // Check conversation ID
    if (filter.conversationId && message.conversationId !== filter.conversationId) {
      return false;
    }
    
    // Check sender
    if (filter.sender && filter.sender !== 'all' && message.sender !== filter.sender) {
      return false;
    }
    
    // Check search query
    if (filter.searchQuery && filter.searchQuery.trim() !== '') {
      const query = filter.searchQuery.toLowerCase();
      const content = message.content.toLowerCase();
      
      if (!content.includes(query)) {
        return false;
      }
    }
    
    // Check if has code changes
    if (filter.hasCodeChanges !== undefined) {
      const hasChanges = Array.isArray(message.codeChanges) && message.codeChanges.length > 0;
      
      if (filter.hasCodeChanges !== hasChanges) {
        return false;
      }
    }
    
    // Check date range
    if (filter.dateRange) {
      if (message.timestamp < filter.dateRange.start || message.timestamp > filter.dateRange.end) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Delete all messages for a conversation
   * @param conversationId Conversation ID
   */
  private async deleteConversationMessages(conversationId: string): Promise<void> {
    try {
      const conversation = await this.getConversation(conversationId);
      if (!conversation) {
        return;
      }
      
      // Delete each message
      for (const message of conversation.messages) {
        const messageId = message.id;
        try {
          const messagePath = path.join(this.messagesDir, `${message.id}.json`);
          await vscode.workspace.fs.delete(vscode.Uri.file(messagePath));
          
          // Clear from cache
          this.messageCache.delete(messageId);
          
          // Remove from index
          await this.removeFromMessageIndex(messageId);
        } catch (error) {
          console.warn(`Failed to delete message ${messageId}:`, error);
        }
      }
    } catch (error) {
      throw new StorageError(`Failed to delete conversation messages for ${conversationId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Delete all snapshots for a conversation
   * @param conversationId Conversation ID
   */
  private async deleteConversationSnapshots(conversationId: string): Promise<void> {
    try {
      const conversation = await this.getConversation(conversationId);
      if (!conversation) {
        return;
      }
      
      // Get all messages for this conversation
      for (const message of conversation.messages) {
        const messageId = message.id;
        try {
          // Get snapshot for this message
          const snapshot = await this.getSnapshot(messageId);
          if (snapshot) {
            // Delete snapshot
            const snapshotPath = path.join(this.snapshotsDir, `${snapshot.id}.json`);
            await vscode.workspace.fs.delete(vscode.Uri.file(snapshotPath));
            
            // Clear from cache
            this.snapshotCache.delete(snapshot.id);
            
            // Remove from index
            await this.removeFromSnapshotIndex(snapshot.id);
          }
        } catch (error) {
          console.warn(`Failed to delete snapshot for message ${messageId}:`, error);
        }
      }
    } catch (error) {
      throw new StorageError(`Failed to delete conversation snapshots for ${conversationId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get a snapshot by ID
   * @param id Snapshot ID
   * @returns The snapshot collection or null if not found
   */
  private async getSnapshotById(id: string): Promise<SnapshotCollection | null> {
    try {
      // Check cache first
      if (this.snapshotCache.has(id)) {
        return this.snapshotCache.get(id)!;
      }
      
      const filePath = path.join(this.snapshotsDir, `${id}.json`);
      const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      const snapshot = SerializationUtil.deserializeSnapshot(data.toString(), { 
        autoMigrate: true,
        validate: true 
      });
      
      // Cache the result
      this.snapshotCache.set(id, snapshot);
      return snapshot;
    } catch (error) {
      if (error instanceof StorageError) {
        console.error(`Error deserializing snapshot ${id}:`, error);
      }
      return null;
    }
  }

  /**
   * Get a snapshot by message ID using directory scan
   * @param messageId Message ID
   * @returns The snapshot collection or null if not found
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
              autoMigrate: false,
              validate: false
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
      throw new StorageError(`Failed to get snapshot for message ${messageId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check if a snapshot collection should use optimized storage
   * @param snapshot The snapshot collection
   * @returns Whether to use optimized storage
   */
  private shouldUseOptimizedStorage(snapshot: SnapshotCollection): boolean {
    // Use optimized storage if the total size is large
    let totalSize = 0;
    
    for (const fileSnapshot of snapshot.snapshots) {
      totalSize += fileSnapshot.content.length;
    }
    
    // Use optimized storage if total size is over 1MB
    return totalSize > 1024 * 1024;
  }

  /**
   * Save a snapshot collection using standard storage
   * @param snapshot The snapshot collection
   */
  private async saveSnapshotStandard(snapshot: SnapshotCollection): Promise<void> {
    // Serialize snapshot to JSON
    const serialized = SerializationUtil.serializeSnapshot(snapshot, { prettyPrint: true });
    
    // Write to temporary file first
    const tempFilePath = path.join(this.tempDir, `${snapshot.id}.json.tmp`);
    const finalFilePath = path.join(this.snapshotsDir, `${snapshot.id}.json`);
    
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(tempFilePath),
      Buffer.from(serialized, 'utf8')
    );
    
    // Move temporary file to final location (atomic operation)
    await this.moveFile(tempFilePath, finalFilePath);
  }

  /**
   * Save a snapshot collection using optimized storage (split into multiple files)
   * @param snapshot The snapshot collection
   */
  private async saveSnapshotOptimized(snapshot: SnapshotCollection): Promise<void> {
    // Create snapshot directory
    const snapshotDir = path.join(this.snapshotsDir, snapshot.id);
    await this.ensureDirectoryExists(snapshotDir);
    
    // Create manifest with metadata but without file contents
    const manifest: SnapshotCollection = {
      ...snapshot,
      snapshots: snapshot.snapshots.map(fileSnapshot => ({
        ...fileSnapshot,
        content: '', // Don't include content in manifest
        metadata: {
          ...fileSnapshot.metadata,
          contentFile: `${this.getContentFileName(fileSnapshot)}` // Add reference to content file
        }
      }))
    };
    
    // Save manifest
    const manifestPath = path.join(snapshotDir, 'manifest.json');
    const manifestData = JSON.stringify(manifest, null, 2);
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(manifestPath),
      Buffer.from(manifestData, 'utf8')
    );
    
    // Save each file snapshot separately
    for (const fileSnapshot of snapshot.snapshots) {
      const contentFileName = this.getContentFileName(fileSnapshot);
      const contentFilePath = path.join(snapshotDir, contentFileName);
      
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(contentFilePath),
        Buffer.from(fileSnapshot.content, 'utf8')
      );
    }
    
    // Create reference file in main snapshots directory
    const referenceData = JSON.stringify({
      id: snapshot.id,
      messageId: snapshot.messageId,
      timestamp: snapshot.timestamp,
      isOptimized: true,
      path: snapshotDir
    }, null, 2);
    
    const referencePath = path.join(this.snapshotsDir, `${snapshot.id}.json`);
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(referencePath),
      Buffer.from(referenceData, 'utf8')
    );
  }

  /**
   * Get a safe file name for snapshot content
   * @param snapshot The file snapshot
   * @returns Safe file name
   */
  private getContentFileName(snapshot: FileSnapshot): string {
    // Create a safe file name based on file path
    const safeName = snapshot.filePath
      .replace(/[^a-zA-Z0-9_.-]/g, '_') // Replace invalid chars
      .replace(/^_+|_+$/g, ''); // Trim leading/trailing underscores
    
    // Add checksum to ensure uniqueness
    return `${safeName}-${snapshot.checksum.substring(0, 8)}`;
  }

  /**
   * Update the conversation index
   * @param conversation The conversation to index
   */
  private async updateConversationIndex(conversation: Conversation): Promise<void> {
    try {
      const indexPath = path.join(this.indexDir, 'conversations.json');
      let index: Record<string, any> = {};
      
      // Load existing index if it exists
      try {
        const data = await vscode.workspace.fs.readFile(vscode.Uri.file(indexPath));
        index = JSON.parse(data.toString());
      } catch {
        // Index doesn't exist yet
      }
      
      // Update index
      index[conversation.id] = {
        id: conversation.id,
        title: conversation.title,
        timestamp: conversation.timestamp,
        status: conversation.status,
        messageCount: conversation.messages.length,
        lastUpdated: Date.now()
      };
      
      // Save index
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(indexPath),
        Buffer.from(JSON.stringify(index, null, 2), 'utf8')
      );
    } catch (error) {
      console.warn(`Failed to update conversation index for ${conversation.id}:`, error);
      // Non-critical error, continue without updating index
    }
  }

  /**
   * Remove a conversation from the index
   * @param id Conversation ID
   */
  private async removeFromConversationIndex(id: string): Promise<void> {
    try {
      const indexPath = path.join(this.indexDir, 'conversations.json');
      
      // Load existing index if it exists
      try {
        const data = await vscode.workspace.fs.readFile(vscode.Uri.file(indexPath));
        const index = JSON.parse(data.toString());
        
        // Remove from index
        delete index[id];
        
        // Save index
        await vscode.workspace.fs.writeFile(
          vscode.Uri.file(indexPath),
          Buffer.from(JSON.stringify(index, null, 2), 'utf8')
        );
      } catch {
        // Index doesn't exist yet
      }
    } catch (error) {
      console.warn(`Failed to remove conversation ${id} from index:`, error);
      // Non-critical error, continue without updating index
    }
  }

  /**
   * Update the message index
   * @param message The message to index
   */
  private async updateMessageIndex(message: Message): Promise<void> {
    try {
      const indexPath = path.join(this.indexDir, 'messages.json');
      let index: Record<string, any> = {};
      
      // Load existing index if it exists
      try {
        const data = await vscode.workspace.fs.readFile(vscode.Uri.file(indexPath));
        index = JSON.parse(data.toString());
      } catch {
        // Index doesn't exist yet
      }
      
      // Update index
      index[message.id] = {
        id: message.id,
        conversationId: message.conversationId,
        timestamp: message.timestamp,
        sender: message.sender,
        hasCodeChanges: Array.isArray(message.codeChanges) && message.codeChanges.length > 0,
        hasSnapshot: Array.isArray(message.snapshot) && message.snapshot.length > 0,
        lastUpdated: Date.now()
      };
      
      // Save index
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(indexPath),
        Buffer.from(JSON.stringify(index, null, 2), 'utf8')
      );
    } catch (error) {
      console.warn(`Failed to update message index for ${message.id}:`, error);
      // Non-critical error, continue without updating index
    }
  }

  /**
   * Remove a message from the index
   * @param id Message ID
   */
  private async removeFromMessageIndex(id: string): Promise<void> {
    try {
      const indexPath = path.join(this.indexDir, 'messages.json');
      
      // Load existing index if it exists
      try {
        const data = await vscode.workspace.fs.readFile(vscode.Uri.file(indexPath));
        const index = JSON.parse(data.toString());
        
        // Remove from index
        delete index[id];
        
        // Save index
        await vscode.workspace.fs.writeFile(
          vscode.Uri.file(indexPath),
          Buffer.from(JSON.stringify(index, null, 2), 'utf8')
        );
      } catch {
        // Index doesn't exist yet
      }
    } catch (error) {
      console.warn(`Failed to remove message ${id} from index:`, error);
      // Non-critical error, continue without updating index
    }
  }

  /**
   * Update the snapshot index
   * @param snapshot The snapshot to index
   */
  private async updateSnapshotIndex(snapshot: SnapshotCollection): Promise<void> {
    try {
      const indexPath = path.join(this.indexDir, 'snapshots.json');
      let index: Record<string, any> = {};
      
      // Load existing index if it exists
      try {
        const data = await vscode.workspace.fs.readFile(vscode.Uri.file(indexPath));
        index = JSON.parse(data.toString());
      } catch {
        // Index doesn't exist yet
      }
      
      // Update index
      index[snapshot.id] = {
        id: snapshot.id,
        messageId: snapshot.messageId,
        timestamp: snapshot.timestamp,
        fileCount: snapshot.snapshots.length,
        lastUpdated: Date.now()
      };
      
      // Also index by message ID for faster lookup
      if (!index.messageIdMap) {
        index.messageIdMap = {};
      }
      
      index.messageIdMap[snapshot.messageId] = snapshot.id;
      
      // Save index
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(indexPath),
        Buffer.from(JSON.stringify(index, null, 2), 'utf8')
      );
    } catch (error) {
      console.warn(`Failed to update snapshot index for ${snapshot.id}:`, error);
      // Non-critical error, continue without updating index
    }
  }

  /**
   * Remove a snapshot from the index
   * @param id Snapshot ID
   */
  private async removeFromSnapshotIndex(id: string): Promise<void> {
    try {
      const indexPath = path.join(this.indexDir, 'snapshots.json');
      
      // Load existing index if it exists
      try {
        const data = await vscode.workspace.fs.readFile(vscode.Uri.file(indexPath));
        const index = JSON.parse(data.toString());
        
        // Find message ID for this snapshot
        let messageId: string | undefined;
        
        if (index[id] && index[id].messageId) {
          messageId = index[id].messageId;
        }
        
        // Remove from index
        delete index[id];
        
        // Remove from message ID map
        if (messageId && index.messageIdMap && index.messageIdMap[messageId]) {
          delete index.messageIdMap[messageId];
        }
        
        // Save index
        await vscode.workspace.fs.writeFile(
          vscode.Uri.file(indexPath),
          Buffer.from(JSON.stringify(index, null, 2), 'utf8')
        );
      } catch {
        // Index doesn't exist yet
      }
    } catch (error) {
      console.warn(`Failed to remove snapshot ${id} from index:`, error);
      // Non-critical error, continue without updating index
    }
  }

  /**
   * Get snapshot ID by message ID using index
   * @param messageId Message ID
   * @returns Snapshot ID or undefined if not found
   */
  private async getSnapshotIdByMessageId(messageId: string): Promise<string | undefined> {
    try {
      const indexPath = path.join(this.indexDir, 'snapshots.json');
      
      // Load existing index if it exists
      try {
        const data = await vscode.workspace.fs.readFile(vscode.Uri.file(indexPath));
        const index = JSON.parse(data.toString());
        
        // Check message ID map
        if (index.messageIdMap && index.messageIdMap[messageId]) {
          return index.messageIdMap[messageId];
        }
      } catch {
        // Index doesn't exist yet
      }
      
      return undefined;
    } catch (error) {
      console.warn(`Failed to get snapshot ID for message ${messageId}:`, error);
      return undefined;
    }
  }

  /**
   * Clean up a directory by deleting files older than a cutoff time
   * @param dirPath Directory path
   * @param cutoffTime Cutoff timestamp
   * @returns Number of files deleted
   */
  private async cleanupDirectory(dirPath: string, cutoffTime: number): Promise<number> {
    try {
      const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dirPath));
      let deletedCount = 0;
      
      for (const [fileName, fileType] of files) {
        try {
          if (fileType === vscode.FileType.File) {
            const filePath = path.join(dirPath, fileName);
            const stat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
            
            // Check if file is older than cutoff
            if (stat.mtime < cutoffTime) {
              await vscode.workspace.fs.delete(vscode.Uri.file(filePath));
              deletedCount++;
            }
          } else if (fileType === vscode.FileType.Directory) {
            // Recursively clean up subdirectories
            const subdirPath = path.join(dirPath, fileName);
            deletedCount += await this.cleanupDirectory(subdirPath, cutoffTime);
            
            // Delete empty directory
            try {
              const contents = await vscode.workspace.fs.readDirectory(vscode.Uri.file(subdirPath));
              if (contents.length === 0) {
                await vscode.workspace.fs.delete(vscode.Uri.file(subdirPath));
              }
            } catch {
              // Ignore errors when checking if directory is empty
            }
          }
        } catch (error) {
          console.warn(`Failed to process file ${fileName} during cleanup:`, error);
        }
      }
      
      return deletedCount;
    } catch (error) {
      console.error(`Failed to cleanup directory ${dirPath}:`, error);
      return 0;
    }
  }

  /**
   * Clear caches for items older than a cutoff time
   * @param cutoffTime Cutoff timestamp
   */
  private clearCachesForOldItems(cutoffTime: number): void {
    // Clear conversation cache
    for (const [id, conversation] of this.conversationCache.entries()) {
      if (conversation.timestamp < cutoffTime) {
        this.conversationCache.delete(id);
      }
    }
    
    // Clear message cache
    for (const [id, message] of this.messageCache.entries()) {
      if (message.timestamp < cutoffTime) {
        this.messageCache.delete(id);
      }
    }
    
    // Clear snapshot cache
    for (const [id, snapshot] of this.snapshotCache.entries()) {
      if (snapshot.timestamp < cutoffTime) {
        this.snapshotCache.delete(id);
      }
    }
  }

  /**
   * Add a message to its conversation
   * @param message The message to add
   */
  private async addMessageToConversation(message: Message): Promise<void> {
    try {
      const conversation = await this.getConversation(message.conversationId);
      if (!conversation) {
        console.warn(`Cannot add message ${message.id} to non-existent conversation ${message.conversationId}`);
        return;
      }
      
      // Check if message is already in conversation
      if (conversation.messages.includes(message)) {
        return;
      }
      
      // Add message to conversation
      conversation.messages.push(message);
      
      // Update metadata
      if (!conversation.metadata) {
        conversation.metadata = {
          messageCount: conversation.messages.length,
          lastActivity: message.timestamp
        };
      } else {
        conversation.metadata.messageCount = conversation.messages.length;
        conversation.metadata.lastActivity = Math.max(conversation.metadata.lastActivity || 0, message.timestamp);
      }
      
      // Save conversation
      await this.saveConversation(conversation);
    } catch (error) {
      console.warn(`Failed to add message ${message.id} to conversation ${message.conversationId}:`, error);
    }
  }

  /**
   * Execute a function with a file lock to prevent concurrent access
   * @param lockKey Lock key
   * @param fn Function to execute
   * @returns Function result
   */
  private async withFileLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
    // Check if there's an existing lock
    const existingLock = this.fileLocks.get(lockKey);
    if (existingLock) {
      // Wait for existing lock to release
      await existingLock;
    }
    
    // Create a new lock
    let releaseLock: () => void;
    const lockPromise = new Promise<void>(resolve => {
      releaseLock = resolve;
    });
    
    this.fileLocks.set(lockKey, lockPromise);
    
    try {
      // Execute the function
      return await fn();
    } finally {
      // Release the lock
      releaseLock!();
      this.fileLocks.delete(lockKey);
    }
  }
}