/**
 * Represents a code change made during a conversation
 */
export interface CodeChange {
  /** Path to the file that was changed */
  filePath: string;
  
  /** Type of change that was made */
  changeType: 'create' | 'modify' | 'delete';
  
  /** Content before the change (for modify/delete operations) */
  beforeContent?: string;
  
  /** Content after the change (for create/modify operations) */
  afterContent?: string;
  
  /** Specific line numbers affected by the change */
  lineNumbers?: {
    start: number;
    end: number;
  };
  
  /** Optional metadata */
  metadata?: {
    /** Size of the change in bytes */
    changeSize?: number;
    
    /** Language of the file */
    language?: string;
    
    /** Whether this was an AI-generated change */
    aiGenerated?: boolean;
    
    /** Confidence score for AI detection */
    confidence?: number;
  };
}

/**
 * Represents a batch of related code changes
 */
export interface CodeChangeBatch {
  /** Unique identifier for this batch */
  id: string;
  
  /** All changes in this batch */
  changes: CodeChange[];
  
  /** Timestamp when the batch was created */
  timestamp: number;
  
  /** Description of what this batch accomplishes */
  description?: string;
}

/**
 * Options for analyzing code changes
 */
export interface CodeChangeAnalysis {
  /** Total number of files affected */
  filesAffected: number;
  
  /** Total lines added */
  linesAdded: number;
  
  /** Total lines removed */
  linesRemoved: number;
  
  /** Languages involved in the changes */
  languages: string[];
  
  /** Whether changes appear to be AI-generated */
  likelyAiGenerated: boolean;
}