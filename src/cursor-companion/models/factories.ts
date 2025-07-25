/**
 * Factory classes for creating Cursor Companion model objects
 */

import { Conversation, CreateConversationDto } from './conversation';
import { Message, CreateMessageDto } from './message';
import { CodeChange } from './codeChange';
import { FileSnapshot, SnapshotCollection } from './fileSnapshot';
import { 
  validateConversation, 
  validateMessage, 
  validateCodeChange, 
  validateFileSnapshot,
  ValidationError 
} from './validation';
import { 
  generateUUID, 
  calculateChecksum, 
  detectLanguage, 
  estimateTokenCount 
} from '../utils/helpers';

/**
 * Factory for creating conversation objects
 */
export class ConversationFactory {
  /**
   * Creates a new conversation from a DTO
   */
  static create(dto: CreateConversationDto): Conversation {
    const now = Date.now();
    const id = generateUUID();
    
    const conversation: Conversation = {
      id,
      title: dto.title || `Conversation ${new Date(now).toLocaleString()}`,
      timestamp: now,
      messages: [],
      status: 'active',
      metadata: {
        messageCount: 0,
        lastActivity: now,
        tags: dto.tags || []
      }
    };

    // Validate the created conversation
    const validation = validateConversation(conversation);
    if (!validation.isValid) {
      throw new ValidationError(`Failed to create conversation: ${validation.errors.map(e => e.message).join(', ')}`);
    }

    return conversation;
  }

  /**
   * Creates a conversation with an initial message
   */
  static createWithMessage(dto: CreateConversationDto): { conversation: Conversation; message: Message } {
    const conversation = this.create(dto);
    
    if (dto.initialMessage) {
      const message = MessageFactory.create({
        conversationId: conversation.id,
        content: dto.initialMessage,
        sender: 'user'
      });

      conversation.messages = [message];
      conversation.metadata!.messageCount = 1;
      conversation.metadata!.lastActivity = message.timestamp;

      return { conversation, message };
    }

    return { conversation, message: null as any };
  }

  /**
   * Updates conversation metadata
   */
  static updateMetadata(conversation: Conversation, updates: Partial<Conversation['metadata']>): Conversation {
    const updated: Conversation = {
      ...conversation,
      metadata: {
        ...conversation.metadata,
        ...updates
      }
    };

    const validation = validateConversation(updated);
    if (!validation.isValid) {
      throw new ValidationError(`Failed to update conversation metadata: ${validation.errors.map(e => e.message).join(', ')}`);
    }

    return updated;
  }

  /**
   * Archives a conversation
   */
  static archive(conversation: Conversation): Conversation {
    return {
      ...conversation,
      status: 'archived'
    };
  }

  /**
   * Activates an archived conversation
   */
  static activate(conversation: Conversation): Conversation {
    return {
      ...conversation,
      status: 'active'
    };
  }
}

/**
 * Factory for creating message objects
 */
export class MessageFactory {
  /**
   * Creates a new message from a DTO
   */
  static create(dto: CreateMessageDto): Message {
    const now = Date.now();
    const id = generateUUID();

    const message: Message = {
      id,
      conversationId: dto.conversationId,
      content: dto.content,
      sender: dto.sender,
      timestamp: now,
      codeChanges: dto.codeChanges || [],
      snapshot: [],
      metadata: dto.metadata
    };

    // Validate the created message
    const validation = validateMessage(message);
    if (!validation.isValid) {
      throw new ValidationError(`Failed to create message: ${validation.errors.map(e => e.message).join(', ')}`);
    }

    return message;
  }

  /**
   * Creates a user message with optional code changes
   */
  static createUserMessage(
    conversationId: string, 
    content: string,
    codeChanges?: CodeChange[]
  ): Message {
    return this.create({
      conversationId,
      content,
      sender: 'user',
      codeChanges,
      metadata: {
        tokenCount: this.estimateTokenCount(content),
        hasErrors: false
      }
    });
  }

  /**
   * Creates an AI message with optional code changes
   */
  static createAiMessage(
    conversationId: string, 
    content: string, 
    codeChanges?: CodeChange[]
  ): Message {
    return this.create({
      conversationId,
      content,
      sender: 'ai',
      codeChanges,
      metadata: {
        tokenCount: this.estimateTokenCount(content),
        hasErrors: false
      }
    });
  }

  /**
   * Adds code changes to an existing message
   */
  static addCodeChanges(message: Message, codeChanges: CodeChange[]): Message {
    const updated: Message = {
      ...message,
      codeChanges: [...message.codeChanges, ...codeChanges]
    };

    const validation = validateMessage(updated);
    if (!validation.isValid) {
      throw new ValidationError(`Failed to add code changes: ${validation.errors.map(e => e.message).join(', ')}`);
    }

    return updated;
  }

  /**
   * Adds snapshots to an existing message
   */
  static addSnapshots(message: Message, snapshots: FileSnapshot[]): Message {
    const updated: Message = {
      ...message,
      snapshot: [...message.snapshot, ...snapshots]
    };

    const validation = validateMessage(updated);
    if (!validation.isValid) {
      throw new ValidationError(`Failed to add snapshots: ${validation.errors.map(e => e.message).join(', ')}`);
    }

    return updated;
  }

  /**
   * Estimates token count for a message
   */
  private static estimateTokenCount(content: string): number {
    return estimateTokenCount(content);
  }
}

