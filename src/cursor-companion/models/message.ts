import { CodeChange } from './codeChange';
import { FileSnapshot } from './fileSnapshot';

/**
 * Represents a single message in a conversation
 */
export interface Message {
  /** Unique identifier for the message */
  id: string;
  
  /** ID of the conversation this message belongs to */
  conversationId: string;
  
  /** The actual message content */
  content: string;
  
  /** Who sent this message */
  sender: 'user' | 'ai';
  
  /** When this message was created */
  timestamp: number;
  
  /** Code changes associated with this message */
  codeChanges: CodeChange[];
  
  /** File snapshots taken at this message point */
  snapshot: FileSnapshot[];
  
  /** Optional metadata */
  metadata?: {
    /** Token count for AI messages */
    tokenCount?: number;
    
    /** Processing time for AI responses */
    processingTime?: number;
    
    /** Whether this message caused errors */
    hasErrors?: boolean;
    
    /** Custom tags */
    tags?: string[];
  };
}

/**
 * Data transfer object for creating new messages
 */
export interface CreateMessageDto {
  conversationId: string;
  content: string;
  sender: 'user' | 'ai';
  codeChanges?: CodeChange[];
  metadata?: Message['metadata'];
}

/**
 * Filter options for message queries
 */
export interface MessageFilter {
  conversationId?: string;
  sender?: 'user' | 'ai' | 'all';
  searchQuery?: string;
  hasCodeChanges?: boolean;
  dateRange?: {
    start: number;
    end: number;
  };
}