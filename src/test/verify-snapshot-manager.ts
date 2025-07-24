/**
 * Simple verification script for SnapshotManager
 */

import { SnapshotManager } from '../cursor-companion/services/snapshotManager';

// Create mock context and data storage
const mockContext = {
  globalStorageUri: {
    fsPath: '/test/storage'
  }
} as any;

const mockDataStorage = {
  saveSnapshot: () => Promise.resolve(),
  getSnapshot: () => Promise.resolve(null)
} as any;

// Test basic instantiation
try {
  const snapshotManager = new SnapshotManager(mockContext, mockDataStorage);
  console.log('✓ SnapshotManager created successfully');
  
  // Test stats method
  snapshotManager.getStats().then(stats => {
    console.log('✓ getStats() works:', stats);
    console.log('✓ All basic tests passed');
  }).catch(error => {
    console.error('✗ getStats() failed:', error);
  });
  
} catch (error) {
  console.error('✗ Failed to create SnapshotManager:', error);
}