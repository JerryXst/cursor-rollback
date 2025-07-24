/**
 * Backup and recovery functionality for Cursor Companion
 * Provides automated and manual backup/restore capabilities
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { IDataStorage } from './interfaces';
import { StorageError } from '../models/errors';

/**
 * Backup metadata
 */
export interface BackupMetadata {
  /** Unique identifier for this backup */
  id: string;
  
  /** When this backup was created */
  timestamp: number;
  
  /** Type of backup */
  type: 'manual' | 'auto' | 'pre-restore';
  
  /** Optional description */
  description?: string;
  
  /** Statistics about the backup */
  stats: {
    /** Number of conversations */
    conversationCount: number;
    
    /** Number of messages */
    messageCount: number;
    
    /** Number of snapshots */
    snapshotCount: number;
    
    /** Total size in bytes */
    totalSize: number;
  };
}

/**
 * Backup options
 */
export interface BackupOptions {
  /** Description for this backup */
  description?: string;
  
  /** Whether to include conversations */
  includeConversations?: boolean;
  
  /** Whether to include messages */
  includeMessages?: boolean;
  
  /** Whether to include snapshots */
  includeSnapshots?: boolean;
  
  /** Whether to include indexes */
  includeIndexes?: boolean;
  
  /** Specific conversation IDs to backup (if not provided, all conversations are included) */
  conversationIds?: string[];
  
  /** Progress callback */
  progress?: vscode.Progress<{ message?: string; increment?: number }>;
}

/**
 * Restore options
 */
export interface RestoreOptions {
  /** Whether to create a backup before restore */
  createBackupBeforeRestore?: boolean;
  
  /** Whether to include conversations */
  includeConversations?: boolean;
  
  /** Whether to include messages */
  includeMessages?: boolean;
  
  /** Whether to include snapshots */
  includeSnapshots?: boolean;
  
  /** Whether to include indexes */
  includeIndexes?: boolean;
  
  /** Specific conversation IDs to restore (if not provided, all conversations are restored) */
  conversationIds?: string[];
  
  /** Progress callback */
  progress?: vscode.Progress<{ message?: string; increment?: number }>;
}

/**
 * Restore result
 */
export interface RestoreResult {
  /** Whether the restore was successful */
  success: boolean;
  
  /** Number of items restored */
  restoredItems: number;
  
  /** Errors that occurred during restore */
  errors: string[];
  
  /** ID of backup created before restore (if applicable) */
  preRestoreBackupId?: string;
}

/**
 * Backup manager service for data backup and recovery
 */
export class BackupManager {
  private readonly backupsDir: string;
  private readonly autoBackupInterval: NodeJS.Timeout | null = null;
  
  constructor(
    private storage: IDataStorage,
    private context: vscode.ExtensionContext,
    private options: {
      /** Whether to enable automatic backups */
      enableAutoBackups?: boolean;
      
      /** Interval for automatic backups (in minutes) */
      autoBackupIntervalMinutes?: number;
      
      /** Maximum number of automatic backups to keep */
      maxAutoBackups?: number;
    } = {}
  ) {
    this.backupsDir = path.join(context.globalStorageUri.fsPath, 'cursor-companion', 'backups');
    
    // Set default options
    this.options = {
      enableAutoBackups: options.enableAutoBackups ?? true,
      autoBackupIntervalMinutes: options.autoBackupIntervalMinutes ?? 60, // 1 hour
      maxAutoBackups: options.maxAutoBackups ?? 10
    };
  }
  
  /**
   * Initialize the backup manager
   */
  async initialize(): Promise<void> {
    try {
      // Ensure backup directory exists
      await this.ensureDirectoryExists(this.backupsDir);
      
      // Start automatic backup schedule if enabled
      if (this.options.enableAutoBackups) {
        this.startAutoBackupSchedule();
      }
    } catch (error) {
      console.error('Failed to initialize backup manager:', error);
    }
  }
  
