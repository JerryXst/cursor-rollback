/**
 * Snapshot manager implementation for Cursor Companion
 * Handles creation, storage, and retrieval of file snapshots with incremental and deduplication features
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { ISnapshotManager, IDataStorage } from './interfaces';
import { FileSnapshot, SnapshotCollection, SnapshotOptions } from '../models/fileSnapshot';
import { SnapshotError } from '../models/errors';
import { calculateStrongChecksum } from '../utils/dataIntegrity';
import { generateUUID } from '../utils/helpers';
import { DEFAULT_CONFIG } from '../models/common';

/**
 * Extended metadata for snapshots with incremental and deduplication support
 */
interface ExtendedSnapshotMetadata {
  size?: number;
  encoding?: string;
  language?: string;
  existed?: boolean;
  isIncremental?: boolean;
  isDeduplicated?: boolean;
  referencePath?: string;
}

/**
 * Snapshot manager implementation with incremental snapshots and deduplication
 */
export class SnapshotManager implements ISnapshotManager {
  private readonly snapshotsDir: string;
  private readonly incrementalDir: string;
  private readonly deduplicationDir: string;
  
  // In-memory cache for performance
  private snapshotCache = new Map<string, SnapshotCollection>();
  private checksumCache = new Map<string, string>(); // filePath -> checksum
  private deduplicationMap = new Map<string, string>(); // checksum -> stored file path
  
  // File locks for concurrent access protection
  private fileLocks = new Map<string, Promise<void>>();

  constructor(
    private context: vscode.ExtensionContext,
    private dataStorage: IDataStorage
  ) {
    this.snapshotsDir = path.join(context.globalStorageUri.fsPath, 'cursor-companion', 'snapshots');
    this.incrementalDir = path.join(this.snapshotsDir, 'incremental');
    this.deduplicationDir = path.join(this.snapshotsDir, 'deduplicated');
  }

