/**
 * Data migration utilities for Cursor Companion
 * Handles upgrading data schemas between versions
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { 
  Conversation, 
  Message, 
  SnapshotCollection,
  StorageError,
  ErrorCategory
} from '../models';
import { CURRENT_SCHEMA_VERSION, VersionedData } from './serialization';

/**
 * Migration result interface
 */
export interface MigrationResult {
  /** Whether the migration was successful */
  success: boolean;
  
  /** Number of items migrated */
  migratedCount: number;
  
  /** Number of items that failed migration */
  failedCount: number;
  
  /** Errors encountered during migration */
  errors: Error[];
  
  /** Time taken for migration (ms) */
  timeTaken: number;
}

/**
 * Migration options interface
 */
export interface MigrationOptions {
  /** Whether to create backups before migration */
  createBackups?: boolean;
  
  /** Whether to validate migrated data */
  validateAfterMigration?: boolean;
  
  /** Whether to continue on errors */
  continueOnError?: boolean;
  
  /** Progress callback */
  progressCallback?: (current: number, total: number) => void;
}

/**
 * Utility class for data migrations
 */
export class DataMigration {
  /**
   * Migrate all data in a storage directory to the current schema version
   * 
   * @param storageDir Directory containing data files
   * @param options Migration options
   * @returns Migration result
   */
  static async migrateStorage(
    storageDir: string,
    options: MigrationOptions = {}
  ): Promise<MigrationResult> {
    const startTime = Date.now();
    const result: MigrationResult = {
      success: true,
      migratedCount: 0,
      failedCount: 0,
      errors: [],
      timeTaken: 0
    };
    
    try {
      // Create backup if requested
      if (options.createBackups) {
        await this.createBackup(storageDir);
      }
      
      // Migrate conversations
      const conversationsDir = path.join(storageDir, 'conversations');
      const conversationResult = await this.migrateDirectory(
        conversationsDir, 
        this.migrateConversation.bind(this),
        options
      );
      
      // Migrate messages
      const messagesDir = path.join(storageDir, 'messages');
      const messageResult = await this.migrateDirectory(
        messagesDir,
        this.migrateMessage.bind(this),
        options
      );
      
      // Migrate snapshots
      const snapshotsDir = path.join(storageDir, 'snapshots');
      const snapshotResult = await this.migrateDirectory(
        snapshotsDir,
        this.migrateSnapshot.bind(this),
        options
      );
      
      // Combine results
      result.migratedCount = 
        conversationResult.migratedCount + 
        messageResult.migratedCount + 
        snapshotResult.migratedCount;
        
      result.failedCount = 
        conversationResult.failedCount + 
        messageResult.failedCount + 
        snapshotResult.failedCount;
        
      result.errors = [
        ...conversationResult.errors,
        ...messageResult.errors,
        ...snapshotResult.errors
      ];
      
      result.success = result.failedCount === 0;
      result.timeTaken = Date.now() - startTime;
      
      return result;
    } catch (error) {
      result.success = false;
      result.errors.push(error instanceof Error ? error : new Error(String(error)));
      result.timeTaken = Date.now() - startTime;
      return result;
    }
  }
  
  /**
   * Create a backup of a storage directory
   * 
   * @param storageDir Directory to backup
   * @returns Path to backup directory
   */
  private static async createBackup(storageDir: string): Promise<string> {
    const backupDir = `${storageDir}_backup_${Date.now()}`;
    
    try {
      // Copy directory recursively
      // Note: This is a simplified version. In a real implementation,
      // you would use a more robust directory copying mechanism
      const sourceUri = vscode.Uri.file(storageDir);
      const targetUri = vscode.Uri.file(backupDir);
      
      await vscode.workspace.fs.copy(sourceUri, targetUri, { overwrite: true });
      return backupDir;
    } catch (error) {
      throw new StorageError(
        `Failed to create backup of ${storageDir}: ${error instanceof Error ? error.message : String(error)}`,
        { category: ErrorCategory.STORAGE }
      );
    }
  }
  
