import * as assert from 'assert';
// Using global mocha functions
import { 
  calculateStrongChecksum,
  verifySnapshotIntegrity,
  detectConversationCorruption,
  detectMessageCorruption,
  repairConversation,
  verifyDataConsistency,
  safeParseAndValidate
} from '../cursor-companion/utils/dataIntegrity';
import { FileSnapshot } from '../cursor-companion/models/fileSnapshot';
import { Conversation } from '../cursor-companion/models/conversation';
import { Message } from '../cursor-companion/models/message';
import { validateConversation } from '../cursor-companion/models/validation';

suite('Data Integrity Tests', () => {
  suite('calculateStrongChecksum', () => {
    test('should generate consistent checksums for the same content', () => {
      const content = 'Test content for checksum';
      const checksum1 = calculateStrongChecksum(content);
      const checksum2 = calculateStrongChecksum(content);
      
      assert.strictEqual(checksum1, checksum2);
    });
    
    test('should generate different checksums for different content', () => {
      const content1 = 'Test content 1';
      const content2 = 'Test content 2';
      
      const checksum1 = calculateStrongChecksum(content1);
      const checksum2 = calculateStrongChecksum(content2);
      
      assert.notStrictEqual(checksum1, checksum2);
    });
  });
  
  suite('verifySnapshotIntegrity', () => {
    test('should validate a snapshot with correct checksum', () => {
      const content = 'Test file content';
      const checksum = calculateStrongChecksum(content);
      
      const snapshot: FileSnapshot = {
        filePath: 'test/file.txt',
        content,
        timestamp: Date.now(),
        checksum
      };
      
      const result = verifySnapshotIntegrity(snapshot);
      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.errors.length, 0);
    });
    
    test('should detect a snapshot with incorrect checksum', () => {
      const content = 'Test file content';
      const wrongChecksum = 'invalid-checksum';
      
      const snapshot: FileSnapshot = {
        filePath: 'test/file.txt',
        content,
        timestamp: Date.now(),
        checksum: wrongChecksum
      };
      
      const result = verifySnapshotIntegrity(snapshot);
      assert.strictEqual(result.isValid, false);
      assert.strictEqual(result.errors.length, 1);
      assert.strictEqual(result.errors[0].field, 'checksum');
    });
    
    test('should handle empty content', () => {
      const snapshot: FileSnapshot = {
        filePath: 'test/empty.txt',
        content: '',
        timestamp: Date.now(),
        checksum: calculateStrongChecksum('')
      };
      
      const result = verifySnapshotIntegrity(snapshot);
      assert.strictEqual(result.isValid, true);
    });
  });
  
  suite('detectConversationCorruption', () => {
    test('should detect no corruption in valid conversation', () => {
      const conversation: Conversation = {
        id: 'test-conv-1',
        title: 'Test Conversation',
        timestamp: Date.now(),
        messages: [],
        status: 'active'
      };
      
      const result = detectConversationCorruption(conversation);
      assert.strictEqual(result.isCorrupted, false);
      assert.strictEqual(result.corruptedFields.length, 0);
    });
    
    test('should detect corruption in conversation with missing fields', () => {
      const conversation = {
        id: 'test-conv-2',
        // Missing title
        timestamp: Date.now(),
        messages: []
      } as unknown as Conversation;
      
      const result = detectConversationCorruption(conversation);
      assert.strictEqual(result.isCorrupted, true);
      assert.ok(result.corruptedFields.includes('title'));
    });
    
    test('should detect corruption in conversation with invalid fields', () => {
      const conversation = {
        id: 'test-conv-3',
        title: 'Test Conversation',
        timestamp: -1, // Invalid timestamp
        messages: [],
        status: 'invalid-status' // Invalid status
      } as unknown as Conversation;
      
      const result = detectConversationCorruption(conversation);
      assert.strictEqual(result.isCorrupted, true);
      assert.ok(result.corruptedFields.includes('timestamp'));
      assert.ok(result.corruptedFields.includes('status'));
    });
  });
  
  suite('repairConversation', () => {
    test('should repair conversation with missing fields', () => {
      const conversation = {
        id: 'test-conv-4',
        // Missing title
        timestamp: -1, // Invalid timestamp
        messages: [],
        status: 'invalid-status' // Invalid status
      } as unknown as Conversation;
      
      const result = repairConversation(conversation, { setDefaultValues: true });
      
      assert.strictEqual(result.success, true);
      assert.ok(result.repairedFields.includes('title'));
      assert.ok(result.repairedFields.includes('timestamp'));
      assert.ok(result.repairedFields.includes('status'));
      
      // Verify repairs
      assert.strictEqual(typeof conversation.title, 'string');
      assert.ok(conversation.timestamp > 0);
      assert.strictEqual(conversation.status, 'active');
    });
    
    test('should not repair ID field', () => {
      const conversation = {
        // Missing ID
        title: 'Test Conversation',
        timestamp: Date.now(),
        messages: [],
        status: 'active'
      } as unknown as Conversation;
      
      const result = repairConversation(conversation, { setDefaultValues: true });
      
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.errors.length, 1);
    });
  });
  
  suite('verifyDataConsistency', () => {
    test('should validate consistent conversation data', () => {
      const conversation: Conversation = {
        id: 'test-conv-5',
        title: 'Test Conversation',
        timestamp: Date.now(),
        messages: [
          {
            id: 'msg-1',
            conversationId: 'test-conv-5',
            content: 'Message 1',
            sender: 'user',
            timestamp: Date.now() - 1000,
            codeChanges: [],
            snapshot: []
          },
          {
            id: 'msg-2',
            conversationId: 'test-conv-5',
            content: 'Message 2',
            sender: 'ai',
            timestamp: Date.now(),
            codeChanges: [],
            snapshot: []
          }
        ],
        status: 'active'
      };
      
      const result = verifyDataConsistency(conversation);
      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.errors.length, 0);
    });
    
    test('should detect inconsistent conversation IDs', () => {
      const conversation: Conversation = {
        id: 'test-conv-6',
        title: 'Test Conversation',
        timestamp: Date.now(),
        messages: [
          {
            id: 'msg-1',
            conversationId: 'wrong-conv-id', // Wrong conversation ID
            content: 'Message 1',
            sender: 'user',
            timestamp: Date.now(),
            codeChanges: [],
            snapshot: []
          }
        ],
        status: 'active'
      };
      
      const result = verifyDataConsistency(conversation);
      assert.strictEqual(result.isValid, false);
      assert.strictEqual(result.errors.length, 1);
    });
    
    test('should detect timestamp inconsistencies', () => {
      const now = Date.now();
      
      const conversation: Conversation = {
        id: 'test-conv-7',
        title: 'Test Conversation',
        timestamp: now,
        messages: [
          {
            id: 'msg-1',
            conversationId: 'test-conv-7',
            content: 'Message 1',
            sender: 'user',
            timestamp: now + 1000, // Later timestamp
            codeChanges: [],
            snapshot: []
          },
          {
            id: 'msg-2',
            conversationId: 'test-conv-7',
            content: 'Message 2',
            sender: 'ai',
            timestamp: now, // Earlier timestamp
            codeChanges: [],
            snapshot: []
          }
        ],
        status: 'active'
      };
      
      const result = verifyDataConsistency(conversation);
      assert.strictEqual(result.isValid, false);
      assert.strictEqual(result.errors.length, 1);
    });
  });
  
  suite('safeParseAndValidate', () => {
    test('should parse and validate valid JSON', () => {
      const json = JSON.stringify({
        id: 'test-conv-8',
        title: 'Test Conversation',
        timestamp: Date.now(),
        messages: [],
        status: 'active'
      });
      
      const result = safeParseAndValidate<Conversation>(
        json,
        validateConversation,
        { id: '', title: '', timestamp: 0, messages: [], status: 'active' }
      );
      
      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.errors.length, 0);
      assert.strictEqual(result.data.id, 'test-conv-8');
    });
    
    test('should handle invalid JSON', () => {
      const json = '{ invalid json: }';
      
      const result = safeParseAndValidate<Conversation>(
        json,
        validateConversation,
        { id: '', title: '', timestamp: 0, messages: [], status: 'active' }
      );
      
      assert.strictEqual(result.isValid, false);
      assert.strictEqual(result.data.id, '');
    });
    
    test('should handle valid JSON with invalid data', () => {
      const json = JSON.stringify({
        id: 'test-conv-9',
        // Missing title
        timestamp: -1, // Invalid timestamp
        messages: 'not-an-array', // Invalid messages
        status: 'invalid' // Invalid status
      });
      
      const result = safeParseAndValidate<Conversation>(
        json,
        validateConversation,
        { id: '', title: '', timestamp: 0, messages: [], status: 'active' }
      );
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.length > 0);
      assert.strictEqual(result.data.id, '');
    });
  });
});