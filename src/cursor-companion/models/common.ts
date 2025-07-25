/**
 * Common types and utilities used across the Cursor Companion system
 */

/**
 * Standard result type for operations that can succeed or fail
 */
export interface Result<T, E = Error> {
  success: boolean;
  data?: T;
  error?: E;
}

/**
 * Pagination options for data queries
 */
export interface PaginationOptions {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

/**
 * Event emitter interface for type-safe events
 */
export interface EventEmitter<T extends Record<string, any[]>> {
  on<K extends keyof T>(event: K, listener: (...args: T[K]) => void): void;
  off<K extends keyof T>(event: K, listener: (...args: T[K]) => void): void;
  emit<K extends keyof T>(event: K, ...args: T[K]): void;
}

/**
 * Disposable interface for cleanup
 */
export interface Disposable {
  dispose(): void;
}

/**
 * Initializable interface for services
 */
export interface Initializable {
  initialize(): Promise<void>;
}

// /**
//  * Configuration interface for the extension
//  */
export interface CursorCompanionConfig_1 {
  /** Maximum number of conversations to keep in memory */
  maxConversations: number;
  
  /** Maximum number of messages per conversation */
  maxMessagesPerConversation: number;
  
  /** How long to keep snapshots (in days) */
  snapshotRetentionDays: number;
  
  /** Maximum size for individual snapshots (in MB) */
  maxSnapshotSize: number;
  
  /** Whether to automatically track conversations */
  autoTrackConversations: boolean;
  
  /** File patterns to exclude from snapshots */
  excludePatterns: string[];
  
  /** Whether to enable debug logging */
  enableDebugLogging: boolean;
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: CursorCompanionConfig_1 = {
  maxConversations: 1000,
  maxMessagesPerConversation: 500,
  snapshotRetentionDays: 30,
  maxSnapshotSize: 10,
  autoTrackConversations: true,
  excludePatterns: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.git/**',
    '**/coverage/**',
    '**/*.log'
  ],
  enableDebugLogging: false
};