  /**
   * Migrate all files in a directory
   * 
   * @param directory Directory containing files to migrate
   * @param migrateFn Function to migrate individual files
   * @param options Migration options
   * @returns Migration result for this directory
   */
  private static async migrateDirectory(
    directory: string,
    migrateFn: (filePath: string, options: MigrationOptions) => Promise<boolean>,
    options: MigrationOptions
  ): Promise<MigrationResult> {
    const result: MigrationResult = {
      success: true,
      migratedCount: 0,
      failedCount: 0,
      errors: [],
      timeTaken: 0
    };
    
    try {
      const startTime = Date.now();
      const dirUri = vscode.Uri.file(directory);
      
      try {
        // Check if directory exists
        await vscode.workspace.fs.stat(dirUri);
      } catch {
        // Directory doesn't exist, nothing to migrate
        result.timeTaken = Date.now() - startTime;
        return result;
      }
      
      // Get all JSON files in directory
      const files = await vscode.workspace.fs.readDirectory(dirUri);
      const jsonFiles = files
        .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.json'))
        .map(([name]) => name);
      
      // Process each file
      let current = 0;
      const total = jsonFiles.length;
      
      for (const fileName of jsonFiles) {
        const filePath = path.join(directory, fileName);
        
        try {
          const success = await migrateFn(filePath, options);
          
          if (success) {
            result.migratedCount++;
          } else {
            result.failedCount++;
          }
        } catch (error) {
          result.failedCount++;
          result.errors.push(error instanceof Error ? error : new Error(`Error migrating ${filePath}: ${String(error)}`));
          
          if (!options.continueOnError) {
            break;
          }
        }
        
        current++;
        if (options.progressCallback) {
          options.progressCallback(current, total);
        }
      }
      
      result.success = result.failedCount === 0;
      result.timeTaken = Date.now() - startTime;
      return result;
    } catch (error) {
      result.success = false;
      result.errors.push(error instanceof Error ? error : new Error(String(error)));
      result.timeTaken = 0;
      return result;
    }
  }
  
  /**
   * Migrate a conversation file
   * 
   * @param filePath Path to conversation file
   * @param options Migration options
   * @returns Whether migration was successful
   */
  private static async migrateConversation(
    filePath: string,
    options: MigrationOptions
  ): Promise<boolean> {
    try {
      // Read file
      const fileUri = vscode.Uri.file(filePath);
      const fileContent = await vscode.workspace.fs.readFile(fileUri);
      const jsonString = fileContent.toString();
      
      // Parse JSON
      let parsed: any;
      try {
        parsed = JSON.parse(jsonString);
      } catch {
        // Not valid JSON, skip
        return false;
      }
      
      // Check if already versioned
      if (parsed.schemaVersion === CURRENT_SCHEMA_VERSION) {
        // Already at current version
        return true;
      }
      
      // Handle unversioned data (legacy format)
      if (!parsed.schemaVersion) {
        // Wrap in versioned format
        const conversation = this.migrateUnversionedConversation(parsed);
        const versionedData: VersionedData<Conversation> = {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          data: conversation,
          serializedAt: Date.now()
        };
        
        // Write back to file
        const newContent = JSON.stringify(versionedData, null, 2);
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(newContent, 'utf8'));
        return true;
      }
      
      // Handle versioned but outdated data
      if (parsed.schemaVersion < CURRENT_SCHEMA_VERSION) {
        // Migrate based on version
        const migratedData = this.migrateVersionedConversation(parsed);
        
        // Write back to file
        const newContent = JSON.stringify(migratedData, null, 2);
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(newContent, 'utf8'));
        return true;
      }
      
