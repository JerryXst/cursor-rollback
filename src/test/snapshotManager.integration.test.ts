/**
 * Integration test for SnapshotManager
 * Tests the core functionality without complex mocking
 */

import { describe, it } from 'mocha';
import * as assert from 'assert';
import { SnapshotManager } from '../cursor-companion/services/snapshotManager';

describe('SnapshotManager Integration', () => {
  describe('basic functionality', () => {
    it('should create a SnapshotManager instance', () => {
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

    it('should return statistics', async () => {
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