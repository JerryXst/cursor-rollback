/**
 * Serialization utilities for Cursor Companion data models
 * Handles JSON serialization/deserialization with version compatibility
 */

import { 
  Conversation, 
  Message, 
  CodeChange, 
  FileSnapshot, 
  SnapshotCollection,
  StorageError,
  ErrorCategory
} from '../models';

/**
 * Current schema version for serialized data
 * Increment this when making breaking changes to data structures
 */
export const CURRENT_SCHEMA_VERSION = 1;

/**
 * Interface for versioned data objects
 */
export interface VersionedData<T> {
  /** Schema version of the data */
  schemaVersion: number;
  
  /** The actual data payload */
  data: T;
  
  /** When this data was serialized */
  serializedAt: number;
  
  /** Optional metadata */
  metadata?: Record<string, any>;
}

/**
 * Options for serialization
 */
export interface SerializationOptions {
  /** Whether to include metadata in serialized output */
  includeMetadata?: boolean;
  
  /** Whether to pretty-print the JSON output */
  prettyPrint?: boolean;
  
  /** Custom metadata to include */
  metadata?: Record<string, any>;
}

/**
 * Options for deserialization
 */
export interface DeserializationOptions {
  /** Whether to validate the deserialized object */
  validate?: boolean;
  
  /** Whether to automatically migrate old schema versions */
  autoMigrate?: boolean;
  
  /** Whether to throw error on schema version mismatch */
  strictVersionCheck?: boolean;
}

/**
 * Utility class for serializing and deserializing data models
 */
export class SerializationUtil {
  /**
   * Serialize an object to a versioned JSON string
   * 
   * @param data The data object to serialize
   * @param options Serialization options
   * @returns JSON string representation
   */
  static serialize<T>(data: T, options: SerializationOptions = {}): string {
    const versionedData: VersionedData<T> = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      data,
      serializedAt: Date.now(),
      metadata: options.includeMetadata ? options.metadata || {} : undefined
    };
    
