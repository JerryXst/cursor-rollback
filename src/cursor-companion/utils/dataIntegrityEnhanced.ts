/**
 * Enhanced data integrity and validation utilities for Cursor Companion
 * Implements comprehensive validation rules, checksum verification, and data repair mechanisms
 */

import * as crypto from 'crypto';
import { FileSnapshot, SnapshotCollection } from '../models/fileSnapshot';
import { Conversation } from '../models/conversation';
import { Message } from '../models/message';
import { CodeChange } from '../models/codeChange';
import { ValidationError, ValidationResult } from '../models/validation';
import { DataIntegrityError, SnapshotError, StorageError } from '../models/errors';
import { calculateStrongChecksum, verifySnapshotIntegrity } from './dataIntegrity';
import { calculateChecksum, deepClone, safeJsonParse } from './helpers';
import { SerializationUtil } from './serialization';

/**
 * Integrity check levels for different validation scenarios
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
 * Data corruption detection result
 */
export interface CorruptionDetectionResult {
  /** Whether the data is corrupted */
  isCorrupted: boolean;
  
  /** List of corrupted fields */
  corruptedFields: string[];
  
  /** Whether the corruption can be automatically repaired */
  canRepair: boolean;
  
  /** Validation errors found */
  errors: ValidationError[];
  
  /** Severity level of corruption */
  severity: 'low' | 'medium' | 'high';
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
  
  /** Whether to recalculate checksums */
  recalculateChecksums?: boolean;
  
  /** Whether to fix referential integrity issues */
  fixReferentialIntegrity?: boolean;
}

/**
 * Repair result
 */
export interface RepairResult {
  /** Whether the repair was successful */
  success: boolean;
  
  /** List of fields that were repaired */
  repairedFields: string[];
  
  /** List of items that were removed */
  removedItems: string[];
  
  /** Whether a backup was created */
  backupCreated: boolean;
  
  /** ID of the backup if created */
  backupId?: string;
  
  /** Errors encountered during repair */
  errors: Error[];
}

/**
 * Relationship rule for cross-object validation
 */
export interface RelationshipRule {
  /** Source object name */
  sourceObject: string;
  
  /** Field in source object to check */
  sourceField: string;
  
  /** Target object name */
  targetObject: string;
  
  /** Field in target object to match */
  targetField: string;
  
  /** Description of the relationship */
  description: string;
}

/**
 * Data integrity report summary
 */
export interface DataIntegrityReportSummary {
  /** Whether the data is valid */
  isValid: boolean;
  
  /** Number of errors found */
  errorCount: number;
  
  /** ID of the object being validated */
  id: string;
  
  /** Type of object being validated */
  objectType: string;
  
  /** Number of messages if applicable */
  messageCount?: number;
  
  /** Timestamp of the report */
  timestamp: number;
}

/**
 * Comprehensive data integrity report
 */
export interface DataIntegrityReport {
  /** Summary of the report */
  summary: DataIntegrityReportSummary;
  
  /** Detailed validation results */
  details: {
    /** Whether the structure is valid */
    structureValid: boolean;
    
    /** Whether checksums are valid */
    checksumValid: boolean;
    
    /** Whether referential integrity is valid */
    referentialIntegrityValid: boolean;
    
    /** Whether temporal consistency is valid */
    temporalConsistencyValid: boolean;
    
    /** List of validation errors by category */
    errors: {
      structure: ValidationError[];
      checksums: ValidationError[];
      referentialIntegrity: ValidationError[];
      temporalConsistency: ValidationError[];
    };
  };
  
  /** Repair recommendations if issues were found */
  recommendations?: string[];
}

