/**
 * Comprehensive unit tests for model factories
 */

// Using global mocha functions
import * as assert from 'assert';
import * as sinon from 'sinon';
import {
  ConversationFactory,
  MessageFactory,
  CodeChangeFactory,
  FileSnapshotFactory,
  BatchFactory
} from '../cursor-companion/models/factories';
import { Conversation, Message, CodeChange, FileSnapshot } from '../cursor-companion/models';
import { ValidationError } from '../cursor-companion/models/validation';

suite('Model Factories', () => {
  let sandbox: sinon.SinonSandbox;

  setup(() => {
    sandbox = sinon.createSandbox();
    // Mock UUID generation for consistent testing
    sandbox.stub(require('../cursor-companion/utils/helpers'), 'generateUUID')
      .callsFake(() => `test-uuid-${Date.now()}`);
  });

  teardown(() => {
    sandbox.restore();
  });

  suite('ConversationFactory', () => {
    suite('create', () => {
      test('should create a valid conversation with minimal data', () => {
        const dto = { title: 'Test Conversation' };
        const conversation = ConversationFactory.create(dto);

        assert.ok(conversation.id);
        assert.strictEqual(conversation.title, 'Test Conversation');
        assert.strictEqual(conversation.status, 'active');
        assert.ok(Array.isArray(conversation.messages));
        assert.strictEqual(conversation.messages.length, 0);
        assert.ok(conversation.metadata);
        assert.strictEqual(conversation.metadata.messageCount, 0);
      });

      test('should create conversation with default title when not provided', () => {
        const conversation = ConversationFactory.create({});
        
        assert.ok(conversation.title);
        assert.ok(conversation.title.includes('Conversation'));
      });

      test('should create conversation with tags', () => {
        const dto = { title: 'Test', tags: ['tag1', 'tag2'] };
        const conversation = ConversationFactory.create(dto);

        assert.deepStrictEqual(conversation.metadata?.tags, ['tag1', 'tag2']);
      });

      test('should throw ValidationError for invalid data', () => {
        // Mock validation to fail
        sandbox.stub(require('../cursor-companion/models/validation'), 'validateConversation')
          .returns({ isValid: false, errors: [{ message: 'Test error' }] });

        assert.throws(() => {
          ConversationFactory.create({ title: 'Test' });
        }, ValidationError);
      });
    });

    suite('createWithMessage', () => {
      test('should create conversation with initial message', () => {
        const dto = { title: 'Test', initialMessage: 'Hello' };
        const result = ConversationFactory.createWithMessage(dto);

        assert.ok(result.conversation);
        assert.ok(result.message);
        assert.strictEqual(result.conversation.messages.length, 1);
        assert.strictEqual(result.message.content, 'Hello');
        assert.strictEqual(result.conversation.metadata?.messageCount, 1);
      });

      test('should create conversation without message when not provided', () => {
        const dto = { title: 'Test' };
        const result = ConversationFactory.createWithMessage(dto);

        assert.ok(result.conversation);
        assert.strictEqual(result.message, null);
        assert.strictEqual(result.conversation.messages.length, 0);
      });
    });

    suite('updateMetadata', () => {
      test('should update conversation metadata', () => {
        const conversation = ConversationFactory.create({ title: 'Test' });
        const updated = ConversationFactory.updateMetadata(conversation, {
          messageCount: 5,
          tags: ['new-tag']
        });

        assert.strictEqual(updated.metadata?.messageCount, 5);
        assert.deepStrictEqual(updated.metadata?.tags, ['new-tag']);
      });

      test('should throw ValidationError for invalid metadata', () => {
        const conversation = ConversationFactory.create({ title: 'Test' });
        
        sandbox.stub(require('../cursor-companion/models/validation'), 'validateConversation')
          .returns({ isValid: false, errors: [{ message: 'Invalid metadata' }] });

        assert.throws(() => {
          ConversationFactory.updateMetadata(conversation, { messageCount: -1 });
        }, ValidationError);
      });
    });

    suite('archive and activate', () => {
      test('should archive a conversation', () => {
        const conversation = ConversationFactory.create({ title: 'Test' });
        const archived = ConversationFactory.archive(conversation);

        assert.strictEqual(archived.status, 'archived');
      });

      test('should activate an archived conversation', () => {
        const conversation = ConversationFactory.create({ title: 'Test' });
        const archived = ConversationFactory.archive(conversation);
        const activated = ConversationFactory.activate(archived);

        assert.strictEqual(activated.status, 'active');
      });
    });
  });

  suite('MessageFactory', () => {
    suite('create', () => {
      test('should create a valid message', () => {
        const dto = {
          conversationId: 'conv-1',
          content: 'Test message',
          sender: 'user' as const
        };
        const message = MessageFactory.create(dto);

        assert.ok(message.id);
        assert.strictEqual(message.conversationId, 'conv-1');
        assert.strictEqual(message.content, 'Test message');
        assert.strictEqual(message.sender, 'user');
        assert.ok(Array.isArray(message.codeChanges));
        assert.ok(Array.isArray(message.snapshot));
      });

      test('should create message with code changes', () => {
        const codeChanges: CodeChange[] = [{
          filePath: 'test.ts',
          changeType: 'create',
          afterContent: 'content'
        }];

        const dto = {
          conversationId: 'conv-1',
          content: 'Test message',
          sender: 'user' as const,
          codeChanges
        };
        const message = MessageFactory.create(dto);

        assert.strictEqual(message.codeChanges.length, 1);
        assert.strictEqual(message.codeChanges[0].filePath, 'test.ts');
      });

      test('should throw ValidationError for invalid data', () => {
        sandbox.stub(require('../cursor-companion/models/validation'), 'validateMessage')
          .returns({ isValid: false, errors: [{ message: 'Test error' }] });

        assert.throws(() => {
          MessageFactory.create({
            conversationId: 'conv-1',
            content: 'Test',
            sender: 'user'
          });
        }, ValidationError);
      });
    });

    suite('createUserMessage', () => {
      test('should create user message with estimated token count', () => {
        sandbox.stub(require('../cursor-companion/utils/helpers'), 'estimateTokenCount')
          .returns(10);

        const message = MessageFactory.createUserMessage('conv-1', 'Hello world');

        assert.strictEqual(message.sender, 'user');
        assert.strictEqual(message.content, 'Hello world');
        assert.strictEqual(message.metadata?.tokenCount, 10);
        assert.strictEqual(message.metadata?.hasErrors, false);
      });
    });

    suite('createAiMessage', () => {
      test('should create AI message with code changes', () => {
        const codeChanges: CodeChange[] = [{
          filePath: 'test.ts',
          changeType: 'modify',
          beforeContent: 'old',
          afterContent: 'new'
        }];

        const message = MessageFactory.createAiMessage('conv-1', 'Response', codeChanges);

        assert.strictEqual(message.sender, 'ai');
        assert.strictEqual(message.codeChanges.length, 1);
      });
    });

    suite('addCodeChanges', () => {
      test('should add code changes to existing message', () => {
        const message = MessageFactory.createUserMessage('conv-1', 'Test');
        const codeChanges: CodeChange[] = [{
          filePath: 'test.ts',
          changeType: 'create',
          afterContent: 'content'
        }];

        const updated = MessageFactory.addCodeChanges(message, codeChanges);

        assert.strictEqual(updated.codeChanges.length, 1);
        assert.strictEqual(updated.codeChanges[0].filePath, 'test.ts');
      });

      test('should throw ValidationError for invalid result', () => {
        const message = MessageFactory.createUserMessage('conv-1', 'Test');
        const codeChanges: CodeChange[] = [{
          filePath: 'test.ts',
          changeType: 'create',
          afterContent: 'content'
        }];

        sandbox.stub(require('../cursor-companion/models/validation'), 'validateMessage')
          .returns({ isValid: false, errors: [{ message: 'Invalid message' }] });

        assert.throws(() => {
          MessageFactory.addCodeChanges(message, codeChanges);
        }, ValidationError);
      });
    });

    suite('addSnapshots', () => {
      test('should add snapshots to existing message', () => {
        const message = MessageFactory.createUserMessage('conv-1', 'Test');
        const snapshots: FileSnapshot[] = [{
          filePath: 'test.ts',
          content: 'content',
          timestamp: Date.now(),
          checksum: 'abc123'
        }];

        const updated = MessageFactory.addSnapshots(message, snapshots);

        assert.strictEqual(updated.snapshot.length, 1);
        assert.strictEqual(updated.snapshot[0].filePath, 'test.ts');
      });
    });
  });

  suite('CodeChangeFactory', () => {
    setup(() => {
      sandbox.stub(require('../cursor-companion/utils/helpers'), 'detectLanguage')
        .returns('typescript');
    });

    suite('createFile', () => {
      test('should create file creation change', () => {
        const change = CodeChangeFactory.createFile('test.ts', 'const x = 1;');

        assert.strictEqual(change.filePath, 'test.ts');
        assert.strictEqual(change.changeType, 'create');
        assert.strictEqual(change.afterContent, 'const x = 1;');
        assert.strictEqual(change.metadata?.language, 'typescript');
        assert.strictEqual(change.metadata?.changeSize, 11);
      });

      test('should throw ValidationError for invalid change', () => {
        sandbox.stub(require('../cursor-companion/models/validation'), 'validateCodeChange')
          .returns({ isValid: false, errors: [{ message: 'Invalid change' }] });

        assert.throws(() => {
          CodeChangeFactory.createFile('test.ts', 'content');
        }, ValidationError);
      });
    });

    suite('modifyFile', () => {
      test('should create file modification change', () => {
        const change = CodeChangeFactory.modifyFile(
          'test.ts',
          'const x = 1;',
          'const x = 2;',
          { start: 1, end: 1 }
        );

        assert.strictEqual(change.changeType, 'modify');
        assert.strictEqual(change.beforeContent, 'const x = 1;');
        assert.strictEqual(change.afterContent, 'const x = 2;');
        assert.deepStrictEqual(change.lineNumbers, { start: 1, end: 1 });
        assert.strictEqual(change.metadata?.changeSize, 0); // Same length
      });
    });

    suite('deleteFile', () => {
      test('should create file deletion change', () => {
        const change = CodeChangeFactory.deleteFile('test.ts', 'const x = 1;');

        assert.strictEqual(change.changeType, 'delete');
        assert.strictEqual(change.beforeContent, 'const x = 1;');
        assert.strictEqual(change.metadata?.changeSize, 11);
      });
    });

    suite('markAsAiGenerated', () => {
      test('should mark change as AI-generated with confidence', () => {
        const change = CodeChangeFactory.createFile('test.ts', 'content');
        const marked = CodeChangeFactory.markAsAiGenerated(change, 0.8);

        assert.strictEqual(marked.metadata?.aiGenerated, true);
        assert.strictEqual(marked.metadata?.confidence, 0.8);
      });

      test('should clamp confidence to valid range', () => {
        const change = CodeChangeFactory.createFile('test.ts', 'content');
        const marked1 = CodeChangeFactory.markAsAiGenerated(change, -0.5);
        const marked2 = CodeChangeFactory.markAsAiGenerated(change, 1.5);

        assert.strictEqual(marked1.metadata?.confidence, 0);
        assert.strictEqual(marked2.metadata?.confidence, 1);
      });
    });
  });

  suite('FileSnapshotFactory', () => {
    setup(() => {
      sandbox.stub(require('../cursor-companion/utils/helpers'), 'calculateChecksum')
        .returns('abc123');
    });

    suite('create', () => {
      test('should create file snapshot', () => {
        const snapshot = FileSnapshotFactory.create('test.ts', 'content');

        assert.strictEqual(snapshot.filePath, 'test.ts');
        assert.strictEqual(snapshot.content, 'content');
        assert.strictEqual(snapshot.checksum, 'abc123');
        assert.strictEqual(snapshot.metadata?.size, 7);
        assert.strictEqual(snapshot.metadata?.existed, true);
      });

      test('should create snapshot for non-existent file', () => {
        const snapshot = FileSnapshotFactory.create('test.ts', 'content', false);

        assert.strictEqual(snapshot.metadata?.existed, false);
      });

      test('should throw ValidationError for invalid snapshot', () => {
        sandbox.stub(require('../cursor-companion/models/validation'), 'validateFileSnapshot')
          .returns({ isValid: false, errors: [{ message: 'Invalid snapshot' }] });

        assert.throws(() => {
          FileSnapshotFactory.create('test.ts', 'content');
        }, ValidationError);
      });
    });

    suite('createNonExistent', () => {
      test('should create snapshot for non-existent file', () => {
        const snapshot = FileSnapshotFactory.createNonExistent('test.ts');

        assert.strictEqual(snapshot.filePath, 'test.ts');
        assert.strictEqual(snapshot.content, '');
        assert.strictEqual(snapshot.metadata?.existed, false);
      });
    });

    suite('createCollection', () => {
      test('should create snapshot collection', () => {
        const snapshots = [
          FileSnapshotFactory.create('test1.ts', 'content1'),
          FileSnapshotFactory.create('test2.ts', 'content2')
        ];

        const collection = FileSnapshotFactory.createCollection(
          'msg-1',
          snapshots,
          'Test collection'
        );

        assert.ok(collection.id);
        assert.strictEqual(collection.messageId, 'msg-1');
        assert.strictEqual(collection.snapshots.length, 2);
        assert.strictEqual(collection.description, 'Test collection');
      });
    });

    suite('verifyIntegrity', () => {
      test('should verify snapshot integrity', () => {
        const snapshot = FileSnapshotFactory.create('test.ts', 'content');
        const isValid = FileSnapshotFactory.verifyIntegrity(snapshot);

        assert.strictEqual(isValid, true);
      });

      test('should detect corrupted snapshot', () => {
        const snapshot = FileSnapshotFactory.create('test.ts', 'content');
        snapshot.checksum = 'invalid';

        const isValid = FileSnapshotFactory.verifyIntegrity(snapshot);

        assert.strictEqual(isValid, false);
      });
    });
  });

  suite('BatchFactory', () => {
    setup(() => {
      sandbox.stub(require('../cursor-companion/utils/helpers'), 'calculateChecksum')
        .returns('abc123');
      sandbox.stub(require('../cursor-companion/utils/helpers'), 'detectLanguage')
        .returns('typescript');
    });

    suite('createSnapshots', () => {
      test('should create multiple snapshots', () => {
        const files = [
          { path: 'test1.ts', content: 'content1' },
          { path: 'test2.ts', content: 'content2', existed: false }
        ];

        const snapshots = BatchFactory.createSnapshots(files);

        assert.strictEqual(snapshots.length, 2);
        assert.strictEqual(snapshots[0].filePath, 'test1.ts');
        assert.strictEqual(snapshots[0].metadata?.existed, true);
        assert.strictEqual(snapshots[1].filePath, 'test2.ts');
        assert.strictEqual(snapshots[1].metadata?.existed, false);
      });
    });

    suite('createCodeChanges', () => {
      test('should create multiple code changes', () => {
        const changes = [
          {
            filePath: 'test1.ts',
            changeType: 'create' as const,
            afterContent: 'content1'
          },
          {
            filePath: 'test2.ts',
            changeType: 'modify' as const,
            beforeContent: 'old',
            afterContent: 'new'
          },
          {
            filePath: 'test3.ts',
            changeType: 'delete' as const,
            beforeContent: 'content3'
          }
        ];

        const codeChanges = BatchFactory.createCodeChanges(changes);

        assert.strictEqual(codeChanges.length, 3);
        assert.strictEqual(codeChanges[0].changeType, 'create');
        assert.strictEqual(codeChanges[1].changeType, 'modify');
        assert.strictEqual(codeChanges[2].changeType, 'delete');
      });

      test('should throw error for unknown change type', () => {
        const changes = [{
          filePath: 'test.ts',
          changeType: 'unknown' as any,
          afterContent: 'content'
        }];

        assert.throws(() => {
          BatchFactory.createCodeChanges(changes);
        }, /Unknown change type/);
      });
    });
  });
});