    return JSON.stringify(versionedData, null, options.prettyPrint ? 2 : undefined);
  }
  
  /**
   * Deserialize a JSON string to an object
   * 
   * @param json JSON string to deserialize
   * @param options Deserialization options
   * @returns The deserialized object
   * @throws StorageError if deserialization fails
   */
  static deserialize<T>(json: string, options: DeserializationOptions = {}): T {
    try {
      const parsed = JSON.parse(json) as VersionedData<T>;
      
      // Handle schema version differences
      if (parsed.schemaVersion !== CURRENT_SCHEMA_VERSION) {
        if (options.strictVersionCheck) {
          throw new StorageError(
            `Schema version mismatch: expected ${CURRENT_SCHEMA_VERSION}, got ${parsed.schemaVersion}`,
            { expectedVersion: CURRENT_SCHEMA_VERSION, actualVersion: parsed.schemaVersion }
          );
        }
        
        if (options.autoMigrate) {
          return this.migrateSchema<T>(parsed);
        }
      }
      
      // Validate if requested
      if (options.validate) {
        this.validateObject(parsed.data);
      }
      
      return parsed.data;
    } catch (error) {
      if (error instanceof StorageError) {
        throw error;
      }
      
      throw new StorageError(`Failed to deserialize JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Serialize a conversation to JSON
   * 
   * @param conversation The conversation to serialize
   * @param options Serialization options
   * @returns JSON string representation
   */
  static serializeConversation(conversation: Conversation, options: SerializationOptions = {}): string {
    return this.serialize<Conversation>(conversation, options);
  }
  
  /**
   * Deserialize a JSON string to a conversation
   * 
   * @param json JSON string to deserialize
   * @param options Deserialization options
   * @returns The deserialized conversation
   */
  static deserializeConversation(json: string, options: DeserializationOptions = {}): Conversation {
    return this.deserialize<Conversation>(json, options);
  }
  
  /**
   * Serialize a message to JSON
   * 
   * @param message The message to serialize
   * @param options Serialization options
   * @returns JSON string representation
   */
  static serializeMessage(message: Message, options: SerializationOptions = {}): string {
    return this.serialize<Message>(message, options);
  }
  
  /**
   * Deserialize a JSON string to a message
   * 
   * @param json JSON string to deserialize
   * @param options Deserialization options
   * @returns The deserialized message
   */
  static deserializeMessage(json: string, options: DeserializationOptions = {}): Message {
    return this.deserialize<Message>(json, options);
  }
  
  /**
   * Serialize a snapshot collection to JSON
   * 
   * @param snapshot The snapshot collection to serialize
   * @param options Serialization options
   * @returns JSON string representation
   */
  static serializeSnapshot(snapshot: SnapshotCollection, options: SerializationOptions = {}): string {
    return this.serialize<SnapshotCollection>(snapshot, options);
  }
  
  /**
   * Deserialize a JSON string to a snapshot collection
   * 
   * @param json JSON string to deserialize
   * @param options Deserialization options
   * @returns The deserialized snapshot collection
   */
  static deserializeSnapshot(json: string, options: DeserializationOptions = {}): SnapshotCollection {
    return this.deserialize<SnapshotCollection>(json, options);
  }
  
  /**
   * Migrate data from an older schema version to the current version
   * 
   * @param versionedData The versioned data to migrate
   * @returns Migrated data object
   * @throws StorageError if migration fails
   */
  private static migrateSchema<T>(versionedData: VersionedData<T>): T {
    const { schemaVersion, data } = versionedData;
    
    // Handle migrations based on version
    switch (schemaVersion) {
      case 1:
        // Current version, no migration needed
        return data;
        
      case 0:
        // Example migration from version 0 to 1
        return this.migrateV0ToV1(data);
        
      default:
        throw new StorageError(
          `Unsupported schema version: ${schemaVersion}`,
          { supportedVersions: [0, 1], actualVersion: schemaVersion }
        );
    }
  }
  
  /**
   * Migrate data from schema version 0 to 1
   * 
   * @param data The data to migrate
   * @returns Migrated data
   */
  private static migrateV0ToV1<T>(data: any): T {
    // This is a placeholder for actual migration logic
    // In a real implementation, this would transform the data structure
    
    // Example migration logic for a conversation
    if (this.isConversation(data)) {
      // Add any missing fields from version 1 schema
      if (!data.metadata) {
        data.metadata = {
          messageCount: Array.isArray(data.messages) ? data.messages.length : 0,
          lastActivity: data.timestamp || Date.now()
        };
      }
      
      // Convert any old format fields
      if (typeof data.status === 'number') {
        // Example: convert numeric status to string
        data.status = data.status === 1 ? 'archived' : 'active';
      }
    }
    
    // Example migration logic for a message
    if (this.isMessage(data)) {
      // Add any missing fields from version 1 schema
      if (!data.metadata) {
        data.metadata = {};
      }
      
      // Convert any old format fields
      if (!Array.isArray(data.codeChanges)) {
        data.codeChanges = [];
      }
      
      if (!Array.isArray(data.snapshot)) {
        data.snapshot = [];
      }
    }
    
    return data as T;
  }
  
  /**
   * Type guard for Conversation objects
   */
  private static isConversation(obj: any): obj is Conversation {
    return obj && 
           typeof obj === 'object' && 
           typeof obj.id === 'string' && 
           typeof obj.title === 'string' &&
           (obj.status === 'active' || obj.status === 'archived' || typeof obj.status === 'number');
  }
  
  /**
   * Type guard for Message objects
   */
  private static isMessage(obj: any): obj is Message {
    return obj && 
           typeof obj === 'object' && 
           typeof obj.id === 'string' && 
           typeof obj.conversationId === 'string' &&
           typeof obj.content === 'string' &&
           (obj.sender === 'user' || obj.sender === 'ai');
  }
  
  /**
   * Validate an object against its expected schema
   * 
   * @param obj The object to validate
   * @throws StorageError if validation fails
   */
  private static validateObject(obj: any): void {
    // This is a placeholder for actual validation logic
    // In a real implementation, this would use the validation utilities
    
    if (this.isConversation(obj)) {
      // Validate conversation fields
      if (!obj.id || !obj.title || !obj.timestamp) {
        throw new StorageError('Invalid conversation object: missing required fields', { object: obj });
      }
    } else if (this.isMessage(obj)) {
      // Validate message fields
      if (!obj.id || !obj.conversationId || !obj.content || !obj.sender || !obj.timestamp) {
        throw new StorageError('Invalid message object: missing required fields', { object: obj });
      }
    }
  }
}