  /**
   * Initialize the snapshot manager
   */
  async initialize(): Promise<void> {
    try {
      // Create necessary directories
      await this.ensureDirectoryExists(this.snapshotsDir);
      await this.ensureDirectoryExists(this.incrementalDir);
      await this.ensureDirectoryExists(this.deduplicationDir);
      
      // Load deduplication map from storage
      await this.loadDeduplicationMap();
      
      console.log('Cursor Companion: Snapshot manager initialized successfully');
    } catch (error) {
      throw new SnapshotError(`Failed to initialize snapshot manager: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Create a snapshot of current workspace state
   */
  async createSnapshot(messageId: string, options: SnapshotOptions = {}): Promise<SnapshotCollection> {
    return this.withFileLock(`snapshot-${messageId}`, async () => {
      try {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          throw new SnapshotError('No workspace folder found');
        }

        const snapshotId = generateUUID();
        const timestamp = Date.now();
        const snapshots: FileSnapshot[] = [];

        // Get files to include in snapshot
        const filesToSnapshot = await this.getFilesToSnapshot(workspaceFolder.uri, options);
        
        // Create snapshots for each file
        for (const filePath of filesToSnapshot) {
          try {
            const snapshot = await this.createFileSnapshot(filePath, timestamp);
            if (snapshot) {
              snapshots.push(snapshot);
            }
          } catch (error) {
            console.warn(`Failed to create snapshot for ${filePath}:`, error);
          }
        }

        // Create snapshot collection
        const collection: SnapshotCollection = {
          id: snapshotId,
          snapshots,
          timestamp,
          messageId,
          description: `Snapshot for message ${messageId}`
        };

        // Store the snapshot collection
        await this.dataStorage.saveSnapshot(collection);
        
        // Cache the collection
        this.snapshotCache.set(snapshotId, collection);

        console.log(`Cursor Companion: Created snapshot ${snapshotId} with ${snapshots.length} files`);
        return collection;

      } catch (error) {
        throw new SnapshotError(`Failed to create snapshot for message ${messageId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  /**
   * Restore files from a snapshot
   */
  async restoreFromSnapshot(snapshotId: string, filePaths?: string[]): Promise<void> {
    return this.withFileLock(`restore-${snapshotId}`, async () => {
      try {
        // Get the snapshot collection
        const collection = await this.getSnapshotCollection(snapshotId);
        if (!collection) {
          throw new SnapshotError(`Snapshot ${snapshotId} not found`);
        }

        // Filter snapshots if specific file paths are requested
        let snapshotsToRestore = collection.snapshots;
        if (filePaths && filePaths.length > 0) {
          snapshotsToRestore = collection.snapshots.filter(snapshot => 
            filePaths.includes(snapshot.filePath)
          );
        }

        // Restore each file
        for (const snapshot of snapshotsToRestore) {
          try {
            await this.restoreFileFromSnapshot(snapshot);
          } catch (error) {
            console.warn(`Failed to restore file ${snapshot.filePath}:`, error);
          }
        }

        console.log(`Cursor Companion: Restored ${snapshotsToRestore.length} files from snapshot ${snapshotId}`);

      } catch (error) {
        throw new SnapshotError(`Failed to restore from snapshot ${snapshotId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  /**
   * Compare two snapshots
   */
  async compareSnapshots(snapshot1Id: string, snapshot2Id: string): Promise<{
    added: string[];
    modified: string[];
    deleted: string[];
  }> {
    try {
      const [collection1, collection2] = await Promise.all([
        this.getSnapshotCollection(snapshot1Id),
        this.getSnapshotCollection(snapshot2Id)
      ]);

      if (!collection1) {
        throw new SnapshotError(`Snapshot ${snapshot1Id} not found`);
      }
      if (!collection2) {
        throw new SnapshotError(`Snapshot ${snapshot2Id} not found`);
      }

      // Create maps for easier comparison
      const files1 = new Map<string, FileSnapshot>();
      const files2 = new Map<string, FileSnapshot>();

      collection1.snapshots.forEach(snapshot => files1.set(snapshot.filePath, snapshot));
      collection2.snapshots.forEach(snapshot => files2.set(snapshot.filePath, snapshot));

      const added: string[] = [];
      const modified: string[] = [];
      const deleted: string[] = [];

      // Find added and modified files
      files2.forEach((snapshot2, filePath) => {
        const snapshot1 = files1.get(filePath);
        
        if (!snapshot1) {
          // File was added
          added.push(filePath);
        } else if (snapshot1.checksum !== snapshot2.checksum) {
          // File was modified
          modified.push(filePath);
        }
      });

      // Find deleted files
      files1.forEach((_, filePath) => {
        if (!files2.has(filePath)) {
          deleted.push(filePath);
        }
      });

      return { added, modified, deleted };

    } catch (error) {
      throw new SnapshotError(`Failed to compare snapshots: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get snapshot statistics
   */
  async getSnapshotStats(snapshotId: string): Promise<{
    fileCount: number;
    totalSize: number;
    languages: string[];
  }> {
    try {
      const collection = await this.getSnapshotCollection(snapshotId);
      if (!collection) {
        throw new SnapshotError(`Snapshot ${snapshotId} not found`);
      }

      let totalSize = 0;
      const languages = new Set<string>();

      for (const snapshot of collection.snapshots) {
        totalSize += snapshot.content.length;
        
        if (snapshot.metadata?.language) {
          languages.add(snapshot.metadata.language);
        } else {
          // Detect language from file extension
          const ext = path.extname(snapshot.filePath).toLowerCase();
          const language = this.detectLanguageFromExtension(ext);
          if (language) {
            languages.add(language);
          }
        }
      }

      return {
        fileCount: collection.snapshots.length,
        totalSize,
        languages: Array.from(languages)
      };

    } catch (error) {
      throw new SnapshotError(`Failed to get snapshot stats: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Private helper methods

  /**
   * Get snapshot collection by ID
   */
  private async getSnapshotCollection(snapshotId: string): Promise<SnapshotCollection | null> {
    // Check cache first
    if (this.snapshotCache.has(snapshotId)) {
      return this.snapshotCache.get(snapshotId)!;
    }

    // Try to find by message ID (since we might have the message ID instead of snapshot ID)
    try {
      const collection = await this.dataStorage.getSnapshot(snapshotId);
      if (collection) {
        this.snapshotCache.set(collection.id, collection);
        return collection;
      }
    } catch (error) {
      console.warn(`Failed to get snapshot collection ${snapshotId}:`, error);
    }

    return null;
  }

  /**
   * Get files to include in snapshot based on options
   */
  private async getFilesToSnapshot(workspaceUri: vscode.Uri, options: SnapshotOptions): Promise<string[]> {
    const files: string[] = [];
    
    // If specific files are requested, use those
    if (options.includeFiles && options.includeFiles.length > 0) {
      return options.includeFiles.map(file => 
        path.isAbsolute(file) ? file : path.join(workspaceUri.fsPath, file)
      );
    }

    // Otherwise, scan the workspace
    await this.scanDirectory(workspaceUri, files, options);
    
    return files;
  }

  /**
   * Recursively scan directory for files to snapshot
   */
  private async scanDirectory(dirUri: vscode.Uri, files: string[], options: SnapshotOptions): Promise<void> {
    try {
      const entries = await vscode.workspace.fs.readDirectory(dirUri);
      
      for (const [name, type] of entries) {
        const itemUri = vscode.Uri.joinPath(dirUri, name);
        const itemPath = itemUri.fsPath;
        
        // Check if file should be excluded
        if (this.shouldExcludeFile(itemPath, options)) {
          continue;
        }
        
        if (type === vscode.FileType.File) {
          // Check file size limit
          if (options.maxFileSize) {
            try {
              const stat = await vscode.workspace.fs.stat(itemUri);
              if (stat.size > options.maxFileSize) {
                continue;
              }
            } catch (error) {
              console.warn(`Failed to get file stats for ${itemPath}:`, error);
              continue;
            }
          }
          
          files.push(itemPath);
        } else if (type === vscode.FileType.Directory) {
          // Recursively scan subdirectory
          await this.scanDirectory(itemUri, files, options);
        }
      }
    } catch (error) {
      console.warn(`Failed to scan directory ${dirUri.fsPath}:`, error);
    }
  }

  /**
   * Check if a file should be excluded from snapshot
   */
  private shouldExcludeFile(filePath: string, options: SnapshotOptions): boolean {
    const fileName = path.basename(filePath);
    const relativePath = path.relative(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', filePath);
    
    // Check exclude files list
    if (options.excludeFiles && options.excludeFiles.includes(relativePath)) {
      return true;
    }
    
    // Check exclude patterns
    const excludePatterns = [
      ...DEFAULT_CONFIG.excludePatterns,
      ...(options.excludePatterns || [])
    ];
    
    for (const pattern of excludePatterns) {
      if (this.matchesPattern(relativePath, pattern)) {
        return true;
      }
    }
    
    // Check binary files
    if (!options.includeBinary) {
      const ext = path.extname(fileName).toLowerCase();
      const binaryExtensions = [
        '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
        '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico',
        '.zip', '.tar', '.gz', '.rar', '.7z',
        '.pdf', '.doc', '.docx', '.xls', '.xlsx'
      ];
      
      if (binaryExtensions.includes(ext)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Check if a path matches a pattern (supports * wildcards)
   */
  private matchesPattern(filePath: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\*\*/g, '.*')  // ** matches any number of directories
      .replace(/\*/g, '[^/]*') // * matches any characters except /
      .replace(/\?/g, '.');    // ? matches any single character
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filePath);
  }

  /**
   * Create a file snapshot with incremental and deduplication features
   */
  private async createFileSnapshot(filePath: string, timestamp: number): Promise<FileSnapshot | null> {
    try {
      const fileUri = vscode.Uri.file(filePath);
      
      // Check if file exists
      let fileExists = true;
      let content = '';
      let stat: vscode.FileStat | null = null;
      
      try {
        stat = await vscode.workspace.fs.stat(fileUri);
        const data = await vscode.workspace.fs.readFile(fileUri);
        content = data.toString();
      } catch (error) {
        fileExists = false;
      }
      
      // Calculate checksum
      const checksum = calculateStrongChecksum(content);
      
      // Check if we already have this content (deduplication)
      const cachedChecksum = this.checksumCache.get(filePath);
      if (cachedChecksum === checksum) {
        // File hasn't changed, create incremental snapshot reference
        return this.createIncrementalSnapshot(filePath, checksum, timestamp, fileExists, stat);
      }
      
      // Update checksum cache
      this.checksumCache.set(filePath, checksum);
      
      // Check if we have this content stored elsewhere (deduplication)
      const existingPath = this.deduplicationMap.get(checksum);
      if (existingPath && await this.fileExists(existingPath)) {
        // Content already exists, create reference
        return this.createDeduplicatedSnapshot(filePath, checksum, timestamp, fileExists, stat, existingPath);
      }
      
      // Store content for deduplication
      const deduplicatedPath = await this.storeDeduplicatedContent(checksum, content);
      this.deduplicationMap.set(checksum, deduplicatedPath);
      
      // Create full snapshot
      const snapshot: FileSnapshot = {
        filePath,
        content,
        timestamp,
        checksum,
        metadata: {
          size: content.length,
          encoding: 'utf8',
          language: this.detectLanguageFromExtension(path.extname(filePath)),
          existed: fileExists
        }
      };
      
      return snapshot;
      
    } catch (error) {
      console.warn(`Failed to create file snapshot for ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Create an incremental snapshot (reference to previous snapshot)
   */
  private createIncrementalSnapshot(
    filePath: string, 
    checksum: string, 
    timestamp: number, 
    existed: boolean,
    stat: vscode.FileStat | null
  ): FileSnapshot {
    const metadata: ExtendedSnapshotMetadata = {
      size: stat?.size || 0,
      encoding: 'utf8',
      language: this.detectLanguageFromExtension(path.extname(filePath)),
      existed,
      isIncremental: true
    };

    return {
      filePath,
      content: '', // Empty content for incremental snapshot
      timestamp,
      checksum,
      metadata: metadata as any // Type assertion to work with existing interface
    };
  }

  /**
   * Create a deduplicated snapshot (reference to existing content)
   */
  private createDeduplicatedSnapshot(
    filePath: string, 
    checksum: string, 
    timestamp: number, 
    existed: boolean,
    stat: vscode.FileStat | null,
    referencePath: string
  ): FileSnapshot {
    const metadata: ExtendedSnapshotMetadata = {
      size: stat?.size || 0,
      encoding: 'utf8',
      language: this.detectLanguageFromExtension(path.extname(filePath)),
      existed,
      isDeduplicated: true,
      referencePath
    };

    return {
      filePath,
      content: '', // Empty content for deduplicated snapshot
      timestamp,
      checksum,
      metadata: metadata as any // Type assertion to work with existing interface
    };
  }

  /**
   * Store content for deduplication
   */
  private async storeDeduplicatedContent(checksum: string, content: string): Promise<string> {
    const fileName = `${checksum}.txt`;
    const filePath = path.join(this.deduplicationDir, fileName);
    
    try {
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(filePath),
        Buffer.from(content, 'utf8')
      );
      
      return filePath;
    } catch (error) {
      throw new SnapshotError(`Failed to store deduplicated content: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Restore a file from snapshot
   */
  private async restoreFileFromSnapshot(snapshot: FileSnapshot): Promise<void> {
    try {
      let content = snapshot.content;
      const extendedMetadata = snapshot.metadata as ExtendedSnapshotMetadata;
      
      // Handle incremental snapshots
      if (extendedMetadata?.isIncremental) {
        // For incremental snapshots, we need to get the content from the previous snapshot
        const existingContent = await this.getContentFromChecksum(snapshot.checksum);
        if (existingContent !== null) {
          content = existingContent;
        } else {
          console.warn(`Cannot restore incremental snapshot for ${snapshot.filePath}: content not found`);
          return;
        }
      }
      
      // Handle deduplicated snapshots
      if (extendedMetadata?.isDeduplicated && extendedMetadata?.referencePath) {
        const referencedContent = await this.readDeduplicatedContent(extendedMetadata.referencePath);
        if (referencedContent !== null) {
          content = referencedContent;
        } else {
          console.warn(`Cannot restore deduplicated snapshot for ${snapshot.filePath}: referenced content not found`);
          return;
        }
      }
      
      // Check if file should be deleted (didn't exist in snapshot)
      if (!extendedMetadata?.existed) {
        try {
          await vscode.workspace.fs.delete(vscode.Uri.file(snapshot.filePath));
        } catch (error) {
          // File might not exist, which is fine
        }
        return;
      }
      
      // Restore file content
      const fileUri = vscode.Uri.file(snapshot.filePath);
      
      // Ensure directory exists
      const dirPath = path.dirname(snapshot.filePath);
      await this.ensureDirectoryExists(dirPath);
      
      // Write file content
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));
      
    } catch (error) {
      throw new SnapshotError(`Failed to restore file ${snapshot.filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get content from checksum (for incremental snapshots)
   */
  private async getContentFromChecksum(checksum: string): Promise<string | null> {
    const referencePath = this.deduplicationMap.get(checksum);
    if (referencePath) {
      return this.readDeduplicatedContent(referencePath);
    }
    return null;
  }

  /**
   * Read deduplicated content from file
   */
  private async readDeduplicatedContent(filePath: string): Promise<string | null> {
    try {
      const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      return data.toString();
    } catch (error) {
      console.warn(`Failed to read deduplicated content from ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Load deduplication map from storage
   */
  private async loadDeduplicationMap(): Promise<void> {
    try {
      const mapPath = path.join(this.snapshotsDir, 'deduplication-map.json');
      
      try {
        const data = await vscode.workspace.fs.readFile(vscode.Uri.file(mapPath));
        const mapData = JSON.parse(data.toString());
        
        for (const [checksum, filePath] of Object.entries(mapData)) {
          if (typeof filePath === 'string') {
            this.deduplicationMap.set(checksum, filePath);
          }
        }
        
        console.log(`Cursor Companion: Loaded ${this.deduplicationMap.size} deduplication entries`);
      } catch (error) {
        // File might not exist yet, which is fine
        console.log('Cursor Companion: No existing deduplication map found, starting fresh');
      }
    } catch (error) {
      console.warn('Failed to load deduplication map:', error);
    }
  }

  /**
   * Save deduplication map to storage
   */
  private async saveDeduplicationMap(): Promise<void> {
    try {
      const mapPath = path.join(this.snapshotsDir, 'deduplication-map.json');
      const mapData: Record<string, string> = {};
      
      this.deduplicationMap.forEach((filePath, checksum) => {
        mapData[checksum] = filePath;
      });
      
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(mapPath),
        Buffer.from(JSON.stringify(mapData, null, 2), 'utf8')
      );
    } catch (error) {
      console.warn('Failed to save deduplication map:', error);
    }
  }

  /**
   * Detect programming language from file extension
   */
  private detectLanguageFromExtension(extension: string): string | undefined {
    const languageMap: Record<string, string> = {
      '.js': 'javascript',
      '.ts': 'typescript',
      '.jsx': 'javascriptreact',
      '.tsx': 'typescriptreact',
      '.py': 'python',
      '.java': 'java',
      '.c': 'c',
      '.cpp': 'cpp',
      '.h': 'c',
      '.hpp': 'cpp',
      '.cs': 'csharp',
      '.php': 'php',
      '.rb': 'ruby',
      '.go': 'go',
      '.rs': 'rust',
      '.swift': 'swift',
      '.kt': 'kotlin',
      '.scala': 'scala',
      '.html': 'html',
      '.css': 'css',
      '.scss': 'scss',
      '.sass': 'sass',
      '.less': 'less',
      '.json': 'json',
      '.xml': 'xml',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.md': 'markdown',
      '.sql': 'sql',
      '.sh': 'shellscript',
      '.bash': 'shellscript',
      '.zsh': 'shellscript',
      '.fish': 'shellscript'
    };
    
    return languageMap[extension.toLowerCase()];
  }

  /**
   * Check if a file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensure a directory exists
   */
  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(dirPath));
    } catch {
      // Directory doesn't exist, create it
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
    }
  }

  /**
   * Execute a function with file locking
   */
  private async withFileLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
    // Wait for any existing lock
    while (this.fileLocks.has(lockKey)) {
      await this.fileLocks.get(lockKey);
    }
    
    // Create new lock
    const lockPromise = fn();
    this.fileLocks.set(lockKey, lockPromise.then(() => {}, () => {}));
    
    try {
      const result = await lockPromise;
      return result;
    } finally {
      // Remove lock
      this.fileLocks.delete(lockKey);
      
      // Save deduplication map periodically
      await this.saveDeduplicationMap();
    }
  }

  /**
   * Clean up old snapshots and deduplicated content
   */
  async cleanup(olderThanDays: number): Promise<void> {
    const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    
    try {
      // Clean up old deduplicated files that are no longer referenced
      const referencedFiles = new Set(this.deduplicationMap.values());
      
      try {
        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(this.deduplicationDir));
        
        for (const [fileName] of entries) {
          const filePath = path.join(this.deduplicationDir, fileName);
          
          if (!referencedFiles.has(filePath)) {
            try {
              const stat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
              if (stat.mtime < cutoffTime) {
                await vscode.workspace.fs.delete(vscode.Uri.file(filePath));
                console.log(`Cleaned up old deduplicated file: ${fileName}`);
              }
            } catch (error) {
              console.warn(`Failed to clean up file ${fileName}:`, error);
            }
          }
        }
      } catch (error) {
        console.warn('Failed to clean up deduplicated files:', error);
      }
      
      // Clear old entries from caches
      this.snapshotCache.clear();
      
      // Save updated deduplication map
      await this.saveDeduplicationMap();
      
    } catch (error) {
      console.warn('Failed to cleanup snapshots:', error);
    }
  }

  /**
   * Get snapshot manager statistics
   */
  async getStats(): Promise<{
    totalSnapshots: number;
    deduplicationEntries: number;
    cacheSize: number;
  }> {
    return {
      totalSnapshots: this.snapshotCache.size,
      deduplicationEntries: this.deduplicationMap.size,
      cacheSize: this.checksumCache.size
    };
  }
}