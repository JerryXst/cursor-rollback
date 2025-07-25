/**
 * Comprehensive unit tests for model validation
 */

// Using global mocha functions
import * as assert from 'assert';
import {
  validateConversation,
  validateCreateConversationDto,
  validateMessage,
  validateCreateMessageDto,
  validateCodeChange,
  validateFileSnapshot,
  validateArray,
  ValidationError
} from '../cursor-companion/models/validation';
import { Conversation, Message, CodeChange, FileSnapshot } from '../cursor-companion/models';

suite('Model Validation', () => {
  suite('ValidationError', () => {
    test('should create validation error with message and field', () => {
      const error = new ValidationError('Test error', 'testField', 'testValue');
      
      assert.strictEqual(error.message, 'Test error');
      assert.strictEqual(error.field, 'testField');
      assert.strictEqual(error.value, 'testValue');
      assert.strictEqual(error.name, 'ValidationError');
    });
  });

  suite('validateConversation', () => {
    const validConversation: Conversation = {
      id: 'conv-1',
      title: 'Test Conversation',
      timestamp: Date.now(),
      messages: [],
      status: 'active'
    };

    test('should validate a valid conversation', () => {
      const result = validateConversation(validConversation);
      
      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    test('should reject conversation without ID', () => {
      const invalid = { ...validConversation };
      delete (invalid as any).id;
      
      const result = validateConversation(invalid);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.field === 'id'));
    });

    test('should reject conversation with empty ID', () => {
      const invalid = { ...validConversation, id: '' };
      
      const result = validateConversation(invalid);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.field === 'id'));
    });

    test('should reject conversation with non-string ID', () => {
      const invalid = { ...validConversation, id: 123 as any };
      
      const result = validateConversation(invalid);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.field === 'id'));
    });

    test('should reject conversation without title', () => {
      const invalid = { ...validConversation };
      delete (invalid as any).title;
      
      const result = validateConversation(invalid);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.field === 'title'));
    });

    test('should reject conversation with empty title', () => {
      const invalid = { ...validConversation, title: '   ' };
      
      const result = validateConversation(invalid);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.field === 'title'));
    });

    test('should reject conversation with invalid timestamp', () => {
      const invalid1 = { ...validConversation, timestamp: -1 };
      const invalid2 = { ...validConversation, timestamp: 'invalid' as any };
      
      const result1 = validateConversation(invalid1);
      const result2 = validateConversation(invalid2);
      
      assert.strictEqual(result1.isValid, false);
      assert.strictEqual(result2.isValid, false);
      assert.ok(result1.errors.some(e => e.field === 'timestamp'));
      assert.ok(result2.errors.some(e => e.field === 'timestamp'));
    });

    test('should reject conversation with invalid status', () => {
      const invalid = { ...validConversation, status: 'invalid' as any };
      
      const result = validateConversation(invalid);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.field === 'status'));
    });

    test('should reject conversation with non-array messages', () => {
      const invalid = { ...validConversation, messages: 'not-array' as any };
      
      const result = validateConversation(invalid);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.field === 'messages'));
    });

    test('should validate conversation with valid metadata', () => {
      const withMetadata = {
        ...validConversation,
        metadata: {
          messageCount: 5,
          lastActivity: Date.now(),
          tags: ['tag1', 'tag2']
        }
      };
      
      const result = validateConversation(withMetadata);
      
      assert.strictEqual(result.isValid, true);
    });

    test('should reject conversation with invalid metadata', () => {
      const invalid = {
        ...validConversation,
        metadata: {
          messageCount: -1,
          lastActivity: -1,
          tags: 'not-array' as any
        }
      };
      
      const result = validateConversation(invalid);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.field === 'metadata.messageCount'));
      assert.ok(result.errors.some(e => e.field === 'metadata.lastActivity'));
      assert.ok(result.errors.some(e => e.field === 'metadata.tags'));
    });
  });

  suite('validateCreateConversationDto', () => {
    test('should validate empty DTO', () => {
      const result = validateCreateConversationDto({});
      
      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    test('should validate DTO with valid fields', () => {
      const dto = {
        title: 'Test Title',
        initialMessage: 'Hello world',
        tags: ['tag1', 'tag2']
      };
      
      const result = validateCreateConversationDto(dto);
      
      assert.strictEqual(result.isValid, true);
    });

    test('should reject DTO with empty title', () => {
      const dto = { title: '   ' };
      
      const result = validateCreateConversationDto(dto);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.field === 'title'));
    });

    test('should reject DTO with empty initial message', () => {
      const dto = { initialMessage: '   ' };
      
      const result = validateCreateConversationDto(dto);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.field === 'initialMessage'));
    });

    test('should reject DTO with non-array tags', () => {
      const dto = { tags: 'not-array' as any };
      
      const result = validateCreateConversationDto(dto);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.field === 'tags'));
    });
  });

  suite('validateMessage', () => {
    const validMessage: Message = {
      id: 'msg-1',
      conversationId: 'conv-1',
      content: 'Test message',
      sender: 'user',
      timestamp: Date.now(),
      codeChanges: [],
      snapshot: []
    };

    test('should validate a valid message', () => {
      const result = validateMessage(validMessage);
      
      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    test('should reject message without required fields', () => {
      const invalid = { ...validMessage };
      delete (invalid as any).id;
      delete (invalid as any).conversationId;
      delete (invalid as any).content;
      
      const result = validateMessage(invalid);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.field === 'id'));
      assert.ok(result.errors.some(e => e.field === 'conversationId'));
      assert.ok(result.errors.some(e => e.field === 'content'));
    });

    test('should reject message with invalid sender', () => {
      const invalid = { ...validMessage, sender: 'invalid' as any };
      
      const result = validateMessage(invalid);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.field === 'sender'));
    });

    test('should reject message with invalid timestamp', () => {
      const invalid = { ...validMessage, timestamp: -1 };
      
      const result = validateMessage(invalid);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.field === 'timestamp'));
    });

    test('should reject message with non-array code changes', () => {
      const invalid = { ...validMessage, codeChanges: 'not-array' as any };
      
      const result = validateMessage(invalid);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.field === 'codeChanges'));
    });

    test('should reject message with non-array snapshot', () => {
      const invalid = { ...validMessage, snapshot: 'not-array' as any };
      
      const result = validateMessage(invalid);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.field === 'snapshot'));
    });
  });

  suite('validateCreateMessageDto', () => {
    const validDto = {
      conversationId: 'conv-1',
      content: 'Test message',
      sender: 'user' as const
    };

    test('should validate valid DTO', () => {
      const result = validateCreateMessageDto(validDto);
      
      assert.strictEqual(result.isValid, true);
    });

    test('should reject DTO without required fields', () => {
      const invalid = { ...validDto };
      delete (invalid as any).conversationId;
      delete (invalid as any).content;
      delete (invalid as any).sender;
      
      const result = validateCreateMessageDto(invalid);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.field === 'conversationId'));
      assert.ok(result.errors.some(e => e.field === 'content'));
      assert.ok(result.errors.some(e => e.field === 'sender'));
    });

    test('should reject DTO with non-array code changes', () => {
      const invalid = { ...validDto, codeChanges: 'not-array' as any };
      
      const result = validateCreateMessageDto(invalid);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.field === 'codeChanges'));
    });
  });

  suite('validateCodeChange', () => {
    test('should validate create change', () => {
      const change: CodeChange = {
        filePath: 'test.ts',
        changeType: 'create',
        afterContent: 'const x = 1;'
      };
      
      const result = validateCodeChange(change);
      
      assert.strictEqual(result.isValid, true);
    });

    test('should validate modify change', () => {
      const change: CodeChange = {
        filePath: 'test.ts',
        changeType: 'modify',
        beforeContent: 'const x = 1;',
        afterContent: 'const x = 2;',
        lineNumbers: { start: 1, end: 1 }
      };
      
      const result = validateCodeChange(change);
      
      assert.strictEqual(result.isValid, true);
    });

    test('should validate delete change', () => {
      const change: CodeChange = {
        filePath: 'test.ts',
        changeType: 'delete',
        beforeContent: 'const x = 1;'
      };
      
      const result = validateCodeChange(change);
      
      assert.strictEqual(result.isValid, true);
    });

    test('should reject change without file path', () => {
      const change = {
        changeType: 'create',
        afterContent: 'content'
      } as any;
      
      const result = validateCodeChange(change);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.field === 'filePath'));
    });

    test('should reject change with invalid change type', () => {
      const change = {
        filePath: 'test.ts',
        changeType: 'invalid',
        afterContent: 'content'
      } as any;
      
      const result = validateCodeChange(change);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.field === 'changeType'));
    });

    test('should reject create change without after content', () => {
      const change = {
        filePath: 'test.ts',
        changeType: 'create'
      } as any;
      
      const result = validateCodeChange(change);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.field === 'afterContent'));
    });

    test('should reject delete change without before content', () => {
      const change = {
        filePath: 'test.ts',
        changeType: 'delete'
      } as any;
      
      const result = validateCodeChange(change);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.field === 'beforeContent'));
    });

    test('should reject modify change without both contents', () => {
      const change1 = {
        filePath: 'test.ts',
        changeType: 'modify',
        afterContent: 'new'
      } as any;
      
      const change2 = {
        filePath: 'test.ts',
        changeType: 'modify',
        beforeContent: 'old'
      } as any;
      
      const result1 = validateCodeChange(change1);
      const result2 = validateCodeChange(change2);
      
      assert.strictEqual(result1.isValid, false);
      assert.strictEqual(result2.isValid, false);
    });

    test('should reject change with invalid line numbers', () => {
      const change = {
        filePath: 'test.ts',
        changeType: 'modify',
        beforeContent: 'old',
        afterContent: 'new',
        lineNumbers: { start: 5, end: 3 }
      } as any;
      
      const result = validateCodeChange(change);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.field === 'lineNumbers'));
    });
  });

  suite('validateFileSnapshot', () => {
    const validSnapshot: FileSnapshot = {
      filePath: 'test.ts',
      content: 'const x = 1;',
      timestamp: Date.now(),
      checksum: 'abc123def456'
    };

    test('should validate valid snapshot', () => {
      const result = validateFileSnapshot(validSnapshot);
      
      assert.strictEqual(result.isValid, true);
    });

    test('should reject snapshot without required fields', () => {
      const invalid = { ...validSnapshot };
      delete (invalid as any).filePath;
      delete (invalid as any).content;
      delete (invalid as any).checksum;
      
      const result = validateFileSnapshot(invalid);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.field === 'filePath'));
      assert.ok(result.errors.some(e => e.field === 'content'));
      assert.ok(result.errors.some(e => e.field === 'checksum'));
    });

    test('should reject snapshot with path traversal', () => {
      const invalid = { ...validSnapshot, filePath: '../../../etc/passwd' };
      
      const result = validateFileSnapshot(invalid);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.field === 'filePath'));
    });

    test('should reject snapshot with invalid timestamp', () => {
      const invalid1 = { ...validSnapshot, timestamp: -1 };
      const invalid2 = { ...validSnapshot, timestamp: Date.now() + 120000 }; // 2 minutes in future
      
      const result1 = validateFileSnapshot(invalid1);
      const result2 = validateFileSnapshot(invalid2);
      
      assert.strictEqual(result1.isValid, false);
      assert.strictEqual(result2.isValid, false);
      assert.ok(result1.errors.some(e => e.field === 'timestamp'));
      assert.ok(result2.errors.some(e => e.field === 'timestamp'));
    });

    test('should reject snapshot with invalid checksum', () => {
      const invalid1 = { ...validSnapshot, checksum: '' };
      const invalid2 = { ...validSnapshot, checksum: 'invalid-checksum!' };
      
      const result1 = validateFileSnapshot(invalid1);
      const result2 = validateFileSnapshot(invalid2);
      
      assert.strictEqual(result1.isValid, false);
      assert.strictEqual(result2.isValid, false);
      assert.ok(result1.errors.some(e => e.field === 'checksum'));
      assert.ok(result2.errors.some(e => e.field === 'checksum'));
    });

    test('should validate snapshot with valid metadata', () => {
      const withMetadata = {
        ...validSnapshot,
        metadata: {
          size: 11,
          encoding: 'utf-8',
          language: 'typescript',
          existed: true
        }
      };
      
      const result = validateFileSnapshot(withMetadata);
      
      assert.strictEqual(result.isValid, true);
    });

    test('should reject snapshot with invalid metadata', () => {
      const invalid = {
        ...validSnapshot,
        metadata: {
          size: -1,
          encoding: 123 as any,
          language: 456 as any,
          existed: 'yes' as any
        }
      };
      
      const result = validateFileSnapshot(invalid);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.field === 'metadata.size'));
      assert.ok(result.errors.some(e => e.field === 'metadata.encoding'));
      assert.ok(result.errors.some(e => e.field === 'metadata.language'));
      assert.ok(result.errors.some(e => e.field === 'metadata.existed'));
    });

    test('should detect size mismatch in metadata', () => {
      const invalid = {
        ...validSnapshot,
        content: 'short',
        metadata: {
          size: 1000 // Much larger than actual content
        }
      };
      
      const result = validateFileSnapshot(invalid);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.field === 'metadata.size'));
    });
  });

  suite('validateArray', () => {
    const mockValidator = (item: any) => {
      if (typeof item === 'string') {
        return { isValid: true, errors: [] };
      }
      return { 
        isValid: false, 
        errors: [new ValidationError('Must be string', 'value', item)]
      };
    };

    test('should validate array of valid items', () => {
      const items = ['item1', 'item2', 'item3'];
      
      const result = validateArray(items, mockValidator, 'testItems');
      
      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    test('should reject non-array input', () => {
      const result = validateArray('not-array' as any, mockValidator, 'testItems');
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.field === 'testItems'));
    });

    test('should collect errors from invalid items', () => {
      const items = ['valid', 123, 'valid', 456];
      
      const result = validateArray(items, mockValidator, 'testItems');
      
      assert.strictEqual(result.isValid, false);
      assert.strictEqual(result.errors.length, 2);
      assert.ok(result.errors.some(e => e.field === 'testItems[1].value'));
      assert.ok(result.errors.some(e => e.field === 'testItems[3].value'));
    });

    test('should use default field name', () => {
      const result = validateArray('not-array' as any, mockValidator);
      
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.field === 'items'));
    });
  });
});