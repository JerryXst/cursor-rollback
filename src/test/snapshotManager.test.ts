/**
 * Tests for SnapshotManager
 * Validates file state snapshot creation, incremental snapshots, and deduplication mechanisms
 */

// Using global mocha functions
import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { SnapshotManager } from '../cursor-companion/services/snapshotManager';
import { LocalFileStorage } from '../cursor-companion/services/localFileStorage';
import { SnapshotOptions } from '../cursor-companion/models/fileSnapshot';
import { SnapshotError } from '../cursor-companion/models/errors';

suite('SnapshotManager', () => {
  let snapshotManager: SnapshotManager;
  let mockContext: vscode.ExtensionContext;
  let mockDataStorage: LocalFileStorage;
  let sandbox: sinon.SinonSandbox;

  setup(() => {
    sandbox = sinon.createSandbox();

    // Create mock context
    mockContext = {
      globalStorageUri: {
        fsPath: '/test/storage'
      }
    } as any;

    // Create mock data storage
    mockDataStorage = {
      saveSnapshot: sandbox.stub(),
      getSnapshot: sandbox.stub()
    } as any;

    // Create snapshot manager instance
    snapshotManager = new SnapshotManager(mockContext, mockDataStorage);
  });

  teardown(() => {
    sandbox.restore();
  });

  suite('initialization', () => {
    test('should initialize successfully', async () => {
      // Mock vscode.workspace.fs methods
      const mockStat = sandbox.stub(vscode.workspace.fs, 'stat').rejects(new Error('Directory not found'));
      const mockCreateDirectory = sandbox.stub(vscode.workspace.fs, 'createDirectory').resolves();
      const mockReadFile = sandbox.stub(vscode.workspace.fs, 'readFile').rejects(new Error('File not found'));

      await snapshotManager.initialize();

      // Should create necessary directories
      assert.strictEqual(mockCreateDirectory.callCount, 3);
      assert.ok(mockCreateDirectory.calledWith(sinon.match({ fsPath: '/test/storage/cursor-companion/snapshots' })));
    });

    test('should throw SnapshotError if initialization fails', async () => {
      const mockStat = sandbox.stub(vscode.workspace.fs, 'stat').rejects(new Error('Permission denied'));
      const mockCreateDirectory = sandbox.stub(vscode.workspace.fs, 'createDirectory').rejects(new Error('Permission denied'));

      try {
        await snapshotManager.initialize();
        assert.fail('Should have thrown SnapshotError');
      } catch (error) {
        assert.ok(error instanceof SnapshotError);
      }
    });
  });

  suite('createSnapshot', () => {
    setup(async () => {
      // Initialize the snapshot manager
      const mockStat = sandbox.stub(vscode.workspace.fs, 'stat').rejects(new Error('Directory not found'));
      const mockCreateDirectory = sandbox.stub(vscode.workspace.fs, 'createDirectory').resolves();
      const mockReadFile = sandbox.stub(vscode.workspace.fs, 'readFile').rejects(new Error('File not found'));

      await snapshotManager.initialize();
      
      // Reset stubs after initialization
      sandbox.restore();
      sandbox = sinon.createSandbox();
    });

    test('should create a basic snapshot', async () => {
      const messageId = 'test-message-123';
      
      // Mock workspace folders
      sandbox.stub(vscode.workspace, 'workspaceFolders').value([
        { uri: { fsPath: '/test/workspace' } }
      ]);

      const mockReadDirectory = sandbox.stub(vscode.workspace.fs, 'readDirectory')
        .resolves([['file1.ts', vscode.FileType.File]]);

      const mockReadFile = sandbox.stub(vscode.workspace.fs, 'readFile')
        .resolves(Buffer.from('console.log("test");'));

      const mockStat = sandbox.stub(vscode.workspace.fs, 'stat')
        .resolves({ size: 100, mtime: Date.now() } as any);

      const mockWriteFile = sandbox.stub(vscode.workspace.fs, 'writeFile').resolves();
      const mockSaveSnapshot = sandbox.stub(mockDataStorage, 'saveSnapshot').resolves();

      const result = await snapshotManager.createSnapshot(messageId);

      assert.ok(result);
      assert.strictEqual(result.messageId, messageId);
      assert.ok(Array.isArray(result.snapshots));
      assert.ok(mockSaveSnapshot.calledOnce);
    });

    test('should throw SnapshotError if no workspace folder is found', async () => {
      sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

      try {
        await snapshotManager.createSnapshot('test-message');
        assert.fail('Should have thrown SnapshotError');
      } catch (error) {
        assert.ok(error instanceof SnapshotError);
        assert.ok(error.message.includes('No workspace folder found'));
      }
    });
  });

  suite('restoreFromSnapshot', () => {
    setup(async () => {
      // Initialize the snapshot manager
      const mockStat = sandbox.stub(vscode.workspace.fs, 'stat').rejects(new Error('Directory not found'));
      const mockCreateDirectory = sandbox.stub(vscode.workspace.fs, 'createDirectory').resolves();
      const mockReadFile = sandbox.stub(vscode.workspace.fs, 'readFile').rejects(new Error('File not found'));

      await snapshotManager.initialize();
      
      // Reset stubs after initialization
      sandbox.restore();
      sandbox = sinon.createSandbox();
    });

    test('should throw SnapshotError if snapshot is not found', async () => {
      const snapshotId = 'non-existent-snapshot';
      const mockGetSnapshot = sandbox.stub(mockDataStorage, 'getSnapshot').resolves(null);

      try {
        await snapshotManager.restoreFromSnapshot(snapshotId);
        assert.fail('Should have thrown SnapshotError');
      } catch (error) {
        assert.ok(error instanceof SnapshotError);
        assert.ok(error.message.includes('not found'));
      }
    });
  });

  suite('compareSnapshots', () => {
    setup(async () => {
      // Initialize the snapshot manager
      const mockStat = sandbox.stub(vscode.workspace.fs, 'stat').rejects(new Error('Directory not found'));
      const mockCreateDirectory = sandbox.stub(vscode.workspace.fs, 'createDirectory').resolves();
      const mockReadFile = sandbox.stub(vscode.workspace.fs, 'readFile').rejects(new Error('File not found'));

      await snapshotManager.initialize();
      
      // Reset stubs after initialization
      sandbox.restore();
      sandbox = sinon.createSandbox();
    });

    test('should throw SnapshotError if either snapshot is not found', async () => {
      const mockGetSnapshot = sandbox.stub(mockDataStorage, 'getSnapshot')
        .onFirstCall().resolves(null)
        .onSecondCall().resolves({} as any);

      try {
        await snapshotManager.compareSnapshots('snapshot1', 'snapshot2');
        assert.fail('Should have thrown SnapshotError');
      } catch (error) {
        assert.ok(error instanceof SnapshotError);
      }
    });
  });

  suite('getSnapshotStats', () => {
    setup(async () => {
      // Initialize the snapshot manager
      const mockStat = sandbox.stub(vscode.workspace.fs, 'stat').rejects(new Error('Directory not found'));
      const mockCreateDirectory = sandbox.stub(vscode.workspace.fs, 'createDirectory').resolves();
      const mockReadFile = sandbox.stub(vscode.workspace.fs, 'readFile').rejects(new Error('File not found'));

      await snapshotManager.initialize();
      
      // Reset stubs after initialization
      sandbox.restore();
      sandbox = sinon.createSandbox();
    });

    test('should throw SnapshotError if snapshot is not found', async () => {
      const mockGetSnapshot = sandbox.stub(mockDataStorage, 'getSnapshot').resolves(null);

      try {
        await snapshotManager.getSnapshotStats('non-existent');
        assert.fail('Should have thrown SnapshotError');
      } catch (error) {
        assert.ok(error instanceof SnapshotError);
      }
    });
  });

  suite('getStats', () => {
    test('should return snapshot manager statistics', async () => {
      const stats = await snapshotManager.getStats();

      assert.ok(typeof stats.totalSnapshots === 'number');
      assert.ok(typeof stats.deduplicationEntries === 'number');
      assert.ok(typeof stats.cacheSize === 'number');
    });
  });
});