import * as assert from 'assert';
import { SerializationUtil, CURRENT_SCHEMA_VERSION } from '../cursor-companion/utils/serialization';
import { Conversation, Message, StorageError } from '../cursor-companion/models';

suite('Serialization Tests', () => {
  test('Should serialize and deserialize conversation', () => {
    const conversation: Conversation = {
      id: 'test-conv-1',
      title: 'Test Conversation',
      timestamp: Date.now(),
      messages: [],
      status: 'active',
      metadata: {
        messageCount: 2,
        lastActivity: Date.now(),
        tags: ['test']
      }
    };
    
    const json = SerializationUtil.serializeConversation(conversation);
    const deserialized = SerializationUtil.deserializeConversation(json);
    
    assert.strictEqual(deserialized.id, conversation.id);
    assert.strictEqual(deserialized.title, conversation.title);
    assert.strictEqual(deserialized.timestamp, conversation.timestamp);
    assert.deepStrictEqual(deserialized.messages, conversation.messages);
    assert.strictEqual(deserialized.status, conversation.status);
    assert.deepStrictEqual(deserialized.metadata, conversation.metadata);
  });
  
  test('Should serialize and deserialize message', () => {
    const message: Message = {
      id: 'test-msg-1',
      conversationId: 'test-conv-1',
      content: 'Test message content',
      sender: 'user',
      timestamp: Date.now(),
      codeChanges: [],
      snapshot: []
    };
    
    const json = SerializationUtil.serializeMessage(message);
    const deserialized = SerializationUtil.deserializeMessage(json);
    
    assert.strictEqual(deserialized.id, message.id);
    assert.strictEqual(deserialized.conversationId, message.conversationId);
    assert.strictEqual(deserialized.content, message.content);
    assert.strictEqual(deserialized.sender, message.sender);
    assert.strictEqual(deserialized.timestamp, message.timestamp);
    assert.deepStrictEqual(deserialized.codeChanges, message.codeChanges);
    assert.deepStrictEqual(deserialized.snapshot, message.snapshot);
  });
  
  test('Should include schema version in serialized data', () => {
    const conversation: Conversation = {
      id: 'test-conv-1',
      title: 'Test Conversation',
      timestamp: Date.now(),
      messages: [],
      status: 'active'
    };
    
    const json = SerializationUtil.serializeConversation(conversation);
    const parsed = JSON.parse(json);
    
    assert.strictEqual(parsed.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.ok(parsed.data);
    assert.ok(parsed.serializedAt);
  });
  
  test('Should handle pretty printing', () => {
    const conversation: Conversation = {
      id: 'test-conv-1',
      title: 'Test Conversation',
      timestamp: Date.now(),
      messages: [],
      status: 'active'
    };
    
    const json = SerializationUtil.serializeConversation(conversation, { prettyPrint: true });
    
    // Pretty printed JSON should have newlines
    assert.ok(json.includes('\n'));
  });
  
  test('Should include metadata when requested', () => {
    const conversation: Conversation = {
      id: 'test-conv-1',
      title: 'Test Conversation',
      timestamp: Date.now(),
      messages: [],
      status: 'active'
    };
    
    const metadata = { testKey: 'testValue' };
    const json = SerializationUtil.serializeConversation(conversation, { 
      includeMetadata: true,
      metadata
    });
    
    const parsed = JSON.parse(json);
    assert.deepStrictEqual(parsed.metadata, metadata);
  });
  
  test('Should throw StorageError on invalid JSON', () => {
    assert.throws(() => {
      SerializationUtil.deserializeConversation('invalid json');
    }, StorageError);
  });
  
  test('Should throw StorageError on schema version mismatch with strict check', () => {
    const conversation: Conversation = {
      id: 'test-conv-1',
      title: 'Test Conversation',
      timestamp: Date.now(),
      messages: [],
      status: 'active'
    };
    
    // Create serialized data with modified schema version
    const json = SerializationUtil.serializeConversation(conversation);
    const parsed = JSON.parse(json);
    parsed.schemaVersion = 999; // Invalid version
    const modifiedJson = JSON.stringify(parsed);
    
    assert.throws(() => {
      SerializationUtil.deserializeConversation(modifiedJson, { strictVersionCheck: true });
    }, StorageError);
  });
  
  test('Should auto-migrate older schema versions when requested', () => {
    // Create a mock older version format
    const oldFormatData = {
      schemaVersion: 0,
      data: {
        id: 'test-conv-1',
        title: 'Test Conversation',
        timestamp: Date.now(),
        messages: [],
        status: 1 // Numeric status instead of string
      },
      serializedAt: Date.now()
    };
    
    const json = JSON.stringify(oldFormatData);
    
    // Should not throw with autoMigrate
    const migrated = SerializationUtil.deserializeConversation(json, { autoMigrate: true });
    
    // Check that migration converted numeric status to string
    assert.strictEqual(migrated.status, 'archived');
  });
});