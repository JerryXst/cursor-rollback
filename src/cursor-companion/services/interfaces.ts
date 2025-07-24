import { 
  Conversation, 
  Message, 
  CreateConversationDto, 
  CreateMessageDto, 
  ConversationFilter, 
  MessageFilter 
} from '../models';
import { SnapshotCollection, SnapshotOptions } from '../models/fileSnapshot';

/**
 * Interface for tracking Cursor conversations
 */
export interface IConversationTracker {
  /** Start tracking conversations */
  startTracking(): Promise<void>;
  
  /** Stop tracking conversations */
  stopTracking(): void;
  
  /** Check if tracking is currently active */
  isTracking(): boolean;
  
  /** Register callback for new conversations */
  onNewConversation(callback: (conversation: Conversation) => void): void;
  
  /** Register callback for new messages */
  onNewMessage(callback: (message: Message) => void): void;
  
  /** Register callback for tracking errors */
  onTrackingError(callback: (error: Error) => void): void;
}

/**
 * Interface for managing conversation data storage
 */
export interface IDataStorage {
  /** Initialize the storage system */
  initialize(): Promise<void>;
  
  /** Save a conversation */
  saveConversation(conversation: Conversation): Promise<void>;
  
  /** Get all conversations with optional filtering */
  getConversations(filter?: ConversationFilter): Promise<Conversation[]>;
  
  /** Get a specific conversation by ID */
  getConversation(id: string): Promise<Conversation | null>;
  
  /** Delete a conversation and all associated data */
  deleteConversation(id: string): Promise<void>;
  
  /** Archive a conversation */
  archiveConversation(id: string): Promise<void>;
  
  /** Save a message */
  saveMessage(message: Message): Promise<void>;
  
  /** Get messages for a conversation */
  getMessages(conversationId: string, filter?: MessageFilter): Promise<Message[]>;
  
  /** Get a specific message by ID */
  getMessage(id: string): Promise<Message | null>;
  
  /** Save a snapshot collection */
  saveSnapshot(snapshot: SnapshotCollection): Promise<void>;
  
  /** Get snapshot by message ID */
  getSnapshot(messageId: string): Promise<SnapshotCollection | null>;
  
  /** Clean up old data */
  cleanup(olderThanDays: number): Promise<void>;
  
  /** Migrate all data to the current schema version */
  migrateData(options?: {
    createBackups?: boolean;
    progressCallback?: (current: number, total: number) => void;
  }): Promise<any>;
  
  /** Verify data integrity of all stored conversations */
  verifyDataIntegrity(): Promise<{
    totalChecked: number;
    corruptedItems: number;
    errors: Error[];
  }>;
  
  /** Repair corrupted conversation data */
  repairConversationData(conversation: Conversation): Promise<{
    success: boolean;
    repairedFields: string[];
    errors: Error[];
  }>;
  
  /** Create a backup of a conversation */
  createBackup(conversationId: string): Promise<string>;
}

/**
 * Result of a rollback operation
 */
export interface RollbackResult {
  /** Whether the rollback was successful */
  success: boolean;
  
  /** Files that were modified during rollback */
  modifiedFiles: string[];
  
  /** Backup ID created before rollback */
  backupId?: string;
  
  /** Error message if rollback failed */
  error?: string;
  
  /** Additional details about the rollback */
  details?: {
    /** Number of files rolled back */
    filesRolledBack: number;
    
    /** Whether conversation context was reset */
    conversationReset: boolean;
    
    /** Time taken for the operation */
    duration: number;
  };
}

/**
 * Interface for managing rollback operations
 */
export interface IRollbackManager {
  /** Rollback to a specific message point */
  rollbackToMessage(messageId: string): Promise<RollbackResult>;
  
  /** Create a backup of current state */
  createBackup(description?: string): Promise<string>;
  
  /** Restore from a backup */
  restoreBackup(backupId: string): Promise<void>;
  
  /** List available backups */
  listBackups(): Promise<Array<{ id: string; timestamp: number; description?: string }>>;
  
  /** Delete a backup */
  deleteBackup(backupId: string): Promise<void>;
  
  /** Check if rollback is possible for a message */
  canRollback(messageId: string): Promise<boolean>;
}

/**
 * Interface for creating file snapshots
 */
export interface ISnapshotManager {
  /** Create a snapshot of current workspace state */
  createSnapshot(messageId: string, options?: SnapshotOptions): Promise<SnapshotCollection>;
  
  /** Restore files from a snapshot */
  restoreFromSnapshot(snapshotId: string, filePaths?: string[]): Promise<void>;
  
  /** Compare two snapshots */
  compareSnapshots(snapshot1Id: string, snapshot2Id: string): Promise<{
    added: string[];
    modified: string[];
    deleted: string[];
  }>;
  
  /** Get snapshot statistics */
  getSnapshotStats(snapshotId: string): Promise<{
    fileCount: number;
    totalSize: number;
    languages: string[];
  }>;
}

/**
 * Interface for UI management
 */
export interface IUIManager {
  /** Initialize the UI components */
  initialize(): Promise<void>;
  
  /** Show the conversation panel */
  showConversationPanel(): void;
  
  /** Refresh the conversation list */
  refreshConversationList(): void;
  
  /** Filter conversations by query */
  filterConversations(query: string): void;
  
  /** Register callback for rollback requests */
  onRollbackRequest(callback: (messageId: string) => void): void;
}

/**
 * Interface for managing conversation context
 */
export interface IConversationContextManager {
  /** Capture current conversation context */
  captureContext(conversationId: string, messageId: string): Promise<any>;
  
  /** Rollback conversation context to a specific message point */
  rollbackContext(messageId: string): Promise<boolean>;
  
  /** Get conversation context truncated to a specific message */
  getTruncatedContext(messageId: string): Promise<any>;
  
  /** Clean up old context history */
  cleanupOldContexts(maxAge?: number): void;
}