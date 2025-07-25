import { Message } from "./message";

/**
 * Represents a complete conversation with Cursor AI
 */
export interface Conversation {
  /** Unique identifier for the conversation */
  id: string;
  
  /** Human-readable title for the conversation */
  title: string;
  
  /** Timestamp when the conversation was created */
  timestamp: number;
  
  /** All messages in this conversation */
  messages: Message[]; // Message for lazy loading
  
  /** Current status of the conversation */
  status: 'active' | 'archived';
  
  /** Optional metadata */
  metadata?: {
    /** Total number of messages */
    messageCount?: number;
    
    /** Last activity timestamp */
    lastActivity?: number;
    
    /** Tags for categorization */
    tags?: string[];
  };
}

/**
 * Data transfer object for creating new conversations
 */
export interface CreateConversationDto {
  title?: string;
  initialMessage?: string;
  tags?: string[];
}

/**
 * Filter options for conversation queries
 */
export interface ConversationFilter {
  status?: 'active' | 'archived' | 'all';
  searchQuery?: string;
  tags?: string[];
  dateRange?: {
    start: number;
    end: number;
  };
}