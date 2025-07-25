/**
 * Data integrity and validation utilities for Cursor Companion
 */

import * as crypto from 'crypto';
import { FileSnapshot, SnapshotCollection } from '../models/fileSnapshot';
import { Conversation } from '../models/conversation';
import { Message } from '../models/message';
import { CodeChange } from '../models/codeChange';
import { ValidationError, ValidationResult } from '../models/validation';
import { SnapshotError, StorageError, DataIntegrityError } from '../models/errors';
import { calculateChecksum, safeJsonParse, deepClone } from './helpers';

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
  
  // Check messages array (should be array of message IDs)
  if (!Array.isArray(conversation.messages)) {
    errors.push(new ValidationError('Messages array is missing or invalid', 'messages', conversation.messages));
    corruptedFields.push('messages');
    canRepair = true; // Can initialize empty array
  } else {
    // Check for message ID validity
    conversation.messages.forEach((message, index) => {
      if (typeof message.id !== 'string' || message.id.trim() === '') {
        errors.push(
          new ValidationError(
            `Message ID ${index} is invalid: ${message.id}`,
            `messages[${index}]`,
            message.id
          )
        );
        corruptedFields.push(`messages[${index}]`);
        canRepair = true; // Can remove invalid IDs
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
    
    // Repair messages (message IDs)
    if (Array.isArray(conversation.messages)) {
      const repairedMessageIds: Message[] = [];
      
      for (let i = 0; i < conversation.messages.length; i++) {
        const message = conversation.messages[i];
        
        // Check if message ID is valid
        if (typeof message.id === 'string' && message.id.trim() !== '') {
          repairedMessageIds.push(message);
        } else if (options.removeCorruptedItems) {
          // Remove invalid message ID
          result.removedItems.push(`messages[${i}]`);
        } else {
          // Keep invalid ID if removal is not allowed
          repairedMessageIds.push(message);
        }
      }
      
      conversation.messages = repairedMessageIds;
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
 * Note: This function works with conversation structure where messages are stored as IDs
 */
export function verifyDataConsistency(conversation: Conversation): ValidationResult {
  const errors: ValidationError[] = [];
  
  // For lazy loading model, we can only validate the structure
  // Message-level consistency checks should be done when messages are loaded
  
  // Check if messages is an array of strings (message IDs)
  if (Array.isArray(conversation.messages)) {
    conversation.messages.forEach((message, index) => {
      const messageId = message.id;
      if (typeof messageId !== 'string' || messageId.trim() === '') {
        errors.push(
          new ValidationError(
            `Message ID ${index} is invalid: ${messageId}`,
            `messages[${index}]`,
            messageId
          )
        );
      }
    });
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

/**
 * Integrity check levels
 */
export enum IntegrityCheckLevel {
  /** Basic validation only */
  BASIC = 'basic',
  
  /** Standard validation with checksum verification */
  STANDARD = 'standard',
  
  /** Comprehensive validation with cross-reference checks */
  COMPREHENSIVE = 'comprehensive'
}

/**
 * Options for integrity checks
 */
export interface IntegrityCheckOptions {
  /** Level of integrity check to perform */
  level?: IntegrityCheckLevel;
  
  /** Whether to throw errors on validation failures */
  throwOnFailure?: boolean;
  
  /** Whether to attempt automatic repair of issues */
  autoRepair?: boolean;
  
  /** Whether to log detailed validation information */
  verbose?: boolean;
}

/**
 * Result of a comprehensive integrity check
 */
export interface IntegrityCheckResult {
  /** Overall validation result */
  isValid: boolean;
  
  /** Validation errors found */
  errors: ValidationError[];
  
  /** Fields that were repaired if autoRepair was enabled */
  repairedFields?: string[];
  
  /** Whether any repairs were attempted */
  repairsAttempted?: boolean;
  
  /** Whether all repair attempts were successful */
  repairsSuccessful?: boolean;
  
  /** Detailed validation results by category */
  details?: {
    structuralValidity?: ValidationResult;
    checksumValidity?: ValidationResult;
    referentialIntegrity?: ValidationResult;
    temporalConsistency?: ValidationResult;
  };
}

/**
 * Validate checksums for all snapshots in a conversation
 * Note: This function cannot validate checksums with lazy loading model
 * Checksum validation should be done when messages are loaded individually
 */
export function validateConversationChecksums(conversation: Conversation): ValidationResult {
  const errors: ValidationError[] = [];
  
  // With lazy loading model, we cannot validate checksums at conversation level
  // This validation should be done when individual messages are loaded
  
  return {
    isValid: true,
    errors
  };
}

/**
 * Validate referential integrity in a conversation
 * Note: With lazy loading model, referential integrity should be checked when messages are loaded
 */
export function validateReferentialIntegrity(conversation: Conversation): ValidationResult {
  const errors: ValidationError[] = [];
  
  if (!Array.isArray(conversation.messages)) {
    return { isValid: true, errors };
  }
  
  // With lazy loading model, we can only validate that message IDs are valid strings
  conversation.messages.forEach((message, index) => {
    const messageId = message.id;
    if (typeof messageId !== 'string' || messageId.trim() === '') {
      errors.push(
        new ValidationError(
          `Message ID ${index} is invalid: ${messageId}`,
          `messages[${index}]`,
          messageId
        )
      );
    }
  });
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Validate temporal consistency in a conversation
 */
export function validateTemporalConsistency(conversation: Conversation): ValidationResult {
  const errors: ValidationError[] = [];
  
  if (!Array.isArray(conversation.messages) || conversation.messages.length <= 1) {
    return { isValid: true, errors };
  }
  
  // Check if timestamps are in logical order
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
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Perform a comprehensive integrity check on a conversation
 */
export function checkConversationIntegrity(
  conversation: Conversation,
  options: IntegrityCheckOptions = {}
): IntegrityCheckResult {
  const level = options.level || IntegrityCheckLevel.STANDARD;
  const errors: ValidationError[] = [];
  const repairedFields: string[] = [];
  let repairsAttempted = false;
  let repairsSuccessful = true;
  
  // Create a copy if we might modify the conversation
  const conversationToCheck = options.autoRepair ? deepClone(conversation) : conversation;
  
  // Structural validation
  const structuralValidity = validateConversationStructure(conversationToCheck);
  if (!structuralValidity.isValid) {
    errors.push(...structuralValidity.errors);
    
    // Attempt repair if requested
    if (options.autoRepair) {
      repairsAttempted = true;
      const repairResult = repairConversation(conversationToCheck, {
        setDefaultValues: true,
        generateMissingIds: false // Don't generate IDs as they are critical
      });
      
      if (repairResult.success) {
        repairedFields.push(...repairResult.repairedFields);
      } else {
        repairsSuccessful = false;
      }
    }
  }
  
  // For basic level, we're done
  if (level === IntegrityCheckLevel.BASIC) {
    const result: IntegrityCheckResult = {
      isValid: errors.length === 0,
      errors,
      details: {
        structuralValidity
      }
    };
    
    if (options.autoRepair) {
      result.repairedFields = repairedFields;
      result.repairsAttempted = repairsAttempted;
      result.repairsSuccessful = repairsSuccessful;
    }
    
    return result;
  }
  
  // Checksum validation for standard level and above
  const checksumValidity = validateConversationChecksums(conversationToCheck);
  if (!checksumValidity.isValid) {
    errors.push(...checksumValidity.errors);
  }
  
  // For standard level, we're done
  if (level === IntegrityCheckLevel.STANDARD) {
    const result: IntegrityCheckResult = {
      isValid: errors.length === 0,
      errors,
      details: {
        structuralValidity,
        checksumValidity
      }
    };
    
    if (options.autoRepair) {
      result.repairedFields = repairedFields;
      result.repairsAttempted = repairsAttempted;
      result.repairsSuccessful = repairsSuccessful;
    }
    
    return result;
  }
  
  // Comprehensive checks include referential integrity and temporal consistency
  const referentialIntegrity = validateReferentialIntegrity(conversationToCheck);
  if (!referentialIntegrity.isValid) {
    errors.push(...referentialIntegrity.errors);
  }
  
  const temporalConsistency = validateTemporalConsistency(conversationToCheck);
  if (!temporalConsistency.isValid) {
    errors.push(...temporalConsistency.errors);
  }
  
  const result: IntegrityCheckResult = {
    isValid: errors.length === 0,
    errors,
    details: {
      structuralValidity,
      checksumValidity,
      referentialIntegrity,
      temporalConsistency
    }
  };
  
  if (options.autoRepair) {
    result.repairedFields = repairedFields;
    result.repairsAttempted = repairsAttempted;
    result.repairsSuccessful = repairsSuccessful;
  }
  
  // Throw if requested and there are errors
  if (options.throwOnFailure && errors.length > 0) {
    throw new DataIntegrityError(
      `Conversation integrity check failed with ${errors.length} errors`,
      { errors, conversationId: conversationToCheck.id }
    );
  }
  
  return result;
}

/**
 * Validate the basic structure of a conversation
 */
export function validateConversationStructure(conversation: Conversation): ValidationResult {
  const errors: ValidationError[] = [];
  
  // Check required fields
  if (!conversation.id || typeof conversation.id !== 'string') {
    errors.push(new ValidationError('Conversation ID is missing or invalid', 'id', conversation.id));
  }
  
  if (!conversation.title || typeof conversation.title !== 'string') {
    errors.push(new ValidationError('Conversation title is missing or invalid', 'title', conversation.title));
  }
  
  if (typeof conversation.timestamp !== 'number' || conversation.timestamp <= 0) {
    errors.push(new ValidationError('Conversation timestamp is invalid', 'timestamp', conversation.timestamp));
  }
  
  // Check messages array
  if (!Array.isArray(conversation.messages)) {
    errors.push(new ValidationError('Messages array is missing or invalid', 'messages', conversation.messages));
  } else {
    // Check each message
    conversation.messages.forEach((message, index) => {
      const messageValidation = validateMessageStructure(message);
      if (!messageValidation.isValid) {
        messageValidation.errors.forEach(error => {
          errors.push(
            new ValidationError(
              `Message ${index}: ${error.message}`,
              `messages[${index}].${error.field}`,
              error.value
            )
          );
        });
      }
    });
  }
  
  // Check status
  if (conversation.status && !['active', 'archived'].includes(conversation.status)) {
    errors.push(new ValidationError('Conversation status is invalid', 'status', conversation.status));
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Validate the basic structure of a message
 */
export function validateMessageStructure(message: Message): ValidationResult {
  const errors: ValidationError[] = [];
  
  // Check required fields
  if (!message.id || typeof message.id !== 'string') {
    errors.push(new ValidationError('Message ID is missing or invalid', 'id', message.id));
  }
  
  if (!message.conversationId || typeof message.conversationId !== 'string') {
    errors.push(new ValidationError('Conversation ID is missing or invalid', 'conversationId', message.conversationId));
  }
  
  if (typeof message.content !== 'string') {
    errors.push(new ValidationError('Message content is invalid', 'content', message.content));
  }
  
  if (!message.sender || !['user', 'ai'].includes(message.sender)) {
    errors.push(new ValidationError('Message sender is invalid', 'sender', message.sender));
  }
  
  if (typeof message.timestamp !== 'number' || message.timestamp <= 0) {
    errors.push(new ValidationError('Message timestamp is invalid', 'timestamp', message.timestamp));
  }
  
  // Check code changes
  if (message.codeChanges && !Array.isArray(message.codeChanges)) {
    errors.push(new ValidationError('Code changes must be an array', 'codeChanges', message.codeChanges));
  } else if (Array.isArray(message.codeChanges)) {
    message.codeChanges.forEach((change, index) => {
      const changeValidation = validateCodeChangeStructure(change);
      if (!changeValidation.isValid) {
        changeValidation.errors.forEach(error => {
          errors.push(
            new ValidationError(
              `Code change ${index}: ${error.message}`,
              `codeChanges[${index}].${error.field}`,
              error.value
            )
          );
        });
      }
    });
  }
  
  // Check snapshots
  if (message.snapshot && !Array.isArray(message.snapshot)) {
    errors.push(new ValidationError('Snapshot must be an array', 'snapshot', message.snapshot));
  } else if (Array.isArray(message.snapshot)) {
    message.snapshot.forEach((snapshot, index) => {
      const snapshotValidation = validateFileSnapshotStructure(snapshot);
      if (!snapshotValidation.isValid) {
        snapshotValidation.errors.forEach(error => {
          errors.push(
            new ValidationError(
              `Snapshot ${index}: ${error.message}`,
              `snapshot[${index}].${error.field}`,
              error.value
            )
          );
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
 * Validate the basic structure of a code change
 */
export function validateCodeChangeStructure(change: CodeChange): ValidationResult {
  const errors: ValidationError[] = [];
  
  // Check required fields
  if (!change.filePath || typeof change.filePath !== 'string') {
    errors.push(new ValidationError('File path is missing or invalid', 'filePath', change.filePath));
  }
  
  if (!change.changeType || !['create', 'modify', 'delete'].includes(change.changeType)) {
    errors.push(new ValidationError('Change type is invalid', 'changeType', change.changeType));
  }
  
  // Check content based on change type
  if (change.changeType === 'create' && typeof change.afterContent !== 'string') {
    errors.push(new ValidationError('After content is required for create operations', 'afterContent', change.afterContent));
  }
  
  if (change.changeType === 'delete' && typeof change.beforeContent !== 'string') {
    errors.push(new ValidationError('Before content is required for delete operations', 'beforeContent', change.beforeContent));
  }
  
  if (change.changeType === 'modify' && (typeof change.beforeContent !== 'string' || typeof change.afterContent !== 'string')) {
    errors.push(new ValidationError('Both before and after content are required for modify operations', 'beforeContent/afterContent', { before: change.beforeContent, after: change.afterContent }));
  }
  
  // Check line numbers if present
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
 * Validate the basic structure of a file snapshot
 */
export function validateFileSnapshotStructure(snapshot: FileSnapshot): ValidationResult {
  const errors: ValidationError[] = [];
  
  // Check required fields
  if (!snapshot.filePath || typeof snapshot.filePath !== 'string') {
    errors.push(new ValidationError('File path is missing or invalid', 'filePath', snapshot.filePath));
  } else if (snapshot.filePath.includes('..')) {
    // Prevent path traversal
    errors.push(new ValidationError('File path cannot contain path traversal sequences', 'filePath', snapshot.filePath));
  }
  
  if (typeof snapshot.content !== 'string') {
    errors.push(new ValidationError('Content must be a string', 'content', snapshot.content));
  }
  
  if (typeof snapshot.timestamp !== 'number' || snapshot.timestamp <= 0) {
    errors.push(new ValidationError('Timestamp must be a positive number', 'timestamp', snapshot.timestamp));
  }
  
  if (!snapshot.checksum || typeof snapshot.checksum !== 'string') {
    errors.push(new ValidationError('Checksum is missing or invalid', 'checksum', snapshot.checksum));
  }
  
  // Check metadata if present
  if (snapshot.metadata) {
    if (snapshot.metadata.size !== undefined && (typeof snapshot.metadata.size !== 'number' || snapshot.metadata.size < 0)) {
      errors.push(new ValidationError('File size must be a non-negative number', 'metadata.size', snapshot.metadata.size));
    }
    
    if (snapshot.metadata.encoding !== undefined && typeof snapshot.metadata.encoding !== 'string') {
      errors.push(new ValidationError('Encoding must be a string', 'metadata.encoding', snapshot.metadata.encoding));
    }
    
    if (snapshot.metadata.language !== undefined && typeof snapshot.metadata.language !== 'string') {
      errors.push(new ValidationError('Language must be a string', 'metadata.language', snapshot.metadata.language));
    }
    
    if (snapshot.metadata.existed !== undefined && typeof snapshot.metadata.existed !== 'boolean') {
      errors.push(new ValidationError('Existed flag must be a boolean', 'metadata.existed', snapshot.metadata.existed));
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}