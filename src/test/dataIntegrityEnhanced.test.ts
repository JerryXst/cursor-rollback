import * as assert from 'assert';
import { describe, it } from 'mocha';
import { 
  checkConversationIntegrity,
  IntegrityCheckLevel,
  validateConversationStructure,
  validateMessageStructure,
  validateCodeChangeStructure,
  validateFileSnapshotStructure,
  validateConversationChecksums,
  validateReferentialIntegrity,
  validateTemporalConsistency,
  verifySnapshotCollectionIntegrityComprehensive,
  repairSnapshotCollection,
  verifyDataIntegrityAcrossObjects,
  createDataIntegrityReport,
  assertConversationIntegrity,
  assertSnapshotCollectionIntegrity,
  detectConversationCorruptionEnhanced,
  repairConversationEnhanced,
  detectMessageCorruptionEnhanced,
  safeParseAndValidateEnhanced
} from '../cursor-companion/utils/dataIntegrityEnhanced';
import { FileSnapshot, SnapshotCollection } from '../cursor-companion/models/fileSnapshot';
import { Conversation } from '../cursor-companion/models/conversation';
import { Message } from '../cursor-companion/models/message';
import { CodeChange } from '../cursor-companion/models/codeChange';
import { calculateStrongChecksum } from '../cursor-companion/utils/dataIntegrity';
import { DataIntegrityError } from '../cursor-companion/models/errors';

