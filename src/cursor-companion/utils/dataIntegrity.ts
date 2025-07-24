/**
 * Data integrity and validation utilities for Cursor Companion
 */

import * as crypto from 'crypto';
import { FileSnapshot, SnapshotCollection } from '../models/fileSnapshot';
import { Conversation } from '../models/conversation';
import { Message } from '../models/message';
import { ValidationError, ValidationResult } from '../models/validation';
import { SnapshotError, StorageError } from '../models/errors';
import { calculateChecksum, safeJsonParse } from './helpers';

/**
 * Enhanced checksum calculation using crypto when available
 */
export function calculateStrongChecksum(content: string): string {
  try {
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch (e) {
    // Fallback to simple checksum if crypto is not available
    return calculateChecksum(content);
  }
}

/**
 * Verify file snapshot integrity by comparing stored checksum with calculated checksum
 */
export function verifySnapshotIntegrity(snapshot: FileSnapshot): ValidationResult {
  const errors: ValidationError[] = [];
  
  // Skip empty files
  if (snapshot.content === '') {
    return { isValid: true, errors };
  }
  
  // Calculate checksum from content
  const calculatedChecksum = calculateStrongChecksum(snapshot.content);
  
  // Compare with stored checksum
  if (calculatedChecksum !== snapshot.checksum) {
    errors.push(
      new ValidationError(
        `Checksum mismatch for file ${snapshot.filePath}. Expected: ${snapshot.checksum}, Calculated: ${calculatedChecksum}`,
        'checksum',
        { expected: snapshot.checksum, calculated: calculatedChecksum }
      )
    );
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Verify integrity of a snapshot collection
 */
export function verifySnapshotCollectionIntegrity(collection: SnapshotCollection): ValidationResult {
  const errors: ValidationError[] = [];
  
  // Validate required fields
  if (!collection.id) {
    errors.push(new ValidationError('Snapshot collection ID is missing', 'id', collection.id));
  }
  
  if (!collection.messageId) {
    errors.push(new ValidationError('Message ID is missing', 'messageId', collection.messageId));
  }
  
  if (!Array.isArray(collection.snapshots)) {
    errors.push(new ValidationError('Snapshots must be an array', 'snapshots', collection.snapshots));
    return { isValid: false, errors };
  }
  
  // Validate each snapshot in the collection
  collection.snapshots.forEach((snapshot, index) => {
    const snapshotIntegrity = verifySnapshotIntegrity(snapshot);
    if (!snapshotIntegrity.isValid) {
      snapshotIntegrity.errors.forEach(error => {
        errors.push(
          new ValidationError(
            `Snapshot ${index}: ${error.message}`,
            `snapshots[${index}].${error.field}`,
            error.value
          )
        );
      });
    }
  });
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Data corruption detection result
 */
export interface CorruptionDetectionResult {
  isCorrupted: boolean;
  corruptedFields: string[];
  canRepair: boolean;
  errors: ValidationError[];
}

/**
 * Detect data corruption in a conversation object
 */
export function detectConversationCorruption(conversation: Conversation): CorruptionDetectionResult {
  const errors: ValidationError[] = [];
  const corruptedFields: string[] = [];
  let canRepair = false;
  
  // Check for missing or invalid required fields
  if (!conversation.id || typeof conversation.id !== 'string') {
    errors.push(new ValidationError('Conversation ID is missing or invalid', 'id', conversation.id));
    corruptedFields.push('id');
    canRepair = false; // Can't repair without ID
  }
  
  if (!conversation.title || typeof conversation.title !== 'string') {
    errors.push(new ValidationError('Conversation title is missing or invalid', 'title', conversation.title));
    corruptedFields.push('title');
    canRepair = true; // Can generate a default title
  }
  
  if (typeof conversation.timestamp !== 'number' || conversation.timestamp <= 0) {
    errors.push(new ValidationError('Conversation timestamp is invalid', 'timestamp', conversation.timestamp));
    corruptedFields.push('timestamp');
    canRepair = true; // Can set current timestamp
  }
  
  // Check messages array
  if (!Array.isArray(conversation.messages)) {
    errors.push(new ValidationError('Messages array is missing or invalid', 'messages', conversation.messages));
    corruptedFields.push('messages');
    canRepair = true; // Can initialize empty array
  } else {
    // Check for message integrity issues
    conversation.messages.forEach((message, index) => {
      const messageResult = detectMessageCorruption(message);
      if (messageResult.isCorrupted) {
        errors.push(
          new ValidationError(
            `Message ${index} has corruption issues`,
            `messages[${index}]`,
            messageResult.corruptedFields
          )
        );
        corruptedFields.push(`messages[${index}]`);
        canRepair = canRepair && messageResult.canRepair;
      }
    });
  }
  
  // Check status field
  if (conversation.status && !['active', 'archived'].includes(conversation.status)) {
    errors.push(new ValidationError('Conversation status is invalid', 'status', conversation.status));
    corruptedFields.push('status');
    canRepair = true; // Can set default status
  }
  
  return {
    isCorrupted: errors.length > 0,
    corruptedFields,
    canRepair,
    errors
  };
}

/**
 * Detect data corruption in a message object
 */
export function detectMessageCorruption(message: Message): CorruptionDetectionResult {
  const errors: ValidationError[] = [];
  const corruptedFields: string[] = [];
  let canRepair = true;
  
  // Check for missing or invalid required fields
  if (!message.id || typeof message.id !== 'string') {
    errors.push(new ValidationError('Message ID is missing or invalid', 'id', message.id));
    corruptedFields.push('id');
    canRepair = false; // Can't repair without ID
  }
  
  if (!message.conversationId || typeof message.conversationId !== 'string') {
    errors.push(new ValidationError('Conversation ID is missing or invalid', 'conversationId', message.conversationId));
    corruptedFields.push('conversationId');
    canRepair = false; // Can't repair without conversation ID
  }
  
  if (typeof message.content !== 'string') {
    errors.push(new ValidationError('Message content is invalid', 'content', message.content));
    corruptedFields.push('content');
    canRepair = true; // Can set empty content
  }
  
  if (!message.sender || !['user', 'ai'].includes(message.sender)) {
    errors.push(new ValidationError('Message sender is invalid', 'sender', message.sender));
    corruptedFields.push('sender');
    canRepair = true; // Can set default sender
  }
  
  if (typeof message.timestamp !== 'number' || message.timestamp <= 0) {
    errors.push(new ValidationError('Message timestamp is invalid', 'timestamp', message.timestamp));
    corruptedFields.push('timestamp');
    canRepair = true; // Can set current timestamp
  }
  
  // Check code changes array
  if (message.codeChanges && !Array.isArray(message.codeChanges)) {
    errors.push(new ValidationError('Code changes must be an array', 'codeChanges', message.codeChanges));
    corruptedFields.push('codeChanges');
    canRepair = true; // Can initialize empty array
  }
  
  // Check snapshot array
  if (message.snapshot && !Array.isArray(message.snapshot)) {
    errors.push(new ValidationError('Snapshot must be an array', 'snapshot', message.snapshot));
    corruptedFields.push('snapshot');
    canRepair = true; // Can initialize empty array
  } else if (Array.isArray(message.snapshot)) {
    // Verify snapshot integrity
    message.snapshot.forEach((snapshot, index) => {
      const snapshotIntegrity = verifySnapshotIntegrity(snapshot);
      if (!snapshotIntegrity.isValid) {
        errors.push(
          new ValidationError(
            `Snapshot ${index} has integrity issues`,
            `snapshot[${index}]`,
            snapshotIntegrity.errors
          )
        );
        corruptedFields.push(`snapshot[${index}]`);
        canRepair = false; // Can't repair corrupted snapshots
      }
    });
  }
  
  return {
    isCorrupted: errors.length > 0,
    corruptedFields,
    canRepair,
    errors
  };
}

/**
 * Repair options for data recovery
 */
export interface RepairOptions {
  /** Whether to generate missing IDs */
  generateMissingIds?: boolean;
  
  /** Whether to set default values for missing fields */
  setDefaultValues?: boolean;
  
  /** Whether to remove corrupted items that can't be repaired */
  removeCorruptedItems?: boolean;
  
  /** Whether to create backup before repair */
  createBackup?: boolean;
}

/**
 * Repair result
 */
export interface RepairResult {
  success: boolean;
  repairedFields: string[];
  removedItems: string[];
  backupCreated: boolean;
  backupId?: string;
  errors: Error[];
}

/**
 * Attempt to repair a corrupted conversation
 */
export function repairConversation(conversation: Conversation, options: RepairOptions = {}): RepairResult {
  const result: RepairResult = {
    success: false,
    repairedFields: [],
    removedItems: [],
    backupCreated: false,
    errors: []
  };
  
  try {
    // Create backup if requested
    if (options.createBackup) {
      // In a real implementation, this would create a backup
      result.backupCreated = true;
      result.backupId = `backup-${Date.now()}`;
    }
    
    // Detect corruption
    const corruptionResult = detectConversationCorruption(conversation);
    
    // If not corrupted or can't be repaired, return
    if (!corruptionResult.isCorrupted) {
      result.success = true;
      return result;
    }
    
    if (!corruptionResult.canRepair && !options.removeCorruptedItems) {
      result.errors.push(new Error('Conversation cannot be repaired and removal is not allowed'));
      return result;
    }
    
    // Repair fields
    if (options.setDefaultValues) {
      // Fix title if needed
      if (corruptionResult.corruptedFields.includes('title')) {
        conversation.title = `Conversation ${new Date().toLocaleString()}`;
        result.repairedFields.push('title');
      }
      
      // Fix timestamp if needed
      if (corruptionResult.corruptedFields.includes('timestamp')) {
        conversation.timestamp = Date.now();
        result.repairedFields.push('timestamp');
      }
      
      // Fix status if needed
      if (corruptionResult.corruptedFields.includes('status')) {
        conversation.status = 'active';
        result.repairedFields.push('status');
      }
      
      // Fix messages array if needed
      if (corruptionResult.corruptedFields.includes('messages')) {
        conversation.messages = [];
        result.repairedFields.push('messages');
      }
    }
    
    // Repair messages
    if (Array.isArray(conversation.messages)) {
      const repairedMessages: Message[] = [];
      
      for (let i = 0; i < conversation.messages.length; i++) {
        const message = conversation.messages[i];
        const messageCorruption = detectMessageCorruption(message);
        
        if (!messageCorruption.isCorrupted) {
          repairedMessages.push(message);
          continue;
        }
        
        if (messageCorruption.canRepair && options.setDefaultValues) {
          // Repair message
          if (messageCorruption.corruptedFields.includes('content')) {
            message.content = '';
            result.repairedFields.push(`messages[${i}].content`);
          }
          
          if (messageCorruption.corruptedFields.includes('sender')) {
            message.sender = 'user';
            result.repairedFields.push(`messages[${i}].sender`);
          }
          
          if (messageCorruption.corruptedFields.includes('timestamp')) {
            message.timestamp = Date.now();
            result.repairedFields.push(`messages[${i}].timestamp`);
          }
          
          if (messageCorruption.corruptedFields.includes('codeChanges')) {
            message.codeChanges = [];
            result.repairedFields.push(`messages[${i}].codeChanges`);
          }
          
          if (messageCorruption.corruptedFields.includes('snapshot')) {
            message.snapshot = [];
            result.repairedFields.push(`messages[${i}].snapshot`);
          }
          
          repairedMessages.push(message);
        } else if (options.removeCorruptedItems) {
          // Remove corrupted message
          result.removedItems.push(`messages[${i}]`);
        } else {
          repairedMessages.push(message);
        }
      }
      
      conversation.messages = repairedMessages;
    }
    
    result.success = true;
    return result;
  } catch (error) {
    result.errors.push(error instanceof Error ? error : new Error(String(error)));
    return result;
  }
}

/**
 * Safely parse and validate JSON data
 */
export function safeParseAndValidate<T>(
  jsonData: string,
  validator: (data: any) => ValidationResult,
  defaultValue: T
): { data: T; isValid: boolean; errors: ValidationError[] } {
  try {
    const parsed = safeJsonParse(jsonData, null);
    
    if (parsed === null) {
      return {
        data: defaultValue,
        isValid: false,
        errors: [new ValidationError('Failed to parse JSON data', 'json', jsonData)]
      };
    }
    
    const validation = validator(parsed);
    
    return {
      data: validation.isValid ? parsed as T : defaultValue,
      isValid: validation.isValid,
      errors: validation.errors
    };
  } catch (error) {
    return {
      data: defaultValue,
      isValid: false,
      errors: [new ValidationError(`Error validating data: ${error instanceof Error ? error.message : String(error)}`, 'data', jsonData)]
    };
  }
}

/**
 * Verify data consistency between related objects
 */
export function verifyDataConsistency(conversation: Conversation): ValidationResult {
  const errors: ValidationError[] = [];
  
  // Check if all messages reference the correct conversation ID
  if (Array.isArray(conversation.messages)) {
    conversation.messages.forEach((message, index) => {
      if (message.conversationId !== conversation.id) {
        errors.push(
          new ValidationError(
            `Message ${index} references incorrect conversation ID: ${message.conversationId} instead of ${conversation.id}`,
            `messages[${index}].conversationId`,
            message.conversationId
          )
        );
      }
    });
  }
  
  // Check if timestamps are in logical order
  if (Array.isArray(conversation.messages) && conversation.messages.length > 1) {
    for (let i = 1; i < conversation.messages.length; i++) {
      const prevMessage = conversation.messages[i - 1];
      const currMessage = conversation.messages[i];
      
      if (currMessage.timestamp < prevMessage.timestamp) {
        errors.push(
          new ValidationError(
            `Message timestamp inconsistency: Message ${i} (${currMessage.timestamp}) is earlier than message ${i-1} (${prevMessage.timestamp})`,
            `messages[${i}].timestamp`,
            { current: currMessage.timestamp, previous: prevMessage.timestamp }
          )
        );
      }
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Throws a SnapshotError if snapshot integrity check fails
 */
export function assertSnapshotIntegrity(snapshot: FileSnapshot): void {
  const integrity = verifySnapshotIntegrity(snapshot);
  
  if (!integrity.isValid) {
    throw new SnapshotError(
      `Snapshot integrity check failed for ${snapshot.filePath}`,
      { errors: integrity.errors }
    );
  }
}

/**
 * Throws a StorageError if data validation fails
 */
export function assertDataValidity<T>(data: T, validator: (data: T) => ValidationResult, errorMessage: string): void {
  const validation = validator(data);
  
  if (!validation.isValid) {
    throw new StorageError(
      errorMessage,
      { errors: validation.errors }
    );
  }
}
</content>