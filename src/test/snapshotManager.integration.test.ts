/**
 * Integration test for SnapshotManager
 * Tests the core functionality without complex mocking
 */

// Using global mocha functions
import * as assert from 'assert';
import { SnapshotManager } from '../cursor-companion/services/snapshotManager';

suite('SnapshotManager Integration', () => {
  suite('basic functionality', () => {
    test('should create a SnapshotManager instance', () => {
      const mockContext = {
        globalStorageUri: {
          fsPath: '/test/storage'
        }
      } as any;

      const mockDataStorage = {
        saveSnapshot: () => Promise.resolve(),
        getSnapshot: () => Promise.resolve(null)
      } as any;

      const snapshotManager = new SnapshotManager(mockContext, mockDataStorage);
      assert.ok(snapshotManager);
    });

    test('should return statistics', async () => {
      const mockContext = {
        globalStorageUri: {
          fsPath: '/test/storage'
        }
      } as any;

      const mockDataStorage = {
        saveSnapshot: () => Promise.resolve(),
        getSnapshot: () => Promise.resolve(null)
      } as any;

      const snapshotManager = new SnapshotManager(mockContext, mockDataStorage);
      const stats = await snapshotManager.getStats();

      assert.ok(typeof stats.totalSnapshots === 'number');
      assert.ok(typeof stats.deduplicationEntries === 'number');
      assert.ok(typeof stats.cacheSize === 'number');
    });
  });
});