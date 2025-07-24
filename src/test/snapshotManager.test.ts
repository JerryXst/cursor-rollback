/**
 * Tests for SnapshotManager
 * Validates file state snapshot creation, incremental snapshots, and deduplication mechanisms
 */

import { describe, it, beforeEach, afterEach } from 'mocha';
import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { SnapshotManager } from '../cursor-companion/services/snapshotManager';
import { LocalFileStorage } from '../cursor-companion/services/localFileStorage';
import { SnapshotOptions } from '../cursor-companion/models/fileSnapshot';
import { SnapshotError } from '../cursor-companion/models/errors';

describe('SnapshotManager', () => {
  let snapshotManager: SnapshotManager;
  let mockContext: vscode.ExtensionContext;
  let mockDataStorage: LocalFileStorage;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
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

  afterEach(() => {
    sandbox.restore();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      // Mock vscode.workspace.fs methods
      const mockStat = sandbox.stub(vscode.workspace.fs, 'stat').rejects(new Error('Directory not found'));
      const mockCreateDirectory = sandbox.stub(vscode.workspace.fs, 'createDirectory').resolves();
      const mockReadFile = sandbox.stub(vscode.workspace.fs, 'readFile').rejects(new Error('File not found'));

      await snapshotManager.initialize();

      // Should create necessary directories
      assert.strictEqual(mockCreateDirectory.callCount, 3);
      assert.ok(mockCreateDirectory.calledWith(sinon.match({ fsPath: '/test/storage/cursor-companion/snapshots' })));
    });

    it('should throw SnapshotError if initialization fails', async () => {
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

  describe('createSnapshot', () => {
    beforeEach(async () => {
      // Initialize the snapshot manager
      const mockStat = sandbox.stub(vscode.workspace.fs, 'stat').rejects(new Error('Directory not found'));
      const mockCreateDirectory = sandbox.stub(vscode.workspace.fs, 'createDirectory').resolves();
      const mockReadFile = sandbox.stub(vscode.workspace.fs, 'readFile').rejects(new Error('File not found'));

      await snapshotManager.initialize();
      
      // Reset stubs after initialization
      sandbox.restore();
      sandbox = sinon.createSandbox();
    });

    it('should create a basic snapshot', async () => {
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

    it('should throw SnapshotError if no workspace folder is found', async () => {
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

  describe('restoreFromSnapshot', () => {
    beforeEach(async () => {
      // Initialize the snapshot manager
      const mockStat = sandbox.stub(vscode.workspace.fs, 'stat').rejects(new Error('Directory not found'));
      const mockCreateDirectory = sandbox.stub(vscode.workspace.fs, 'createDirectory').resolves();
      const mockReadFile = sandbox.stub(vscode.workspace.fs, 'readFile').rejects(new Error('File not found'));

      await snapshotManager.initialize();
      
      // Reset stubs after initialization
      sandbox.restore();
      sandbox = sinon.createSandbox();
    });

    it('should throw SnapshotError if snapshot is not found', async () => {
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

  describe('compareSnapshots', () => {
    beforeEach(async () => {
      // Initialize the snapshot manager
      const mockStat = sandbox.stub(vscode.workspace.fs, 'stat').rejects(new Error('Directory not found'));
      const mockCreateDirectory = sandbox.stub(vscode.workspace.fs, 'createDirectory').resolves();
      const mockReadFile = sandbox.stub(vscode.workspace.fs, 'readFile').rejects(new Error('File not found'));

      await snapshotManager.initialize();
      
      // Reset stubs after initialization
      sandbox.restore();
      sandbox = sinon.createSandbox();
    });

    it('should throw SnapshotError if either snapshot is not found', async () => {
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

  describe('getSnapshotStats', () => {
    beforeEach(async () => {
      // Initialize the snapshot manager
      const mockStat = sandbox.stub(vscode.workspace.fs, 'stat').rejects(new Error('Directory not found'));
      const mockCreateDirectory = sandbox.stub(vscode.workspace.fs, 'createDirectory').resolves();
      const mockReadFile = sandbox.stub(vscode.workspace.fs, 'readFile').rejects(new Error('File not found'));

      await snapshotManager.initialize();
      
      // Reset stubs after initialization
      sandbox.restore();
      sandbox = sinon.createSandbox();
    });

    it('should throw SnapshotError if snapshot is not found', async () => {
      const mockGetSnapshot = sandbox.stub(mockDataStorage, 'getSnapshot').resolves(null);

      try {
        await snapshotManager.getSnapshotStats('non-existent');
        assert.fail('Should have thrown SnapshotError');
      } catch (error) {
        assert.ok(error instanceof SnapshotError);
      }
    });
  });

  describe('getStats', () => {
    it('should return snapshot manager statistics', async () => {
      const stats = await snapshotManager.getStats();

      assert.ok(typeof stats.totalSnapshots === 'number');
      assert.ok(typeof stats.deduplicationEntries === 'number');
      assert.ok(typeof stats.cacheSize === 'number');
    });
  });
});