      // Higher version than we support
      return false;
    } catch (error) {
      console.error(`Failed to migrate conversation ${filePath}:`, error);
      throw error;
    }
  }
  
  /**
   * Migrate a message file
   * 
   * @param filePath Path to message file
   * @param options Migration options
   * @returns Whether migration was successful
   */
  private static async migrateMessage(
    filePath: string,
    options: MigrationOptions
  ): Promise<boolean> {
    try {
      // Read file
      const fileUri = vscode.Uri.file(filePath);
      const fileContent = await vscode.workspace.fs.readFile(fileUri);
      const jsonString = fileContent.toString();
      
      // Parse JSON
      let parsed: any;
      try {
        parsed = JSON.parse(jsonString);
      } catch {
        // Not valid JSON, skip
        return false;
      }
      
      // Check if already versioned
      if (parsed.schemaVersion === CURRENT_SCHEMA_VERSION) {
        // Already at current version
        return true;
      }
      
      // Handle unversioned data (legacy format)
      if (!parsed.schemaVersion) {
        // Wrap in versioned format
        const message = this.migrateUnversionedMessage(parsed);
        const versionedData: VersionedData<Message> = {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          data: message,
          serializedAt: Date.now()
        };
        
        // Write back to file
        const newContent = JSON.stringify(versionedData, null, 2);
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(newContent, 'utf8'));
        return true;
      }
      
      // Handle versioned but outdated data
      if (parsed.schemaVersion < CURRENT_SCHEMA_VERSION) {
        // Migrate based on version
        const migratedData = this.migrateVersionedMessage(parsed);
        
        // Write back to file
        const newContent = JSON.stringify(migratedData, null, 2);
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(newContent, 'utf8'));
        return true;
      }
      
      // Higher version than we support
      return false;
    } catch (error) {
      console.error(`Failed to migrate message ${filePath}:`, error);
      throw error;
    }
  }
  
  /**
   * Migrate a snapshot file
   * 
   * @param filePath Path to snapshot file
   * @param options Migration options
   * @returns Whether migration was successful
   */
  private static async migrateSnapshot(
    filePath: string,
    options: MigrationOptions
  ): Promise<boolean> {
    try {
      // Read file
      const fileUri = vscode.Uri.file(filePath);
      const fileContent = await vscode.workspace.fs.readFile(fileUri);
      const jsonString = fileContent.toString();
      
      // Parse JSON
      let parsed: any;
      try {
        parsed = JSON.parse(jsonString);
      } catch {
        // Not valid JSON, skip
        return false;
      }
      
      // Check if already versioned
      if (parsed.schemaVersion === CURRENT_SCHEMA_VERSION) {
        // Already at current version
        return true;
      }
      
      // Handle unversioned data (legacy format)
      if (!parsed.schemaVersion) {
        // Wrap in versioned format
        const snapshot = this.migrateUnversionedSnapshot(parsed);
        const versionedData: VersionedData<SnapshotCollection> = {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          data: snapshot,
          serializedAt: Date.now()
        };
        
        // Write back to file
        const newContent = JSON.stringify(versionedData, null, 2);
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(newContent, 'utf8'));
        return true;
      }
      
      // Handle versioned but outdated data
      if (parsed.schemaVersion < CURRENT_SCHEMA_VERSION) {
        // Migrate based on version
        const migratedData = this.migrateVersionedSnapshot(parsed);
        
        // Write back to file
        const newContent = JSON.stringify(migratedData, null, 2);
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(newContent, 'utf8'));
        return true;
      }
      
      // Higher version than we support
      return false;
    } catch (error) {
      console.error(`Failed to migrate snapshot ${filePath}:`, error);
      throw error;
    }
  }
  
  /**
   * Migrate an unversioned conversation to current format
   * 
   * @param data Unversioned conversation data
   * @returns Migrated conversation
   */
  private static migrateUnversionedConversation(data: any): Conversation {
    // Ensure required fields exist
    if (!data.id) {
      data.id = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }
    
    if (!data.title) {
      data.title = `Conversation ${new Date().toLocaleString()}`;
    }
    
    if (!data.timestamp) {
      data.timestamp = Date.now();
    }
    
    if (!data.messages) {
      data.messages = [];
    }
    
    if (!data.status) {
      data.status = 'active';
    }
    
    // Add metadata if missing
    if (!data.metadata) {
      data.metadata = {
        messageCount: Array.isArray(data.messages) ? data.messages.length : 0,
        lastActivity: data.timestamp
      };
    }
    
    return data as Conversation;
  }
  
  /**
   * Migrate a versioned conversation to current format
   * 
   * @param versionedData Versioned conversation data
   * @returns Migrated versioned data
   */
  private static migrateVersionedConversation(versionedData: any): VersionedData<Conversation> {
    const { schemaVersion, data } = versionedData;
    
    // Apply migrations based on version
    let migratedData = { ...data };
    
    // Example: Migrate from version 0 to 1
    if (schemaVersion === 0) {
      migratedData = this.migrateUnversionedConversation(migratedData);
    }
    
    // Update version and timestamp
    return {
      ...versionedData,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      data: migratedData,
      serializedAt: Date.now()
    };
  }
  
  /**
   * Migrate an unversioned message to current format
   * 
   * @param data Unversioned message data
   * @returns Migrated message
   */
  private static migrateUnversionedMessage(data: any): Message {
    // Ensure required fields exist
    if (!data.id) {
      data.id = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }
    
    if (!data.timestamp) {
      data.timestamp = Date.now();
    }
    
    if (!data.codeChanges) {
      data.codeChanges = [];
    }
    
    if (!data.snapshot) {
      data.snapshot = [];
    }
    
    // Add metadata if missing
    if (!data.metadata) {
      data.metadata = {};
    }
    
    return data as Message;
  }
  
  /**
   * Migrate a versioned message to current format
   * 
   * @param versionedData Versioned message data
   * @returns Migrated versioned data
   */
  private static migrateVersionedMessage(versionedData: any): VersionedData<Message> {
    const { schemaVersion, data } = versionedData;
    
    // Apply migrations based on version
    let migratedData = { ...data };
    
    // Example: Migrate from version 0 to 1
    if (schemaVersion === 0) {
      migratedData = this.migrateUnversionedMessage(migratedData);
    }
    
    // Update version and timestamp
    return {
      ...versionedData,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      data: migratedData,
      serializedAt: Date.now()
    };
  }
  
  /**
   * Migrate an unversioned snapshot to current format
   * 
   * @param data Unversioned snapshot data
   * @returns Migrated snapshot
   */
  private static migrateUnversionedSnapshot(data: any): SnapshotCollection {
    // Ensure required fields exist
    if (!data.id) {
      data.id = `snap_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }
    
    if (!data.timestamp) {
      data.timestamp = Date.now();
    }
    
    if (!data.snapshots) {
      data.snapshots = [];
    }
    
    // Ensure each snapshot has required fields
    if (Array.isArray(data.snapshots)) {
      data.snapshots = data.snapshots.map((snapshot: any) => {
        if (!snapshot.checksum) {
          // Generate a simple checksum (in a real implementation, use a proper hash)
          snapshot.checksum = `chk_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        }
        
        if (!snapshot.timestamp) {
          snapshot.timestamp = data.timestamp;
        }
        
        return snapshot;
      });
    }
    
    return data as SnapshotCollection;
  }
  
  /**
   * Migrate a versioned snapshot to current format
   * 
   * @param versionedData Versioned snapshot data
   * @returns Migrated versioned data
   */
  private static migrateVersionedSnapshot(versionedData: any): VersionedData<SnapshotCollection> {
    const { schemaVersion, data } = versionedData;
    
    // Apply migrations based on version
    let migratedData = { ...data };
    
    // Example: Migrate from version 0 to 1
    if (schemaVersion === 0) {
      migratedData = this.migrateUnversionedSnapshot(migratedData);
    }
    
    // Update version and timestamp
    return {
      ...versionedData,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      data: migratedData,
      serializedAt: Date.now()
    };
  }
}