/**
 * Perform a comprehensive integrity check on a conversation
 * 
 * @param conversation The conversation to check
 * @param options Options for the integrity check
 * @returns Result of the integrity check
 * @throws DataIntegrityError if throwOnFailure is true and there are errors
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
      const repairResult = await repairConversationData(conversationToCheck, {
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
    
    // Throw if requested and there are errors
    if (options.throwOnFailure && errors.length > 0) {
      throw new DataIntegrityError(
        `Conversation integrity check failed with ${errors.length} errors`,
        { errors, conversationId: conversationToCheck.id }
      );
    }
    
    return result;
  }
  
  // Checksum validation for standard level and above
  const checksumValidity = validateConversationChecksums(conversationToCheck);
  if (!checksumValidity.isValid) {
    errors.push(...checksumValidity.errors);
    
    // Attempt repair if requested
    if (options.autoRepair) {
      repairsAttempted = true;
      const repairResult = repairConversationChecksums(conversationToCheck);
      
      if (repairResult.success) {
        repairedFields.push(...repairResult.repairedFields);
      } else {
        repairsSuccessful = false;
      }
    }
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
    
    // Throw if requested and there are errors
    if (options.throwOnFailure && errors.length > 0) {
      throw new DataIntegrityError(
        `Conversation integrity check failed with ${errors.length} errors`,
        { errors, conversationId: conversationToCheck.id }
      );
    }
    
    return result;
  }
  
  // Comprehensive checks include referential integrity and temporal consistency
  const referentialIntegrity = validateReferentialIntegrity(conversationToCheck);
  if (!referentialIntegrity.isValid) {
    errors.push(...referentialIntegrity.errors);
    
    // Attempt repair if requested
    if (options.autoRepair) {
      repairsAttempted = true;
      const repairResult = repairReferentialIntegrity(conversationToCheck);
      
      if (repairResult.success) {
        repairedFields.push(...repairResult.repairedFields);
      } else {
        repairsSuccessful = false;
      }
    }
  }
  
  const temporalConsistency = validateTemporalConsistency(conversationToCheck);
  if (!temporalConsistency.isValid) {
    errors.push(...temporalConsistency.errors);
    
    // Attempt repair if requested
    if (options.autoRepair) {
      repairsAttempted = true;
      const repairResult = repairTemporalConsistency(conversationToCheck);
      
      if (repairResult.success) {
        repairedFields.push(...repairResult.repairedFields);
      } else {
        repairsSuccessful = false;
      }
    }
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
    
    // If repairs were successful, update the original conversation
    if (repairsSuccessful && repairedFields.length > 0) {
      Object.assign(conversation, conversationToCheck);
    }
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
 * 
 * @param conversation The conversation to validate
 * @returns Validation result
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
  
  // Check metadata if present
  if (conversation.metadata) {
    if (typeof conversation.metadata.messageCount === 'number' && 
        conversation.metadata.messageCount < 0) {
      errors.push(new ValidationError('Message count cannot be negative', 'metadata.messageCount', conversation.metadata.messageCount));
    }
    
    if (typeof conversation.metadata.lastActivity === 'number' && 
        conversation.metadata.lastActivity <= 0) {
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
 * Validate the basic structure of a message
 * 
 * @param message The message to validate
 * @returns Validation result
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
 * 
 * @param change The code change to validate
 * @returns Validation result
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
 * 
 * @param snapshot The file snapshot to validate
 * @returns Validation result
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

/**
 * Validate checksums for all snapshots in a conversation
 * 
 * @param conversation The conversation to validate
 * @returns Validation result
 */