  /**
   * Create a backup
   * @param options Backup options
   * @returns Backup ID
   */
  async createBackup(options: BackupOptions = {}): Promise<string> {
    try {
      // Generate backup ID
      const backupId = `backup-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const backupDir = path.join(this.backupsDir, backupId);
      
      // Set default options
      const backupOptions: Required<BackupOptions> = {
        description: options.description || 'Manual backup',
        includeConversations: options.includeConversations ?? true,
        includeMessages: options.includeMessages ?? true,
        includeSnapshots: options.includeSnapshots ?? true,
        includeIndexes: options.includeIndexes ?? true,
        conversationIds: options.conversationIds || [],
        progress: options.progress || undefined
      };
      
      // Create backup directory structure
      await this.ensureDirectoryExists(backupDir);
      await this.ensureDirectoryExists(path.join(backupDir, 'conversations'));
      await this.ensureDirectoryExists(path.join(backupDir, 'messages'));
      await this.ensureDirectoryExists(path.join(backupDir, 'snapshots'));
      await this.ensureDirectoryExists(path.join(backupDir, 'indexes'));
      
      // Report progress
      if (backupOptions.progress) {
        backupOptions.progress.report({ message: 'Preparing backup...' });
      }
      
      // Get conversations to backup
      let conversations = await this.storage.getConversations();
      
      // Filter conversations if specific IDs are provided
      if (backupOptions.conversationIds.length > 0) {
        conversations = conversations.filter(c => backupOptions.conversationIds!.includes(c.id));
      }
      
      // Initialize stats
      const stats = {
        conversationCount: 0,
        messageCount: 0,
        snapshotCount: 0,
        totalSize: 0
      };
      
      // Backup conversations
      if (backupOptions.includeConversations) {
        if (backupOptions.progress) {
          backupOptions.progress.report({ message: 'Backing up conversations...' });
        }
        
        for (let i = 0; i < conversations.length; i++) {
          const conversation = conversations[i];
          
          // Report progress
          if (backupOptions.progress) {
            backupOptions.progress.report({
              message: `Backing up conversation ${i + 1}/${conversations.length}...`,
              increment: 100 / (conversations.length * 3) // Divide by 3 for conversations, messages, snapshots
            });
          }
          
          // Backup conversation
          const conversationPath = path.join(backupDir, 'conversations', `${conversation.id}.json`);
          const conversationData = JSON.stringify(conversation, null, 2);
          await vscode.workspace.fs.writeFile(
            vscode.Uri.file(conversationPath),
            Buffer.from(conversationData, 'utf8')
          );
          
          stats.conversationCount++;
          stats.totalSize += conversationData.length;
        }
      }
      
      // Backup messages
      if (backupOptions.includeMessages) {
        if (backupOptions.progress) {
          backupOptions.progress.report({ message: 'Backing up messages...' });
        }
        
        for (let i = 0; i < conversations.length; i++) {
          const conversation = conversations[i];
          
          // Report progress
          if (backupOptions.progress) {
            backupOptions.progress.report({
              message: `Backing up messages for conversation ${i + 1}/${conversations.length}...`,
              increment: 100 / (conversations.length * 3)
            });
          }
          
          // Get messages for this conversation
          const messages = await this.storage.getMessages(conversation.id);
          
          // Backup messages
          for (const message of messages) {
            const messagePath = path.join(backupDir, 'messages', `${message.id}.json`);
            const messageData = JSON.stringify(message, null, 2);
            await vscode.workspace.fs.writeFile(
              vscode.Uri.file(messagePath),
              Buffer.from(messageData, 'utf8')
            );
            
            stats.messageCount++;
            stats.totalSize += messageData.length;
          }
        }
      }
      
      // Backup snapshots
      if (backupOptions.includeSnapshots) {
        if (backupOptions.progress) {
          backupOptions.progress.report({ message: 'Backing up snapshots...' });
        }
        
        for (let i = 0; i < conversations.length; i++) {
          const conversation = conversations[i];
          
          // Report progress
          if (backupOptions.progress) {
            backupOptions.progress.report({
              message: `Backing up snapshots for conversation ${i + 1}/${conversations.length}...`,
              increment: 100 / (conversations.length * 3)
            });
          }
          
          // Get messages for this conversation
          const messages = await this.storage.getMessages(conversation.id);
          
          // Backup snapshots for each message
          for (const message of messages) {
            const snapshot = await this.storage.getSnapshot(message.id);
            
            if (snapshot) {
              const snapshotPath = path.join(backupDir, 'snapshots', `${snapshot.id}.json`);
              const snapshotData = JSON.stringify(snapshot, null, 2);
              await vscode.workspace.fs.writeFile(
                vscode.Uri.file(snapshotPath),
                Buffer.from(snapshotData, 'utf8')
              );
              
              stats.snapshotCount++;
              stats.totalSize += snapshotData.length;
            }
          }
        }
      }
      
      // Backup indexes
      if (backupOptions.includeIndexes) {
        if (backupOptions.progress) {
          backupOptions.progress.report({ message: 'Backing up indexes...' });
        }
        
        const indexesDir = path.join(this.context.globalStorageUri.fsPath, 'cursor-companion', 'indexes');
        
        try {
          // Check if indexes directory exists
          await vscode.workspace.fs.stat(vscode.Uri.file(indexesDir));
          
          // Copy index files
          const indexFiles = await vscode.workspace.fs.readDirectory(vscode.Uri.file(indexesDir));
          
          for (const [fileName, fileType] of indexFiles) {
            if (fileType === vscode.FileType.File) {
              const sourcePath = path.join(indexesDir, fileName);
              const targetPath = path.join(backupDir, 'indexes', fileName);
              
              const data = await vscode.workspace.fs.readFile(vscode.Uri.file(sourcePath));
              await vscode.workspace.fs.writeFile(vscode.Uri.file(targetPath), data);
              
              stats.totalSize += data.length;
            }
          }
        } catch (error) {
          // Indexes directory doesn't exist or other error
          console.warn('Failed to backup indexes:', error);
        }
      }
      
      // Create backup metadata
      const metadata: BackupMetadata = {
        id: backupId,
        timestamp: Date.now(),
        type: 'manual',
        description: backupOptions.description,
        stats
      };
      
      // Save metadata
      const metadataPath = path.join(backupDir, 'metadata.json');
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(metadataPath),
        Buffer.from(JSON.stringify(metadata, null, 2), 'utf8')
      );
      
      // Report completion
      if (backupOptions.progress) {
        backupOptions.progress.report({ message: 'Backup completed', increment: 100 });
      }
      
      console.log(`Backup created: ${backupId}`);
      return backupId;
    } catch (error) {
      throw new StorageError(`Failed to create backup: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Restore from a backup
   * @param backupId Backup ID
   * @param options Restore options
   * @returns Restore result
   */
  async restoreFromBackup(backupId: string, options: RestoreOptions = {}): Promise<RestoreResult> {
    try {
      const backupDir = path.join(this.backupsDir, backupId);
      
      // Check if backup exists
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(backupDir));
      } catch {
        throw new Error(`Backup ${backupId} not found`);
      }
      
      // Set default options
      const restoreOptions: Required<RestoreOptions> = {
        createBackupBeforeRestore: options.createBackupBeforeRestore ?? true,
        includeConversations: options.includeConversations ?? true,
        includeMessages: options.includeMessages ?? true,
        includeSnapshots: options.includeSnapshots ?? true,
        includeIndexes: options.includeIndexes ?? true,
        conversationIds: options.conversationIds || [],
        progress: options.progress || undefined
      };
      
      // Initialize result
      const result: RestoreResult = {
        success: true,
        restoredItems: 0,
        errors: []
      };
      
      // Report progress
      if (restoreOptions.progress) {
        restoreOptions.progress.report({ message: 'Preparing restore...' });
      }
      
      // Create backup before restore if requested
      if (restoreOptions.createBackupBeforeRestore) {
        try {
          result.preRestoreBackupId = await this.createBackup({
            description: `Pre-restore backup before restoring ${backupId}`,
            progress: restoreOptions.progress
          });
        } catch (error) {
          console.warn('Failed to create pre-restore backup:', error);
          result.errors.push(`Failed to create pre-restore backup: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      // Load backup metadata
      const metadataPath = path.join(backupDir, 'metadata.json');
      let metadata: BackupMetadata;
      
      try {
        const metadataData = await vscode.workspace.fs.readFile(vscode.Uri.file(metadataPath));
        metadata = JSON.parse(metadataData.toString());
      } catch (error) {
        throw new Error(`Failed to load backup metadata: ${error instanceof Error ? error.message : String(error)}`);
      }
      
      // Report progress
      if (restoreOptions.progress) {
        restoreOptions.progress.report({ message: 'Loading backup data...' });
      }
      
      // Load conversations from backup
      const conversationsDir = path.join(backupDir, 'conversations');
      let conversationFiles: [string, vscode.FileType][] = [];
      
      try {
        conversationFiles = await vscode.workspace.fs.readDirectory(vscode.Uri.file(conversationsDir));
      } catch {
        result.errors.push('Conversations directory not found in backup');
      }
      
      // Filter conversation files if specific IDs are provided
      if (restoreOptions.conversationIds.length > 0) {
        conversationFiles = conversationFiles.filter(([fileName]) => {
          const conversationId = fileName.replace('.json', '');
          return restoreOptions.conversationIds!.includes(conversationId);
        });
      }
      
      // Restore conversations
      if (restoreOptions.includeConversations && conversationFiles.length > 0) {
        if (restoreOptions.progress) {
          restoreOptions.progress.report({ message: 'Restoring conversations...' });
        }
        
        for (let i = 0; i < conversationFiles.length; i++) {
          const [fileName, fileType] = conversationFiles[i];
          
          // Skip non-files
          if (fileType !== vscode.FileType.File) {
            continue;
          }
          
          // Report progress
          if (restoreOptions.progress) {
            restoreOptions.progress.report({
              message: `Restoring conversation ${i + 1}/${conversationFiles.length}...`,
              increment: 100 / (conversationFiles.length * 3) // Divide by 3 for conversations, messages, snapshots
            });
          }
          
          try {
            const filePath = path.join(conversationsDir, fileName);
            const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
            const conversation = JSON.parse(data.toString());
            
            // Save conversation
            await this.storage.saveConversation(conversation);
            result.restoredItems++;
          } catch (error) {
            result.errors.push(`Failed to restore conversation ${fileName}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      
      // Restore messages
      if (restoreOptions.includeMessages) {
        if (restoreOptions.progress) {
          restoreOptions.progress.report({ message: 'Restoring messages...' });
        }
        
        const messagesDir = path.join(backupDir, 'messages');
        let messageFiles: [string, vscode.FileType][] = [];
        
        try {
          messageFiles = await vscode.workspace.fs.readDirectory(vscode.Uri.file(messagesDir));
          
          // Filter message files if specific conversation IDs are provided
          if (restoreOptions.conversationIds.length > 0) {
            // We need to load each message to check its conversation ID
            const filteredMessageFiles: [string, vscode.FileType][] = [];
            
            for (const [fileName, fileType] of messageFiles) {
              if (fileType === vscode.FileType.File) {
                try {
                  const filePath = path.join(messagesDir, fileName);
                  const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
                  const message = JSON.parse(data.toString());
                  
                  if (restoreOptions.conversationIds.includes(message.conversationId)) {
                    filteredMessageFiles.push([fileName, fileType]);
                  }
                } catch {
                  // Skip files that can't be parsed
                }
              }
            }
            
            messageFiles = filteredMessageFiles;
          }
          
          for (let i = 0; i < messageFiles.length; i++) {
            const [fileName, fileType] = messageFiles[i];
            
            // Skip non-files
            if (fileType !== vscode.FileType.File) {
              continue;
            }
            
            // Report progress
            if (restoreOptions.progress) {
              restoreOptions.progress.report({
                message: `Restoring message ${i + 1}/${messageFiles.length}...`,
                increment: 100 / (messageFiles.length * 3)
              });
            }
            
            try {
              const filePath = path.join(messagesDir, fileName);
              const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
              const message = JSON.parse(data.toString());
              
              // Save message
              await this.storage.saveMessage(message);
              result.restoredItems++;
            } catch (error) {
              result.errors.push(`Failed to restore message ${fileName}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        } catch {
          result.errors.push('Messages directory not found in backup');
        }
      }
      
      // Restore snapshots
      if (restoreOptions.includeSnapshots) {
        if (restoreOptions.progress) {
          restoreOptions.progress.report({ message: 'Restoring snapshots...' });
        }
        
        const snapshotsDir = path.join(backupDir, 'snapshots');
        let snapshotFiles: [string, vscode.FileType][] = [];
        
        try {
          snapshotFiles = await vscode.workspace.fs.readDirectory(vscode.Uri.file(snapshotsDir));
          
          // Filter snapshot files if specific conversation IDs are provided
          if (restoreOptions.conversationIds.length > 0) {
            // We need to load each snapshot to check its message ID
            const filteredSnapshotFiles: [string, vscode.FileType][] = [];
            
            for (const [fileName, fileType] of snapshotFiles) {
              if (fileType === vscode.FileType.File) {
                try {
                  const filePath = path.join(snapshotsDir, fileName);
                  const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
                  const snapshot = JSON.parse(data.toString());
                  
                  // Get message to check conversation ID
                  const message = await this.storage.getMessage(snapshot.messageId);
                  
                  if (message && restoreOptions.conversationIds.includes(message.conversationId)) {
                    filteredSnapshotFiles.push([fileName, fileType]);
                  }
                } catch {
                  // Skip files that can't be parsed
                }
              }
            }
            
            snapshotFiles = filteredSnapshotFiles;
          }
          
          for (let i = 0; i < snapshotFiles.length; i++) {
            const [fileName, fileType] = snapshotFiles[i];
            
            // Skip non-files
            if (fileType !== vscode.FileType.File) {
              continue;
            }
            
            // Report progress
            if (restoreOptions.progress) {
              restoreOptions.progress.report({
                message: `Restoring snapshot ${i + 1}/${snapshotFiles.length}...`,
                increment: 100 / (snapshotFiles.length * 3)
              });
            }
            
            try {
              const filePath = path.join(snapshotsDir, fileName);
              const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
              const snapshot = JSON.parse(data.toString());
              
              // Save snapshot
              await this.storage.saveSnapshot(snapshot);
              result.restoredItems++;
            } catch (error) {
              result.errors.push(`Failed to restore snapshot ${fileName}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        } catch {
          result.errors.push('Snapshots directory not found in backup');
        }
      }
      
      // Restore indexes
      if (restoreOptions.includeIndexes) {
        if (restoreOptions.progress) {
          restoreOptions.progress.report({ message: 'Restoring indexes...' });
        }
        
        const backupIndexesDir = path.join(backupDir, 'indexes');
        const targetIndexesDir = path.join(this.context.globalStorageUri.fsPath, 'cursor-companion', 'indexes');
        
        try {
          // Ensure target directory exists
          await this.ensureDirectoryExists(targetIndexesDir);
          
          // Copy index files
          const indexFiles = await vscode.workspace.fs.readDirectory(vscode.Uri.file(backupIndexesDir));
          
          for (const [fileName, fileType] of indexFiles) {
            if (fileType === vscode.FileType.File) {
              try {
                const sourcePath = path.join(backupIndexesDir, fileName);
                const targetPath = path.join(targetIndexesDir, fileName);
                
                const data = await vscode.workspace.fs.readFile(vscode.Uri.file(sourcePath));
                await vscode.workspace.fs.writeFile(vscode.Uri.file(targetPath), data);
                
                result.restoredItems++;
              } catch (error) {
                result.errors.push(`Failed to restore index ${fileName}: ${error instanceof Error ? error.message : String(error)}`);
              }
            }
          }
        } catch {
          result.errors.push('Indexes directory not found in backup');
        }
      }
      
      // Report completion
      if (restoreOptions.progress) {
        restoreOptions.progress.report({ message: 'Restore completed', increment: 100 });
      }
      
      // If there were errors, mark as not fully successful
      if (result.errors.length > 0) {
        result.success = false;
      }
      
      console.log(`Restore completed: ${result.restoredItems} items restored, ${result.errors.length} errors`);
      return result;
    } catch (error) {
      return {
        success: false,
        restoredItems: 0,
        errors: [`Failed to restore from backup: ${error instanceof Error ? error.message : String(error)}`]
      };
    }
  }
  
  /**
   * List available backups
   * @returns Array of backup metadata
   */
  async listBackups(): Promise<BackupMetadata[]> {
    try {
      const backups: BackupMetadata[] = [];
      
      // Check if backups directory exists
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(this.backupsDir));
      } catch {
        // Backups directory doesn't exist yet
        return [];
      }
      
      // List backup directories
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(this.backupsDir));
      
      for (const [dirName, fileType] of entries) {
        if (fileType === vscode.FileType.Directory) {
          try {
            const metadataPath = path.join(this.backupsDir, dirName, 'metadata.json');
            const data = await vscode.workspace.fs.readFile(vscode.Uri.file(metadataPath));
            const metadata = JSON.parse(data.toString()) as BackupMetadata;
            
            backups.push(metadata);
          } catch {
            // Skip directories without metadata
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
   * @param backupId Backup ID
   */
  async deleteBackup(backupId: string): Promise<void> {
    try {
      const backupDir = path.join(this.backupsDir, backupId);
      
      // Check if backup exists
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(backupDir));
      } catch {
        throw new Error(`Backup ${backupId} not found`);
      }
      
      // Delete backup directory
      await vscode.workspace.fs.delete(vscode.Uri.file(backupDir), { recursive: true });
      
      console.log(`Backup deleted: ${backupId}`);
    } catch (error) {
      throw new StorageError(`Failed to delete backup ${backupId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Clean up old backups
   * @param maxBackups Maximum number of backups to keep
   * @param keepManualBackups Whether to keep manual backups
   */
  async cleanupOldBackups(maxBackups: number = 10, keepManualBackups: boolean = true): Promise<number> {
    try {
      // Get all backups
      const backups = await this.listBackups();
      
      // Filter backups to delete
      let backupsToDelete: BackupMetadata[] = [];
      
      if (keepManualBackups) {
        // Keep all manual backups, only delete auto backups
        const autoBackups = backups.filter(b => b.type === 'auto');
        
        if (autoBackups.length > maxBackups) {
          // Sort by timestamp (oldest first)
          const sortedBackups = autoBackups.sort((a, b) => a.timestamp - b.timestamp);
          
          // Keep the newest maxBackups
          backupsToDelete = sortedBackups.slice(0, sortedBackups.length - maxBackups);
        }
      } else {
        // Consider all backups
        if (backups.length > maxBackups) {
          // Sort by timestamp (oldest first)
          const sortedBackups = backups.sort((a, b) => a.timestamp - b.timestamp);
          
          // Keep the newest maxBackups
          backupsToDelete = sortedBackups.slice(0, sortedBackups.length - maxBackups);
        }
      }
      
      // Delete old backups
      for (const backup of backupsToDelete) {
        await this.deleteBackup(backup.id);
      }
      
      return backupsToDelete.length;
    } catch (error) {
      console.error('Failed to cleanup old backups:', error);
      return 0;
    }
  }
  
  /**
   * Create an automatic backup
   */
  async createAutoBackup(): Promise<string> {
    try {
      // Create backup
      const backupId = await this.createBackup({
        description: 'Automatic backup',
        includeConversations: true,
        includeMessages: true,
        includeSnapshots: true,
        includeIndexes: true
      });
      
      // Update backup type
      const metadataPath = path.join(this.backupsDir, backupId, 'metadata.json');
      try {
        const data = await vscode.workspace.fs.readFile(vscode.Uri.file(metadataPath));
        const metadata = JSON.parse(data.toString()) as BackupMetadata;
        
        metadata.type = 'auto';
        
        await vscode.workspace.fs.writeFile(
          vscode.Uri.file(metadataPath),
          Buffer.from(JSON.stringify(metadata, null, 2), 'utf8')
        );
      } catch {
        // Ignore errors updating metadata
      }
      
      // Clean up old backups
      await this.cleanupOldBackups(this.options.maxAutoBackups || 10, true);
      
      console.log(`Automatic backup created: ${backupId}`);
      return backupId;
    } catch (error) {
      console.error('Failed to create automatic backup:', error);
      return '';
    }
  }
  
  /**
   * Start automatic backup schedule
   */
  private startAutoBackupSchedule(): void {
    // Schedule first backup after 5 minutes
    setTimeout(() => {
      this.createAutoBackup().catch(error => {
        console.error('Scheduled backup failed:', error);
      });
      
      // Schedule periodic backups
      setInterval(() => {
        this.createAutoBackup().catch(error => {
          console.error('Scheduled backup failed:', error);
        });
      }, (this.options.autoBackupIntervalMinutes || 60) * 60 * 1000);
    }, 5 * 60 * 1000);
  }
  
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
}