describe('Enhanced Data Integrity Tests', () => {
  // Helper function to create a valid conversation for testing
  function createValidConversation(): Conversation {
    const now = Date.now();
    return {
      id: 'test-conv-1',
      title: 'Test Conversation',
      timestamp: now - 5000,
      messages: [
        {
          id: 'msg-1',
          conversationId: 'test-conv-1',
          content: 'Test message 1',
          sender: 'user',
          timestamp: now - 4000,
          codeChanges: [],
          snapshot: []
        },
        {
          id: 'msg-2',
          conversationId: 'test-conv-1',
          content: 'Test message 2',
          sender: 'ai',
          timestamp: now - 2000,
          codeChanges: [
            {
              filePath: 'test/file.js',
              changeType: 'modify',
              beforeContent: 'console.log("before");',
              afterContent: 'console.log("after");',
              lineNumbers: { start: 1, end: 1 }
            }
          ],
          snapshot: [
            {
              filePath: 'test/file.js',
              content: 'console.log("after");',
              timestamp: now - 2000,
              checksum: calculateStrongChecksum('console.log("after");')
            }
          ]
        }
      ],
      status: 'active'
    };
  }

  // Helper function to create a valid snapshot collection for testing
  function createValidSnapshotCollection(): SnapshotCollection {
    const now = Date.now();
    return {
      id: 'snapshot-collection-1',
      messageId: 'msg-2',
      timestamp: now,
      snapshots: [
        {
          filePath: 'test/file1.js',
          content: 'console.log("file1");',
          timestamp: now,
          checksum: calculateStrongChecksum('console.log("file1");')
        },
        {
          filePath: 'test/file2.js',
          content: 'console.log("file2");',
          timestamp: now,
          checksum: calculateStrongChecksum('console.log("file2");')
        }
      ]
    };
  }

  describe('checkConversationIntegrity', () => {
    it('should validate a valid conversation at basic level', () => {
      const conversation = createValidConversation();
      const result = checkConversationIntegrity(conversation, { level: IntegrityCheckLevel.BASIC });
      
      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.errors.length, 0);
      assert.strictEqual(result.details?.structuralValidity?.isValid, true);
    });
    
    it('should validate a valid conversation at standard level', () => {
      const conversation = createValidConversation();
      const result = checkConversationIntegrity(conversation, { level: IntegrityCheckLevel.STANDARD });
      
      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.errors.length, 0);
      assert.strictEqual(result.details?.structuralValidity?.isValid, true);
      assert.strictEqual(result.details?.checksumValidity?.isValid, true);
    });
    
    it('should validate a valid conversation at comprehensive level', () => {
      const conversation = createValidConversation();
      const result = checkConversationIntegrity(conversation, { level: IntegrityCheckLevel.COMPREHENSIVE });
      
      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.errors.length, 0);
      assert.strictEqual(result.details?.structuralValidity?.isValid, true);
      assert.strictEqual(result.details?.checksumValidity?.isValid, true);
      assert.strictEqual(result.details?.referentialIntegrity?.isValid, true);
      assert.strictEqual(result.details?.temporalConsistency?.isValid, true);
    });
    
    it('should detect structural issues', () => {
      const conversation = createValidConversation();
      // Introduce a structural issue
      conversation.messages[0].sender = 'invalid' as any;
      
      const result = checkConversationIntegrity(conversation, { level: IntegrityCheckLevel.BASIC });
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.length > 0);
      assert.strictEqual(result.details?.structuralValidity?.isValid, false);
    });
    
    it('should detect checksum issues', () => {
      const conversation = createValidConversation();
      // Introduce a checksum issue
      if (conversation.messages[1].snapshot && conversation.messages[1].snapshot.length > 0) {
        conversation.messages[1].snapshot[0].checksum = 'invalid-checksum';
      }
      
      const result = checkConversationIntegrity(conversation, { level: IntegrityCheckLevel.STANDARD });
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.length > 0);
      assert.strictEqual(result.details?.checksumValidity?.isValid, false);
    });
    
    it('should detect referential integrity issues', () => {
      const conversation = createValidConversation();
      // Introduce a referential integrity issue
      conversation.messages[0].conversationId = 'wrong-id';
      
      const result = checkConversationIntegrity(conversation, { level: IntegrityCheckLevel.COMPREHENSIVE });
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.length > 0);
      assert.strictEqual(result.details?.referentialIntegrity?.isValid, false);
    });
    
    it('should detect temporal consistency issues', () => {
      const conversation = createValidConversation();
      // Introduce a temporal consistency issue
      conversation.messages[0].timestamp = conversation.messages[1].timestamp + 1000;
      
      const result = checkConversationIntegrity(conversation, { level: IntegrityCheckLevel.COMPREHENSIVE });
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.length > 0);
      assert.strictEqual(result.details?.temporalConsistency?.isValid, false);
    });
    
    it('should attempt repairs when autoRepair is true', () => {
      const conversation = createValidConversation();
      // Introduce a repairable issue
      conversation.status = 'invalid' as any;
      
      const result = checkConversationIntegrity(conversation, { 
        level: IntegrityCheckLevel.BASIC,
        autoRepair: true
      });
      
      assert.strictEqual(result.repairsAttempted, true);
      assert.ok(result.repairedFields && result.repairedFields.includes('status'));
      assert.strictEqual(conversation.status, 'active');
    });
    
    it('should throw when throwOnFailure is true and there are errors', () => {
      const conversation = createValidConversation();
      // Introduce an issue
      conversation.messages[0].sender = 'invalid' as any;
      
      assert.throws(() => {
        checkConversationIntegrity(conversation, { 
          level: IntegrityCheckLevel.BASIC,
          throwOnFailure: true
        });
      }, DataIntegrityError);
    });
  });
  
  describe('validateConversationStructure', () => {
    it('should validate a valid conversation structure', () => {
      const conversation = createValidConversation();
      const result = validateConversationStructure(conversation);
      
      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.errors.length, 0);
    });
    
    it('should detect missing required fields', () => {
      const conversation = {
        // Missing id
        title: 'Test Conversation',
        timestamp: Date.now(),
        messages: [],
        status: 'active'
      } as Conversation;
      
      const result = validateConversationStructure(conversation);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.length > 0);
      assert.ok(result.errors.some(e => e.field === 'id'));
    });
    
    it('should validate message structures within the conversation', () => {
      const conversation = createValidConversation();
      // Introduce an issue in a message
      conversation.messages[0].sender = 'invalid' as any;
      
      const result = validateConversationStructure(conversation);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.length > 0);
      assert.ok(result.errors.some(e => e.field?.includes('messages[0].sender')));
    });
  });
  
  describe('validateMessageStructure', () => {
    it('should validate a valid message structure', () => {
      const message = createValidConversation().messages[0];
      const result = validateMessageStructure(message);
      
      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.errors.length, 0);
    });
    
    it('should detect missing required fields', () => {
      const message = {
        id: 'msg-1',
        // Missing conversationId
        content: 'Test message',
        sender: 'user',
        timestamp: Date.now(),
        codeChanges: [],
        snapshot: []
      } as Message;
      
      const result = validateMessageStructure(message);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.length > 0);
      assert.ok(result.errors.some(e => e.field === 'conversationId'));
    });
    
    it('should validate code changes within the message', () => {
      const message = createValidConversation().messages[1];
      // Introduce an issue in a code change
      if (message.codeChanges && message.codeChanges.length > 0) {
        message.codeChanges[0].changeType = 'invalid' as any;
      }
      
      const result = validateMessageStructure(message);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.length > 0);
      assert.ok(result.errors.some(e => e.field?.includes('codeChanges[0].changeType')));
    });
    
    it('should validate snapshots within the message', () => {
      const message = createValidConversation().messages[1];
      // Introduce an issue in a snapshot
      if (message.snapshot && message.snapshot.length > 0) {
        message.snapshot[0].timestamp = -1;
      }
      
      const result = validateMessageStructure(message);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.length > 0);
      assert.ok(result.errors.some(e => e.field?.includes('snapshot[0].timestamp')));
    });
  });
  
  describe('validateCodeChangeStructure', () => {
    it('should validate a valid code change structure', () => {
      const codeChange: CodeChange = {
        filePath: 'test/file.js',
        changeType: 'modify',
        beforeContent: 'console.log("before");',
        afterContent: 'console.log("after");',
        lineNumbers: { start: 1, end: 1 }
      };
      
      const result = validateCodeChangeStructure(codeChange);
      
      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.errors.length, 0);
    });
    
    it('should validate content requirements based on change type', () => {
      // Create change
      const createChange: CodeChange = {
        filePath: 'test/file.js',
        changeType: 'create',
        // Missing afterContent
        lineNumbers: { start: 1, end: 1 }
      } as any;
      
      const createResult = validateCodeChangeStructure(createChange);
      assert.strictEqual(createResult.isValid, false);
      assert.ok(createResult.errors.some(e => e.field === 'afterContent'));
      
      // Delete change
      const deleteChange: CodeChange = {
        filePath: 'test/file.js',
        changeType: 'delete',
        // Missing beforeContent
        lineNumbers: { start: 1, end: 1 }
      } as any;
      
      const deleteResult = validateCodeChangeStructure(deleteChange);
      assert.strictEqual(deleteResult.isValid, false);
      assert.ok(deleteResult.errors.some(e => e.field === 'beforeContent'));
      
      // Modify change
      const modifyChange: CodeChange = {
        filePath: 'test/file.js',
        changeType: 'modify',
        // Missing both contents
        lineNumbers: { start: 1, end: 1 }
      } as any;
      
      const modifyResult = validateCodeChangeStructure(modifyChange);
      assert.strictEqual(modifyResult.isValid, false);
      assert.ok(modifyResult.errors.some(e => e.field?.includes('beforeContent')));
    });
    
    it('should validate line numbers', () => {
      const codeChange: CodeChange = {
        filePath: 'test/file.js',
        changeType: 'modify',
        beforeContent: 'console.log("before");',
        afterContent: 'console.log("after");',
        lineNumbers: { start: 5, end: 3 } // Invalid: start > end
      };
      
      const result = validateCodeChangeStructure(codeChange);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.field === 'lineNumbers'));
    });
  });
  
  describe('validateFileSnapshotStructure', () => {
    it('should validate a valid file snapshot structure', () => {
      const snapshot: FileSnapshot = {
        filePath: 'test/file.js',
        content: 'console.log("test");',
        timestamp: Date.now(),
        checksum: calculateStrongChecksum('console.log("test");')
      };
      
      const result = validateFileSnapshotStructure(snapshot);
      
      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.errors.length, 0);
    });
    
    it('should detect path traversal attempts', () => {
      const snapshot: FileSnapshot = {
        filePath: '../../../etc/passwd', // Path traversal attempt
        content: 'test content',
        timestamp: Date.now(),
        checksum: calculateStrongChecksum('test content')
      };
      
      const result = validateFileSnapshotStructure(snapshot);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.field === 'filePath' && e.message.includes('path traversal')));
    });
    
    it('should validate metadata if present', () => {
      const snapshot: FileSnapshot = {
        filePath: 'test/file.js',
        content: 'console.log("test");',
        timestamp: Date.now(),
        checksum: calculateStrongChecksum('console.log("test");'),
        metadata: {
          size: -1, // Invalid size
          encoding: 123 as any, // Invalid encoding type
          language: 'javascript',
          existed: 'yes' as any // Invalid existed type
        }
      };
      
      const result = validateFileSnapshotStructure(snapshot);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.field === 'metadata.size'));
      assert.ok(result.errors.some(e => e.field === 'metadata.encoding'));
      assert.ok(result.errors.some(e => e.field === 'metadata.existed'));
    });
  });
  
  describe('verifySnapshotCollectionIntegrityComprehensive', () => {
    it('should validate a valid snapshot collection', () => {
      const collection = createValidSnapshotCollection();
      const result = verifySnapshotCollectionIntegrityComprehensive(collection);
      
      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.errors.length, 0);
    });
    
    it('should detect duplicate file paths', () => {
      const collection = createValidSnapshotCollection();
      // Add duplicate file path
      collection.snapshots.push({
        filePath: 'test/file1.js', // Duplicate
        content: 'different content',
        timestamp: Date.now(),
        checksum: calculateStrongChecksum('different content')
      });
      
      const result = verifySnapshotCollectionIntegrityComprehensive(collection);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.message.includes('Duplicate file path')));
    });
    
    it('should detect timestamp inconsistencies', () => {
      const collection = createValidSnapshotCollection();
      // Make snapshot timestamp later than collection timestamp
      collection.snapshots[0].timestamp = collection.timestamp + 1000;
      
      const result = verifySnapshotCollectionIntegrityComprehensive(collection);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.message.includes('timestamp')));
    });
    
    it('should throw when throwOnFailure is true and there are errors', () => {
      const collection = createValidSnapshotCollection();
      // Introduce an issue
      collection.snapshots[0].checksum = 'invalid-checksum';
      
      assert.throws(() => {
        verifySnapshotCollectionIntegrityComprehensive(collection, { throwOnFailure: true });
      }, DataIntegrityError);
    });
  });
  
  describe('repairSnapshotCollection', () => {
    it('should repair a snapshot collection with checksum issues', () => {
      const collection = createValidSnapshotCollection();
      // Introduce a checksum issue
      collection.snapshots[0].checksum = 'invalid-checksum';
      
      const result = repairSnapshotCollection(collection, { recalculateChecksums: true });
      
      assert.strictEqual(result.success, true);
      assert.ok(result.repairedFields.includes('snapshots[0].checksum'));
      assert.strictEqual(collection.snapshots[0].checksum, calculateStrongChecksum(collection.snapshots[0].content));
    });
    
    it('should repair a snapshot collection with timestamp issues', () => {
      const collection = createValidSnapshotCollection();
      // Introduce a timestamp issue
      collection.snapshots[0].timestamp = -1;
      
      const result = repairSnapshotCollection(collection, { setDefaultValues: true });
      
      assert.strictEqual(result.success, true);
      assert.ok(result.repairedFields.includes('snapshots[0].timestamp'));
      assert.strictEqual(collection.snapshots[0].timestamp, collection.timestamp);
    });
    
    it('should remove corrupted snapshots when removeCorruptedItems is true', () => {
      const collection = createValidSnapshotCollection();
      // Add a corrupted snapshot
      collection.snapshots.push({
        filePath: 'test/corrupted.js',
        content: 'corrupted content',
        timestamp: Date.now(),
        checksum: 'invalid-checksum'
      });
      
      const originalLength = collection.snapshots.length;
      const result = repairSnapshotCollection(collection, { 
        recalculateChecksums: false,
        removeCorruptedItems: true
      });
      
      assert.strictEqual(result.success, true);
      assert.ok(result.removedItems.length > 0);
      assert.strictEqual(collection.snapshots.length, originalLength - 1);
    });
  });
  
  describe('verifyDataIntegrityAcrossObjects', () => {
    it('should validate relationships between objects', () => {
      const objects = {
        conversation: {
          id: 'conv-1',
          title: 'Test Conversation'
        },
        message: {
          id: 'msg-1',
          conversationId: 'conv-1',
          content: 'Test message'
        }
      };
      
      const rules = [
        {
          sourceObject: 'message',
          sourceField: 'conversationId',
          targetObject: 'conversation',
          targetField: 'id',
          description: 'Message must reference valid conversation'
        }
      ];
      
      const result = verifyDataIntegrityAcrossObjects(objects, rules);
      
      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.errors.length, 0);
    });
    
    it('should detect relationship violations', () => {
      const objects = {
        conversation: {
          id: 'conv-1',
          title: 'Test Conversation'
        },
        message: {
          id: 'msg-1',
          conversationId: 'conv-2', // Wrong ID
          content: 'Test message'
        }
      };
      
      const rules = [
        {
          sourceObject: 'message',
          sourceField: 'conversationId',
          targetObject: 'conversation',
          targetField: 'id',
          description: 'Message must reference valid conversation'
        }
      ];
      
      const result = verifyDataIntegrityAcrossObjects(objects, rules);
      
      assert.strictEqual(result.isValid, false);
      assert.strictEqual(result.errors.length, 1);
      assert.ok(result.errors[0].message.includes('Relationship violation'));
    });
    
    it('should handle nested fields', () => {
      const objects = {
        user: {
          profile: {
            id: 'user-1'
          }
        },
        post: {
          author: {
            userId: 'user-1'
          }
        }
      };
      
      const rules = [
        {
          sourceObject: 'post',
          sourceField: 'author.userId',
          targetObject: 'user',
          targetField: 'profile.id',
          description: 'Post author must reference valid user'
        }
      ];
      
      const result = verifyDataIntegrityAcrossObjects(objects, rules);
      
      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.errors.length, 0);
    });
  });
  
  describe('createDataIntegrityReport', () => {
    it('should create a comprehensive report for a valid conversation', () => {
      const conversation = createValidConversation();
      const report = createDataIntegrityReport(conversation);
      
      assert.strictEqual(report.summary.isValid, true);
      assert.strictEqual(report.summary.errorCount, 0);
      assert.strictEqual(report.summary.id, conversation.id);
      assert.strictEqual(report.summary.messageCount, conversation.messages.length);
      assert.strictEqual(report.details.structureValid, true);
      assert.strictEqual(report.details.checksumValid, true);
      assert.strictEqual(report.details.referentialIntegrityValid, true);
      assert.strictEqual(report.details.temporalConsistencyValid, true);
    });
    
    it('should report issues in a corrupted conversation', () => {
      const conversation = createValidConversation();
      // Introduce multiple issues
      conversation.messages[0].conversationId = 'wrong-id';
      conversation.messages[1].snapshot![0].checksum = 'invalid-checksum';
      
      const report = createDataIntegrityReport(conversation);
      
      assert.strictEqual(report.summary.isValid, false);
      assert.ok(report.summary.errorCount > 0);
      assert.strictEqual(report.details.checksumValid, false);
      assert.strictEqual(report.details.referentialIntegrityValid, false);
      assert.ok(report.recommendations && report.recommendations.length > 0);
    });
  });
  
  describe('assertConversationIntegrity', () => {
    it('should not throw for a valid conversation', () => {
      const conversation = createValidConversation();
      
      assert.doesNotThrow(() => {
        assertConversationIntegrity(conversation);
      });
    });
    
    it('should throw DataIntegrityError for an invalid conversation', () => {
      const conversation = createValidConversation();
      // Introduce an issue
      conversation.messages[0].sender = 'invalid' as any;
      
      assert.throws(() => {
        assertConversationIntegrity(conversation);
      }, DataIntegrityError);
    });
  });
  
  describe('assertSnapshotCollectionIntegrity', () => {
    it('should not throw for a valid snapshot collection', () => {
      const collection = createValidSnapshotCollection();
      
      assert.doesNotThrow(() => {
        assertSnapshotCollectionIntegrity(collection);
      });
    });
    
    it('should throw DataIntegrityError for an invalid snapshot collection', () => {
      const collection = createValidSnapshotCollection();
      // Introduce an issue
      collection.snapshots[0].checksum = 'invalid-checksum';
      
      assert.throws(() => {
        assertSnapshotCollectionIntegrity(collection);
      }, DataIntegrityError);
    });
  });
  
  describe('detectConversationCorruptionEnhanced', () => {
    it('should detect no corruption in a valid conversation', () => {
      const conversation = createValidConversation();
      const result = detectConversationCorruptionEnhanced(conversation);
      
      assert.strictEqual(result.isCorrupted, false);
      assert.strictEqual(result.corruptedFields.length, 0);
      assert.strictEqual(result.severity, 'low');
    });
    
    it('should detect and classify corruption severity', () => {
      const conversation = createValidConversation();
      // Introduce a minor issue
      conversation.status = 'invalid' as any;
      
      const minorResult = detectConversationCorruptionEnhanced(conversation);
      assert.strictEqual(minorResult.isCorrupted, true);
      assert.strictEqual(minorResult.severity, 'medium');
      assert.strictEqual(minorResult.canRepair, true);
      
      // Introduce a critical issue
      conversation.id = undefined as any;
      
      const criticalResult = detectConversationCorruptionEnhanced(conversation);
      assert.strictEqual(criticalResult.isCorrupted, true);
      assert.strictEqual(criticalResult.severity, 'high');
      assert.strictEqual(criticalResult.canRepair, false);
    });
  });
  
  describe('repairConversationEnhanced', () => {
    it('should repair a conversation with minor issues', () => {
      const conversation = createValidConversation();
      // Introduce repairable issues
      conversation.status = 'invalid' as any;
      conversation.messages[0].sender = 'invalid' as any;
      
      const result = repairConversationEnhanced(conversation, {
        setDefaultValues: true,
        recalculateChecksums: true,
        fixReferentialIntegrity: true
      });
      
      assert.strictEqual(result.success, true);
      assert.ok(result.repairedFields.includes('status'));
      assert.ok(result.repairedFields.includes('messages[0].sender'));
      assert.strictEqual(conversation.status, 'active');
      assert.strictEqual(conversation.messages[0].sender, 'user');
    });
    
    it('should handle critical issues appropriately', () => {
      const conversation = createValidConversation();
      // Introduce a critical issue
      conversation.id = undefined as any;
      
      const result = repairConversationEnhanced(conversation, {
        setDefaultValues: true,
        generateMissingIds: false // Don't generate IDs
      });
      
      assert.strictEqual(result.success, false);
      assert.ok(result.errors.length > 0);
    });
    
    it('should remove corrupted items when requested', () => {
      const conversation = createValidConversation();
      // Corrupt a message beyond repair
      conversation.messages[1].id = undefined as any;
      conversation.messages[1].conversationId = undefined as any;
      
      const originalLength = conversation.messages.length;
      const result = repairConversationEnhanced(conversation, {
        setDefaultValues: true,
        removeCorruptedItems: true
      });
      
      assert.strictEqual(result.success, true);
      assert.ok(result.removedItems.length > 0);
      assert.strictEqual(conversation.messages.length, originalLength - 1);
    });
  });
  
  describe('safeParseAndValidateEnhanced', () => {
    it('should parse and validate valid JSON', () => {
      const json = JSON.stringify({
        id: 'test-conv-1',
        title: 'Test Conversation',
        timestamp: Date.now(),
        messages: [],
        status: 'active'
      });
      
      const result = safeParseAndValidateEnhanced<Conversation>(
        json,
        validateConversationStructure,
        { id: '', title: '', timestamp: 0, messages: [], status: 'active' }
      );
      
      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.errors.length, 0);
      assert.strictEqual(result.data.id, 'test-conv-1');
    });
    
    it('should handle invalid JSON with detailed error reporting', () => {
      const json = '{ invalid json: }';
      
      const result = safeParseAndValidateEnhanced<Conversation>(
        json,
        validateConversationStructure,
        { id: '', title: '', timestamp: 0, messages: [], status: 'active' }
      );
      
      assert.strictEqual(result.isValid, false);
      assert.strictEqual(result.data.id, '');
      assert.ok(result.parseError instanceof Error);
    });
    
    it('should handle valid JSON with invalid data', () => {
      const json = JSON.stringify({
        id: 'test-conv-1',
        // Missing title
        timestamp: -1, // Invalid timestamp
        messages: 'not-an-array', // Invalid messages
        status: 'invalid' // Invalid status
      });
      
      const result = safeParseAndValidateEnhanced<Conversation>(
        json,
        validateConversationStructure,
        { id: '', title: '', timestamp: 0, messages: [], status: 'active' }
      );
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.length > 0);
      assert.strictEqual(result.data.id, '');
    });
  });
});