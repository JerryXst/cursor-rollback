/**
 * Represents a snapshot of a file at a specific point in time
 */
export interface FileSnapshot {
  /** Path to the file */
  filePath: string;
  
  /** Complete content of the file at snapshot time */
  content: string;
  
  /** When this snapshot was taken */
  timestamp: number;
  
  /** Checksum for integrity verification */
  checksum: string;
  
  /** Optional metadata */
  metadata?: {
    /** File size in bytes */
    size?: number;
    
    /** File encoding */
    encoding?: string;
    
    /** Language detected */
    language?: string;
    
    /** Whether file existed at snapshot time */
    existed?: boolean;
  };
}

/**
 * Represents a collection of file snapshots taken at the same time
 */
export interface SnapshotCollection {
  /** Unique identifier for this snapshot collection */
  id: string;
  
  /** All file snapshots in this collection */
  snapshots: FileSnapshot[];
  
  /** When this collection was created */
  timestamp: number;
  
  /** Message ID this snapshot is associated with */
  messageId: string;
  
  /** Optional description */
  description?: string;
}

/**
 * Options for creating snapshots
 */
export interface SnapshotOptions {
  /** Specific files to include (if not provided, includes all workspace files) */
  includeFiles?: string[];
  
  /** Files to exclude from snapshot */
  excludeFiles?: string[];
  
  /** File patterns to exclude */
  excludePatterns?: string[];
  
  /** Maximum file size to include (in bytes) */
  maxFileSize?: number;
  
  /** Whether to include binary files */
  includeBinary?: boolean;
}