/**
 * Factory for creating code change objects
 */
export class CodeChangeFactory {
  /**
   * Creates a file creation change
   */
  static createFile(filePath: string, content: string): CodeChange {
    const change: CodeChange = {
      filePath,
      changeType: 'create',
      afterContent: content,
      metadata: {
        changeSize: content.length,
        language: this.detectLanguage(filePath),
        aiGenerated: false,
        confidence: 0
      }
    };

    const validation = validateCodeChange(change);
    if (!validation.isValid) {
      throw new ValidationError(`Failed to create file change: ${validation.errors.map(e => e.message).join(', ')}`);
    }

    return change;
  }

  /**
   * Creates a file modification change
   */
  static modifyFile(
    filePath: string, 
    beforeContent: string, 
    afterContent: string,
    lineNumbers?: { start: number; end: number }
  ): CodeChange {
    const change: CodeChange = {
      filePath,
      changeType: 'modify',
      beforeContent,
      afterContent,
      lineNumbers,
      metadata: {
        changeSize: Math.abs(afterContent.length - beforeContent.length),
        language: this.detectLanguage(filePath),
        aiGenerated: false,
        confidence: 0
      }
    };

    const validation = validateCodeChange(change);
    if (!validation.isValid) {
      throw new ValidationError(`Failed to create modify change: ${validation.errors.map(e => e.message).join(', ')}`);
    }

    return change;
  }

  /**
   * Creates a file deletion change
   */
  static deleteFile(filePath: string, content: string): CodeChange {
    const change: CodeChange = {
      filePath,
      changeType: 'delete',
      beforeContent: content,
      metadata: {
        changeSize: content.length,
        language: this.detectLanguage(filePath),
        aiGenerated: false,
        confidence: 0
      }
    };

    const validation = validateCodeChange(change);
    if (!validation.isValid) {
      throw new ValidationError(`Failed to create delete change: ${validation.errors.map(e => e.message).join(', ')}`);
    }

    return change;
  }

  /**
   * Marks a code change as AI-generated
   */
  static markAsAiGenerated(change: CodeChange, confidence: number = 1.0): CodeChange {
    return {
      ...change,
      metadata: {
        ...change.metadata,
        aiGenerated: true,
        confidence: Math.max(0, Math.min(1, confidence))
      }
    };
  }

  /**
   * Detects programming language from file path
   */
  private static detectLanguage(filePath: string): string {
    return detectLanguage(filePath);
  }
}

/**
 * Factory for creating file snapshot objects
 */
export class FileSnapshotFactory {
  /**
   * Creates a file snapshot
   */
  static create(filePath: string, content: string, existed: boolean = true): FileSnapshot {
    const now = Date.now();
    const checksum = this.calculateChecksum(content);

    const snapshot: FileSnapshot = {
      filePath,
      content,
      timestamp: now,
      checksum,
      metadata: {
        size: content.length,
        encoding: 'utf-8',
        language: CodeChangeFactory['detectLanguage'](filePath),
        existed
      }
    };

    const validation = validateFileSnapshot(snapshot);
    if (!validation.isValid) {
      throw new ValidationError(`Failed to create file snapshot: ${validation.errors.map(e => e.message).join(', ')}`);
    }

    return snapshot;
  }

  /**
   * Creates a snapshot for a non-existent file
   */
  static createNonExistent(filePath: string): FileSnapshot {
    return this.create(filePath, '', false);
  }

  /**
   * Creates a snapshot collection
   */
  static createCollection(messageId: string, snapshots: FileSnapshot[], description?: string): SnapshotCollection {
    return {
      id: generateUUID(),
      snapshots,
      timestamp: Date.now(),
      messageId,
      description
    };
  }

  /**
   * Verifies a snapshot's integrity
   */
  static verifyIntegrity(snapshot: FileSnapshot): boolean {
    const calculatedChecksum = this.calculateChecksum(snapshot.content);
    return calculatedChecksum === snapshot.checksum;
  }

  /**
   * Calculates checksum for content
   */
  private static calculateChecksum(content: string): string {
    return calculateChecksum(content);
  }
}

/**
 * Utility factory for batch operations
 */
export class BatchFactory {
  /**
   * Creates multiple snapshots from file paths and contents
   */
  static createSnapshots(files: Array<{ path: string; content: string; existed?: boolean }>): FileSnapshot[] {
    return files.map(file => 
      FileSnapshotFactory.create(file.path, file.content, file.existed ?? true)
    );
  }

  /**
   * Creates multiple code changes from a batch operation
   */
  static createCodeChanges(changes: Array<{
    filePath: string;
    changeType: 'create' | 'modify' | 'delete';
    beforeContent?: string;
    afterContent?: string;
    lineNumbers?: { start: number; end: number };
  }>): CodeChange[] {
    return changes.map(change => {
      switch (change.changeType) {
        case 'create':
          return CodeChangeFactory.createFile(change.filePath, change.afterContent!);
        case 'modify':
          return CodeChangeFactory.modifyFile(
            change.filePath, 
            change.beforeContent!, 
            change.afterContent!,
            change.lineNumbers
          );
        case 'delete':
          return CodeChangeFactory.deleteFile(change.filePath, change.beforeContent!);
        default:
          throw new Error(`Unknown change type: ${change.changeType}`);
      }
    });
  }
}