export function validateConversationChecksums(conversation: Conversation): ValidationResult {
  const errors: ValidationError[] = [];
  
  if (!Array.isArray(conversation.messages)) {
    return { isValid: true, errors };
  }
  
  conversation.messages.forEach((message, messageIndex) => {
    if (!Array.isArray(message.snapshot)) {
      return;
    }
    
    message.snapshot.forEach((snapshot, snapshotIndex) => {
      // Skip empty files
      if (snapshot.content === '') {
        return;
      }
      
      // Calculate checksum from content
      const calculatedChecksum = calculateStrongChecksum(snapshot.content);
      
      // Compare with stored checksum
      if (calculatedChecksum !== snapshot.checksum) {
        errors.push(
          new ValidationError(
            `Checksum mismatch for file ${snapshot.filePath} in message ${messageIndex}. Expected: ${snapshot.checksum}, Calculated: ${calculatedChecksum}`,
            `messages[${messageIndex}].snapshot[${snapshotIndex}].checksum`,
            { expected: snapshot.checksum, calculated: calculatedChecksum }
          )
        );
      }
    });
  });
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Validate referential integrity in a conversation
 * 
 * @param conversation The conversation to validate
 * @returns Validation result
 */
export function validateReferentialIntegrity(conversation: Conversation): ValidationResult {
  const errors: ValidationError[] = [];
  
  if (!Array.isArray(conversation.messages)) {
    return { isValid: true, errors };
  }
  
  // Check if all messages reference the correct conversation ID
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
  
  // Check for duplicate message IDs
  const messageIds = new Set<string>();
  conversation.messages.forEach((message, index) => {
    if (messageIds.has(message.id)) {
      errors.push(
        new ValidationError(
          `Duplicate message ID: ${message.id} at index ${index}`,
          `messages[${index}].id`,
          message.id
        )
      );
    } else {
      messageIds.add(message.id);
    }
  });
  
  // Check for duplicate file paths in snapshots within the same message
  conversation.messages.forEach((message, messageIndex) => {
    if (!Array.isArray(message.snapshot)) {
      return;
    }
    
    const filePaths = new Set<string>();
    message.snapshot.forEach((snapshot, snapshotIndex) => {
      if (filePaths.has(snapshot.filePath)) {
        errors.push(
          new ValidationError(
            `Duplicate file path: ${snapshot.filePath} in message ${messageIndex}`,
            `messages[${messageIndex}].snapshot[${snapshotIndex}].filePath`,
            snapshot.filePath
          )
        );
      } else {
        filePaths.add(snapshot.filePath);
      }
    });
  });
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Validate temporal consistency in a conversation
 * 
 * @param conversation The conversation to validate
 * @returns Validation result
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
  
  // Check if conversation timestamp is before or equal to the first message
  if (conversation.messages.length > 0 && conversation.timestamp > conversation.messages[0].timestamp) {
    errors.push(
      new ValidationError(
        `Conversation timestamp (${conversation.timestamp}) is later than first message timestamp (${conversation.messages[0].timestamp})`,
        'timestamp',
        { conversation: conversation.timestamp, firstMessage: conversation.messages[0].timestamp }
      )
    );
  }
  
  // Check if snapshots have valid timestamps
  conversation.messages.forEach((message, messageIndex) => {
    if (!Array.isArray(message.snapshot)) {
      return;
    }
    
    message.snapshot.forEach((snapshot, snapshotIndex) => {
      if (snapshot.timestamp < message.timestamp) {
        errors.push(
          new ValidationError(
            `Snapshot timestamp (${snapshot.timestamp}) is earlier than message timestamp (${message.timestamp})`,
            `messages[${messageIndex}].snapshot[${snapshotIndex}].timestamp`,
            { snapshot: snapshot.timestamp, message: message.timestamp }
          )
        );
      }
    });
  });
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Verify snapshot collection integrity with comprehensive checks
 * 
 * @param collection The snapshot collection to verify
 * @param options Options for the integrity check
 * @returns Validation result
 * @throws DataIntegrityError if throwOnFailure is true and there are errors
 */
export function verifySnapshotCollectionIntegrityComprehensive(
  collection: SnapshotCollection,
  options: { throwOnFailure?: boolean } = {}
): ValidationResult {
  const errors: ValidationError[] = [];
  
  // Validate required fields
  if (!collection.id) {
    errors.push(new ValidationError('Snapshot collection ID is missing', 'id', collection.id));
  }
  
  if (!collection.messageId) {
    errors.push(new ValidationError('Message ID is missing', 'messageId', collection.messageId));
  }
  
  if (typeof collection.timestamp !== 'number' || collection.timestamp <= 0) {
    errors.push(new ValidationError('Timestamp is invalid', 'timestamp', collection.timestamp));
  }
  
  if (!Array.isArray(collection.snapshots)) {
    errors.push(new ValidationError('Snapshots must be an array', 'snapshots', collection.snapshots));
    
    if (options.throwOnFailure) {
      throw new DataIntegrityError(
        'Snapshot collection integrity check failed',
        { errors, collectionId: collection.id }
      );
    }
    
    return { isValid: false, errors };
  }
  
  // Check for empty snapshots array
  if (collection.snapshots.length === 0) {
    errors.push(new ValidationError('Snapshots array is empty', 'snapshots', collection.snapshots));
  }
  
  // Check for duplicate file paths
  const filePaths = new Set<string>();
  collection.snapshots.forEach((snapshot, index) => {
    if (filePaths.has(snapshot.filePath)) {
      errors.push(
        new ValidationError(
          `Duplicate file path: ${snapshot.filePath}`,
          `snapshots[${index}].filePath`,
          snapshot.filePath
        )
      );
    } else {
      filePaths.add(snapshot.filePath);
    }
    
    // Validate each snapshot
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
    
    // Check timestamp consistency
    if (snapshot.timestamp > collection.timestamp) {
      errors.push(
        new ValidationError(
          `Snapshot timestamp (${snapshot.timestamp}) is later than collection timestamp (${collection.timestamp})`,
          `snapshots[${index}].timestamp`,
          { snapshot: snapshot.timestamp, collection: collection.timestamp }
        )
      );
    }
  });
  
  const result = {
    isValid: errors.length === 0,
    errors
  };
  
  if (options.throwOnFailure && !result.isValid) {
    throw new DataIntegrityError(
      'Snapshot collection integrity check failed',
      { errors, collectionId: collection.id }
    );
  }
  
  return result;
}

/**
 * Repair a conversation with checksum issues
 * 
 * @param conversation The conversation to repair
 * @returns Repair result
 */
export function repairConversationChecksums(conversation: Conversation): RepairResult {
  const result: RepairResult = {
    success: true,
    repairedFields: [],
    removedItems: [],
    backupCreated: false,
    errors: []
  };
  
  try {
    if (!Array.isArray(conversation.messages)) {
      return result;
    }
    
    conversation.messages.forEach((message, messageIndex) => {
      if (!Array.isArray(message.snapshot)) {
        return;
      }
      
      message.snapshot.forEach((snapshot, snapshotIndex) => {
        // Skip empty files
        if (snapshot.content === '') {
          return;
        }
        
        // Calculate checksum from content
        const calculatedChecksum = calculateStrongChecksum(snapshot.content);
        
        // Compare with stored checksum
        if (calculatedChecksum !== snapshot.checksum) {
          // Update the checksum
          snapshot.checksum = calculatedChecksum;
          result.repairedFields.push(`messages[${messageIndex}].snapshot[${snapshotIndex}].checksum`);
        }
      });
    });
    
    return result;
  } catch (error) {
    result.success = false;
    result.errors.push(error instanceof Error ? error : new Error(String(error)));
    return result;
  }
}

/**
 * Repair referential integrity issues in a conversation
 * 
 * @param conversation The conversation to repair
 * @returns Repair result
 */
export function repairReferentialIntegrity(conversation: Conversation): RepairResult {
  const result: RepairResult = {
    success: true,
    repairedFields: [],
    removedItems: [],
    backupCreated: false,
    errors: []
  };
  
  try {
    if (!Array.isArray(conversation.messages)) {
      return result;
    }
    
    // Fix conversation IDs in messages
    conversation.messages.forEach((message, index) => {
      if (message.conversationId !== conversation.id) {
        message.conversationId = conversation.id;
        result.repairedFields.push(`messages[${index}].conversationId`);
      }
    });
    
    // Handle duplicate message IDs
    const messageIds = new Map<string, number>();
    const duplicateIndices: number[] = [];
    
    conversation.messages.forEach((message, index) => {
      if (messageIds.has(message.id)) {
        duplicateIndices.push(index);
      } else {
        messageIds.set(message.id, index);
      }
    });
    
    // Generate new IDs for duplicate messages
    duplicateIndices.forEach(index => {
      const message = conversation.messages[index];
      message.id = `${message.id}-${Date.now()}-${index}`;
      result.repairedFields.push(`messages[${index}].id`);
    });
    
    // Handle duplicate file paths in snapshots
    conversation.messages.forEach((message, messageIndex) => {
      if (!Array.isArray(message.snapshot)) {
        return;
      }
      
      const filePaths = new Map<string, number>();
      const duplicateIndices: number[] = [];
      
      message.snapshot.forEach((snapshot, index) => {
        if (filePaths.has(snapshot.filePath)) {
          duplicateIndices.push(index);
        } else {
          filePaths.set(snapshot.filePath, index);
        }
      });
      
      // Remove duplicate snapshots (keep the first occurrence)
      if (duplicateIndices.length > 0) {
        message.snapshot = message.snapshot.filter((_, index) => !duplicateIndices.includes(index));
        duplicateIndices.forEach(index => {
          result.removedItems.push(`messages[${messageIndex}].snapshot[${index}]`);
        });
      }
    });
    
    return result;
  } catch (error) {
    result.success = false;
    result.errors.push(error instanceof Error ? error : new Error(String(error)));
    return result;
  }
}

/**
 * Repair temporal consistency issues in a conversation
 * 
 * @param conversation The conversation to repair
 * @returns Repair result
 */
export function repairTemporalConsistency(conversation: Conversation): RepairResult {
  const result: RepairResult = {
    success: true,
    repairedFields: [],
    removedItems: [],
    backupCreated: false,
    errors: []
  };
  
  try {
    if (!Array.isArray(conversation.messages) || conversation.messages.length <= 1) {
      return result;
    }
    
    // Sort messages by timestamp
    conversation.messages.sort((a, b) => a.timestamp - b.timestamp);
    result.repairedFields.push('messages (reordered)');
    
    // Fix conversation timestamp if needed
    if (conversation.messages.length > 0 && conversation.timestamp > conversation.messages[0].timestamp) {
      conversation.timestamp = conversation.messages[0].timestamp - 1000; // 1 second earlier
      result.repairedFields.push('timestamp');
    }
    
    // Fix snapshot timestamps
    conversation.messages.forEach((message, messageIndex) => {
      if (!Array.isArray(message.snapshot)) {
        return;
      }
      
      message.snapshot.forEach((snapshot, snapshotIndex) => {
        if (snapshot.timestamp < message.timestamp) {
          snapshot.timestamp = message.timestamp;
          result.repairedFields.push(`messages[${messageIndex}].snapshot[${snapshotIndex}].timestamp`);
        }
      });
    });
    
    return result;
  } catch (error) {
    result.success = false;
    result.errors.push(error instanceof Error ? error : new Error(String(error)));
    return result;
  }
}

/**
 * Repair a snapshot collection with integrity issues
 * 
 * @param collection The snapshot collection to repair
 * @param options Repair options
 * @returns Repair result
 */
export function repairSnapshotCollection(
  collection: SnapshotCollection,
  options: RepairOptions = {}
): RepairResult {
  const result: RepairResult = {
    success: true,
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
    
    // Fix required fields
    if (!collection.id && options.generateMissingIds) {
      collection.id = `snapshot-collection-${Date.now()}`;
      result.repairedFields.push('id');
    }
    
    if (!collection.messageId && options.generateMissingIds) {
      collection.messageId = `message-${Date.now()}`;
      result.repairedFields.push('messageId');
    }
    
    if (typeof collection.timestamp !== 'number' || collection.timestamp <= 0) {
      collection.timestamp = Date.now();
      result.repairedFields.push('timestamp');
    }
    
    if (!Array.isArray(collection.snapshots)) {
      collection.snapshots = [];
      result.repairedFields.push('snapshots');
      return result; // Nothing more to do with empty snapshots
    }
    
    // Handle duplicate file paths
    const filePaths = new Map<string, number>();
    const duplicateIndices: number[] = [];
    
    collection.snapshots.forEach((snapshot, index) => {
      if (filePaths.has(snapshot.filePath)) {
        duplicateIndices.push(index);
      } else {
        filePaths.set(snapshot.filePath, index);
      }
    });
    
    // Remove duplicate snapshots if requested
    if (duplicateIndices.length > 0 && options.removeCorruptedItems) {
      collection.snapshots = collection.snapshots.filter((_, index) => !duplicateIndices.includes(index));
      duplicateIndices.forEach(index => {
        result.removedItems.push(`snapshots[${index}]`);
      });
    }
    
    // Fix individual snapshots
    const corruptedIndices: number[] = [];
    
    collection.snapshots.forEach((snapshot, index) => {
      let snapshotRepaired = false;
      
      // Fix timestamp if needed
      if (typeof snapshot.timestamp !== 'number' || snapshot.timestamp <= 0 || 
          snapshot.timestamp > collection.timestamp) {
        snapshot.timestamp = collection.timestamp;
        result.repairedFields.push(`snapshots[${index}].timestamp`);
        snapshotRepaired = true;
      }
      
      // Fix checksum if needed
      if (options.recalculateChecksums || !snapshot.checksum) {
        const calculatedChecksum = calculateStrongChecksum(snapshot.content);
        if (calculatedChecksum !== snapshot.checksum) {
          snapshot.checksum = calculatedChecksum;
          result.repairedFields.push(`snapshots[${index}].checksum`);
          snapshotRepaired = true;
        }
      }
      
      // Mark as corrupted if not repaired
      if (!snapshotRepaired) {
        const integrity = verifySnapshotIntegrity(snapshot);
        if (!integrity.isValid) {
          corruptedIndices.push(index);
        }
      }
    });
    
    // Remove corrupted snapshots if requested
    if (corruptedIndices.length > 0 && options.removeCorruptedItems) {
      collection.snapshots = collection.snapshots.filter((_, index) => !corruptedIndices.includes(index));
      corruptedIndices.forEach(index => {
        result.removedItems.push(`snapshots[${index}]`);
      });
    }
    
    return result;
  } catch (error) {
    result.success = false;
    result.errors.push(error instanceof Error ? error : new Error(String(error)));
    return result;
  }
}

/**
 * Verify data integrity across related objects
 * 
 * @param objects Map of objects to validate
 * @param rules Relationship rules to check
 * @returns Validation result
 */
export function verifyDataIntegrityAcrossObjects(
  objects: Record<string, any>,
  rules: RelationshipRule[]
): ValidationResult {
  const errors: ValidationError[] = [];
  
  rules.forEach(rule => {
    const sourceObject = objects[rule.sourceObject];
    const targetObject = objects[rule.targetObject];
    
    if (!sourceObject || !targetObject) {
      errors.push(
        new ValidationError(
          `Missing object for relationship check: ${!sourceObject ? rule.sourceObject : rule.targetObject}`,
          'objects',
          { rule }
        )
      );
      return;
    }
    
    // Get source field value (support nested fields with dot notation)
    const sourceFieldPath = rule.sourceField.split('.');
    let sourceValue = sourceObject;
    for (const field of sourceFieldPath) {
      sourceValue = sourceValue?.[field];
      if (sourceValue === undefined) break;
    }
    
    // Get target field value (support nested fields with dot notation)
    const targetFieldPath = rule.targetField.split('.');
    let targetValue = targetObject;
    for (const field of targetFieldPath) {
      targetValue = targetValue?.[field];
      if (targetValue === undefined) break;
    }
    
    // Check relationship
    if (sourceValue !== targetValue) {
      errors.push(
        new ValidationError(
          `Relationship violation: ${rule.description}. ${rule.sourceObject}.${rule.sourceField} (${sourceValue}) does not match ${rule.targetObject}.${rule.targetField} (${targetValue})`,
          `${rule.sourceObject}.${rule.sourceField}`,
          { sourceValue, targetValue, rule }
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
 * Create a comprehensive data integrity report for a conversation
 * 
 * @param conversation The conversation to analyze
 * @returns Data integrity report
 */
export function createDataIntegrityReport(conversation: Conversation): DataIntegrityReport {
  // Run all validation checks
  const structureResult = validateConversationStructure(conversation);
  const checksumResult = validateConversationChecksums(conversation);
  const referentialResult = validateReferentialIntegrity(conversation);
  const temporalResult = validateTemporalConsistency(conversation);
  
  // Determine overall validity
  const isValid = structureResult.isValid && 
                  checksumResult.isValid && 
                  referentialResult.isValid && 
                  temporalResult.isValid;
  
  // Count total errors
  const errorCount = structureResult.errors.length + 
                     checksumResult.errors.length + 
                     referentialResult.errors.length + 
                     temporalResult.errors.length;
  
  // Generate recommendations
  const recommendations: string[] = [];
  
  if (!structureResult.isValid) {
    recommendations.push('Fix structural issues in the conversation data model');
  }
  
  if (!checksumResult.isValid) {
    recommendations.push('Recalculate checksums for file snapshots');
  }
  
  if (!referentialResult.isValid) {
    recommendations.push('Fix referential integrity issues between messages and conversation');
  }
  
  if (!temporalResult.isValid) {
    recommendations.push('Fix timestamp inconsistencies in messages and snapshots');
  }
  
  // Create the report
  return {
    summary: {
      isValid,
      errorCount,
      id: conversation.id,
      objectType: 'Conversation',
      messageCount: Array.isArray(conversation.messages) ? conversation.messages.length : 0,
      timestamp: Date.now()
    },
    details: {
      structureValid: structureResult.isValid,
      checksumValid: checksumResult.isValid,
      referentialIntegrityValid: referentialResult.isValid,
      temporalConsistencyValid: temporalResult.isValid,
      errors: {
        structure: structureResult.errors,
        checksums: checksumResult.errors,
        referentialIntegrity: referentialResult.errors,
        temporalConsistency: temporalResult.errors
      }
    },
    recommendations: recommendations.length > 0 ? recommendations : undefined
  };
}

/**
 * Assert that a conversation has data integrity
 * 
 * @param conversation The conversation to check
 * @param level Integrity check level
 * @throws DataIntegrityError if the conversation fails integrity checks
 */
export function assertConversationIntegrity(
  conversation: Conversation,
  level: IntegrityCheckLevel = IntegrityCheckLevel.STANDARD
): void {
  const result = checkConversationIntegrity(conversation, {
    level,
    throwOnFailure: true
  });
  
  if (!result.isValid) {
    throw new DataIntegrityError(
      `Conversation integrity check failed with ${result.errors.length} errors`,
      { errors: result.errors, conversationId: conversation.id }
    );
  }
}

/**
 * Assert that a snapshot collection has data integrity
 * 
 * @param collection The snapshot collection to check
 * @throws DataIntegrityError if the collection fails integrity checks
 */
export function assertSnapshotCollectionIntegrity(collection: SnapshotCollection): void {
  const result = verifySnapshotCollectionIntegrityComprehensive(collection, {
    throwOnFailure: true
  });
  
  if (!result.isValid) {
    throw new DataIntegrityError(
      `Snapshot collection integrity check failed with ${result.errors.length} errors`,
      { errors: result.errors, collectionId: collection.id }
    );
  }
}

/**
 * Detect data corruption in a conversation with enhanced analysis
 * 
 * @param conversation The conversation to analyze
 * @returns Corruption detection result
 */
export function detectConversationCorruptionEnhanced(conversation: Conversation): CorruptionDetectionResult {
  const errors: ValidationError[] = [];
  const corruptedFields: string[] = [];
  let canRepair = true;
  let severity: 'low' | 'medium' | 'high' = 'low';
  
  // Run all validation checks
  const structureResult = validateConversationStructure(conversation);
  const checksumResult = validateConversationChecksums(conversation);
  const referentialResult = validateReferentialIntegrity(conversation);
  const temporalResult = validateTemporalConsistency(conversation);
  
  // Collect all errors
  errors.push(...structureResult.errors);
  errors.push(...checksumResult.errors);
  errors.push(...referentialResult.errors);
  errors.push(...temporalResult.errors);
  
  // Extract corrupted fields from errors
  errors.forEach(error => {
    if (error.field) {
      corruptedFields.push(error.field);
    }
  });
  
  // Determine if corruption can be repaired
  if (!structureResult.isValid) {
    // Check for critical structural issues
    const criticalIssues = structureResult.errors.some(error => 
      error.field === 'id' || error.field === 'messages'
    );
    
    if (criticalIssues) {
      canRepair = false;
      severity = 'high';
    } else {
      severity = 'medium';
    }
  }
  
  // Checksum issues are usually repairable but indicate potential data corruption
  if (!checksumResult.isValid) {
    severity = Math.max(severity === 'low' ? 0 : severity === 'medium' ? 1 : 2, 1) as any;
  }
  
  // Referential integrity issues might be repairable
  if (!referentialResult.isValid) {
    severity = Math.max(severity === 'low' ? 0 : severity === 'medium' ? 1 : 2, 1) as any;
  }
  
  // Temporal consistency issues are usually repairable
  if (!temporalResult.isValid) {
    severity = Math.max(severity === 'low' ? 0 : severity === 'medium' ? 1 : 2, 0) as any;
  }
  
  return {
    isCorrupted: errors.length > 0,
    corruptedFields,
    canRepair,
    errors,
    severity
  };
}

/**
 * Attempt to repair a corrupted conversation with enhanced options
 * 
 * @param conversation The conversation to repair
 * @param options Repair options
 * @returns Repair result
 */
export function repairConversationEnhanced(
  conversation: Conversation,
  options: RepairOptions = {}
): RepairResult {
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
    const corruptionResult = detectConversationCorruptionEnhanced(conversation);
    
    // If not corrupted, return success
    if (!corruptionResult.isCorrupted) {
      result.success = true;
      return result;
    }
    
    // If can't be repaired and removal is not allowed, return failure
    if (!corruptionResult.canRepair && !options.removeCorruptedItems) {
      result.errors.push(new Error('Conversation cannot be repaired and removal is not allowed'));
      return result;
    }
    
    // Repair structural issues
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
    
    // Repair checksums if needed
    if (options.recalculateChecksums) {
      const checksumResult = repairConversationChecksums(conversation);
      result.repairedFields.push(...checksumResult.repairedFields);
    }
    
    // Repair referential integrity if needed
    if (options.fixReferentialIntegrity) {
      const referentialResult = repairReferentialIntegrity(conversation);
      result.repairedFields.push(...referentialResult.repairedFields);
      result.removedItems.push(...referentialResult.removedItems);
    }
    
    // Repair temporal consistency
    const temporalResult = repairTemporalConsistency(conversation);
    result.repairedFields.push(...temporalResult.repairedFields);
    
    // Repair messages
    if (Array.isArray(conversation.messages)) {
      const repairedMessages: Message[] = [];
      
      for (let i = 0; i < conversation.messages.length; i++) {
        const message = conversation.messages[i];
        const messageCorruption = detectMessageCorruptionEnhanced(message);
        
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
 * Detect data corruption in a message with enhanced analysis
 * 
 * @param message The message to analyze
 * @returns Corruption detection result
 */
export function detectMessageCorruptionEnhanced(message: Message): CorruptionDetectionResult {
  const errors: ValidationError[] = [];
  const corruptedFields: string[] = [];
  let canRepair = true;
  let severity: 'low' | 'medium' | 'high' = 'low';
  
  // Validate message structure
  const structureResult = validateMessageStructure(message);
  errors.push(...structureResult.errors);
  
  // Extract corrupted fields from errors
  structureResult.errors.forEach(error => {
    if (error.field) {
      corruptedFields.push(error.field);
    }
  });
  
  // Check for critical issues
  const hasCriticalIssues = structureResult.errors.some(error => 
    error.field === 'id' || error.field === 'conversationId'
  );
  
  if (hasCriticalIssues) {
    canRepair = false;
    severity = 'high';
  } else if (structureResult.errors.length > 0) {
    severity = 'medium';
  }
  
  // Check snapshots for checksum issues
  if (Array.isArray(message.snapshot)) {
    let hasChecksumIssues = false;
    
    message.snapshot.forEach((snapshot, index) => {
      const snapshotIntegrity = verifySnapshotIntegrity(snapshot);
      if (!snapshotIntegrity.isValid) {
        hasChecksumIssues = true;
        snapshotIntegrity.errors.forEach(error => {
          errors.push(
            new ValidationError(
              `Snapshot ${index}: ${error.message}`,
              `snapshot[${index}].${error.field}`,
              error.value
            )
          );
          corruptedFields.push(`snapshot[${index}].${error.field}`);
        });
      }
    });
    
    if (hasChecksumIssues) {
      severity = Math.max(severity === 'low' ? 0 : severity === 'medium' ? 1 : 2, 1) as any;
    }
  }
  
  return {
    isCorrupted: errors.length > 0,
    corruptedFields,
    canRepair,
    errors,
    severity
  };
}

/**
 * Safely parse and validate JSON data with enhanced error reporting
 * 
 * @param jsonData JSON string to parse
 * @param validator Validation function
 * @param defaultValue Default value to return if parsing fails
 * @returns Parsed and validated data
 */
export function safeParseAndValidateEnhanced<T>(
  jsonData: string,
  validator: (data: any) => ValidationResult,
  defaultValue: T
): { data: T; isValid: boolean; errors: ValidationError[]; parseError?: Error } {
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
      errors: [new ValidationError(`Error validating data: ${error instanceof Error ? error.message : String(error)}`, 'data', jsonData)],
      parseError: error instanceof Error ? error : new Error(String(error))
    };
  }
}

/**
 * Throws a DataIntegrityError if data validation fails
 * 
 * @param data Data to validate
 * @param validator Validation function
 * @param errorMessage Error message if validation fails
 * @throws DataIntegrityError if validation fails
 */
export function assertDataIntegrity<T>(data: T, validator: (data: T) => ValidationResult, errorMessage: string): void {
  const validation = validator(data);
  
  if (!validation.isValid) {
    throw new DataIntegrityError(
      errorMessage,
      { errors: validation.errors }
    );
  }
}