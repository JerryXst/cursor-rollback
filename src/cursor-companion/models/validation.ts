/**
 * Data validation functions for Cursor Companion models
 */

import { Conversation, CreateConversationDto } from './conversation';
import { Message, CreateMessageDto } from './message';
import { CodeChange } from './codeChange';
import { FileSnapshot } from './fileSnapshot';

/**
 * Validation error class
 */
export class ValidationError extends Error {
  constructor(
    messageId: string,
    public field?: string,
    public value?: any
  ) {
    super(messageId);
    this.name = 'ValidationError';
  }
}

/**
 * Validation result interface
 */
export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

/**
 * Validates a conversation object
 */
export function validateConversation(conversation: Partial<Conversation>): ValidationResult {
  const errors: ValidationError[] = [];

  // Required fields
  if (!conversation.id || typeof conversation.id !== 'string' || conversation.id.trim() === '') {
    errors.push(new ValidationError('Conversation ID is required and must be a non-empty string', 'id', conversation.id));
  }

  if (!conversation.title || typeof conversation.title !== 'string' || conversation.title.trim() === '') {
    errors.push(new ValidationError('Conversation title is required and must be a non-empty string', 'title', conversation.title));
  }

  if (typeof conversation.timestamp !== 'number' || conversation.timestamp <= 0) {
    errors.push(new ValidationError('Conversation timestamp must be a positive number', 'timestamp', conversation.timestamp));
  }

  // Status validation
  if (conversation.status && !['active', 'archived'].includes(conversation.status)) {
    errors.push(new ValidationError('Conversation status must be either "active" or "archived"', 'status', conversation.status));
  }

  // Messages array validation
  if (conversation.messages && !Array.isArray(conversation.messages)) {
    errors.push(new ValidationError('Messages must be an array', 'messages', conversation.messages));
  }

  // Metadata validation
  if (conversation.metadata) {
    if (typeof conversation.metadata.messageCount === 'number' && conversation.metadata.messageCount < 0) {
      errors.push(new ValidationError('Message count cannot be negative', 'metadata.messageCount', conversation.metadata.messageCount));
    }

    if (typeof conversation.metadata.lastActivity === 'number' && conversation.metadata.lastActivity <= 0) {
      errors.push(new ValidationError('Last activity timestamp must be positive', 'metadata.lastActivity', conversation.metadata.lastActivity));
    }

    if (conversation.metadata.tags && !Array.isArray(conversation.metadata.tags)) {
      errors.push(new ValidationError('Tags must be an array', 'metadata.tags', conversation.metadata.tags));
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Validates a create conversation DTO
 */
export function validateCreateConversationDto(dto: CreateConversationDto): ValidationResult {
  const errors: ValidationError[] = [];

  if (dto.title && (typeof dto.title !== 'string' || dto.title.trim() === '')) {
    errors.push(new ValidationError('Title must be a non-empty string if provided', 'title', dto.title));
  }

  if (dto.initialMessage && (typeof dto.initialMessage !== 'string' || dto.initialMessage.trim() === '')) {
    errors.push(new ValidationError('Initial message must be a non-empty string if provided', 'initialMessage', dto.initialMessage));
  }

  if (dto.tags && !Array.isArray(dto.tags)) {
    errors.push(new ValidationError('Tags must be an array if provided', 'tags', dto.tags));
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Validates a message object
 */
export function validateMessage(message: Partial<Message>): ValidationResult {
  const errors: ValidationError[] = [];

  // Required fields
  if (!message.id || typeof message.id !== 'string' || message.id.trim() === '') {
    errors.push(new ValidationError('Message ID is required and must be a non-empty string', 'id', message.id));
  }

  if (!message.conversationId || typeof message.conversationId !== 'string' || message.conversationId.trim() === '') {
    errors.push(new ValidationError('Conversation ID is required and must be a non-empty string', 'conversationId', message.conversationId));
  }

  if (!message.content || typeof message.content !== 'string' || message.content.trim() === '') {
    errors.push(new ValidationError('Message content is required and must be a non-empty string', 'content', message.content));
  }

  if (!message.sender || !['user', 'ai'].includes(message.sender)) {
    errors.push(new ValidationError('Message sender must be either "user" or "ai"', 'sender', message.sender));
  }

  if (typeof message.timestamp !== 'number' || message.timestamp <= 0) {
    errors.push(new ValidationError('Message timestamp must be a positive number', 'timestamp', message.timestamp));
  }

  // Arrays validation
  if (message.codeChanges && !Array.isArray(message.codeChanges)) {
    errors.push(new ValidationError('Code changes must be an array', 'codeChanges', message.codeChanges));
  }

  if (message.snapshot && !Array.isArray(message.snapshot)) {
    errors.push(new ValidationError('Snapshot must be an array', 'snapshot', message.snapshot));
  }

  // Validate code changes if present
  if (message.codeChanges && Array.isArray(message.codeChanges)) {
    message.codeChanges.forEach((change, index) => {
      const changeValidation = validateCodeChange(change);
      if (!changeValidation.isValid) {
        changeValidation.errors.forEach(error => {
          errors.push(new ValidationError(`Code change ${index}: ${error.message}`, `codeChanges[${index}].${error.field}`, error.value));
        });
      }
    });
  }

  // Validate snapshots if present
  if (message.snapshot && Array.isArray(message.snapshot)) {
    message.snapshot.forEach((snapshot, index) => {
      const snapshotValidation = validateFileSnapshot(snapshot);
      if (!snapshotValidation.isValid) {
        snapshotValidation.errors.forEach(error => {
          errors.push(new ValidationError(`Snapshot ${index}: ${error.message}`, `snapshot[${index}].${error.field}`, error.value));
        });
      }
    });
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Validates a create message DTO
 */
export function validateCreateMessageDto(dto: CreateMessageDto): ValidationResult {
  const errors: ValidationError[] = [];

  if (!dto.conversationId || typeof dto.conversationId !== 'string' || dto.conversationId.trim() === '') {
    errors.push(new ValidationError('Conversation ID is required and must be a non-empty string', 'conversationId', dto.conversationId));
  }

  if (!dto.content || typeof dto.content !== 'string' || dto.content.trim() === '') {
    errors.push(new ValidationError('Message content is required and must be a non-empty string', 'content', dto.content));
  }

  if (!dto.sender || !['user', 'ai'].includes(dto.sender)) {
    errors.push(new ValidationError('Message sender must be either "user" or "ai"', 'sender', dto.sender));
  }

  if (dto.codeChanges && !Array.isArray(dto.codeChanges)) {
    errors.push(new ValidationError('Code changes must be an array if provided', 'codeChanges', dto.codeChanges));
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Validates a code change object
 */
export function validateCodeChange(change: Partial<CodeChange>): ValidationResult {
  const errors: ValidationError[] = [];

  // Required fields
  if (!change.filePath || typeof change.filePath !== 'string' || change.filePath.trim() === '') {
    errors.push(new ValidationError('File path is required and must be a non-empty string', 'filePath', change.filePath));
  }

  if (!change.changeType || !['create', 'modify', 'delete'].includes(change.changeType)) {
    errors.push(new ValidationError('Change type must be one of: create, modify, delete', 'changeType', change.changeType));
  }

  // Content validation based on change type
  if (change.changeType === 'create' && !change.afterContent) {
    errors.push(new ValidationError('After content is required for create operations', 'afterContent', change.afterContent));
  }

  if (change.changeType === 'delete' && !change.beforeContent) {
    errors.push(new ValidationError('Before content is required for delete operations', 'beforeContent', change.beforeContent));
  }

  if (change.changeType === 'modify' && (!change.beforeContent || !change.afterContent)) {
    errors.push(new ValidationError('Both before and after content are required for modify operations', 'beforeContent/afterContent', { before: change.beforeContent, after: change.afterContent }));
  }

  // Line numbers validation
  if (change.lineNumbers) {
    if (typeof change.lineNumbers.start !== 'number' || change.lineNumbers.start < 1) {
      errors.push(new ValidationError('Line start must be a positive number', 'lineNumbers.start', change.lineNumbers.start));
    }

    if (typeof change.lineNumbers.end !== 'number' || change.lineNumbers.end < 1) {
      errors.push(new ValidationError('Line end must be a positive number', 'lineNumbers.end', change.lineNumbers.end));
    }

    if (change.lineNumbers.start > change.lineNumbers.end) {
      errors.push(new ValidationError('Line start cannot be greater than line end', 'lineNumbers', change.lineNumbers));
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Validates a file snapshot object
 */
export function validateFileSnapshot(snapshot: Partial<FileSnapshot>): ValidationResult {
  const errors: ValidationError[] = [];

  // Required fields
  if (!snapshot.filePath || typeof snapshot.filePath !== 'string' || snapshot.filePath.trim() === '') {
    errors.push(new ValidationError('File path is required and must be a non-empty string', 'filePath', snapshot.filePath));
  } else if (snapshot.filePath.includes('..')) {
    // Prevent path traversal
    errors.push(new ValidationError('File path cannot contain path traversal sequences', 'filePath', snapshot.filePath));
  }

  if (typeof snapshot.content !== 'string') {
    errors.push(new ValidationError('Content must be a string', 'content', snapshot.content));
  }

  if (typeof snapshot.timestamp !== 'number' || snapshot.timestamp <= 0) {
    errors.push(new ValidationError('Timestamp must be a positive number', 'timestamp', snapshot.timestamp));
  } else if (snapshot.timestamp > Date.now() + 60000) { // Allow 1 minute clock skew
    errors.push(new ValidationError('Timestamp cannot be in the future', 'timestamp', snapshot.timestamp));
  }

  if (!snapshot.checksum || typeof snapshot.checksum !== 'string' || snapshot.checksum.trim() === '') {
    errors.push(new ValidationError('Checksum is required and must be a non-empty string', 'checksum', snapshot.checksum));
  } else if (!/^[a-f0-9]+$/i.test(snapshot.checksum)) {
    // Ensure checksum is a valid hex string
    errors.push(new ValidationError('Checksum must be a valid hexadecimal string', 'checksum', snapshot.checksum));
  }

  // Metadata validation
  if (snapshot.metadata) {
    if (typeof snapshot.metadata.size === 'number' && snapshot.metadata.size < 0) {
      errors.push(new ValidationError('File size cannot be negative', 'metadata.size', snapshot.metadata.size));
    } else if (typeof snapshot.metadata.size === 'number' && snapshot.content) {
      // Verify size matches content length if both are provided
      const contentByteLength = new TextEncoder().encode(snapshot.content).length;
      if (Math.abs(contentByteLength - snapshot.metadata.size) > 10) { // Allow small difference due to encoding
        errors.push(new ValidationError(
          `File size (${snapshot.metadata.size}) doesn't match content length (${contentByteLength})`,
          'metadata.size',
          { declared: snapshot.metadata.size, actual: contentByteLength }
        ));
      }
    }

    if (snapshot.metadata.encoding && typeof snapshot.metadata.encoding !== 'string') {
      errors.push(new ValidationError('Encoding must be a string if provided', 'metadata.encoding', snapshot.metadata.encoding));
    }

    if (snapshot.metadata.language && typeof snapshot.metadata.language !== 'string') {
      errors.push(new ValidationError('Language must be a string if provided', 'metadata.language', snapshot.metadata.language));
    }

    if (typeof snapshot.metadata.existed !== 'undefined' && typeof snapshot.metadata.existed !== 'boolean') {
      errors.push(new ValidationError('Existed flag must be a boolean if provided', 'metadata.existed', snapshot.metadata.existed));
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Validates an array of objects using the provided validator
 */
export function validateArray<T>(
  items: T[],
  validator: (item: T) => ValidationResult,
  fieldName: string = 'items'
): ValidationResult {
  const errors: ValidationError[] = [];

  if (!Array.isArray(items)) {
    errors.push(new ValidationError(`${fieldName} must be an array`, fieldName, items));
    return { isValid: false, errors };
  }

  items.forEach((item, index) => {
    const validation = validator(item);
    if (!validation.isValid) {
      validation.errors.forEach(error => {
        errors.push(new ValidationError(`${fieldName}[${index}]: ${error.message}`, `${fieldName}[${index}].${error.field}`, error.value));
      });
    }
  });

  return {
    isValid: errors.length === 0,
    errors
  };
}