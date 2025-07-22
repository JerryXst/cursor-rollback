import * as vscode from 'vscode';
import * as path from 'path';
import { IRollbackManager, RollbackResult, IDataStorage } from './interfaces';

/**
 * Implementation of rollback functionality for Cursor Companion
 */
export class RollbackManager implements IRollbackManager {
  private readonly backupsDir: string;

  constructor(
    private context: vscode.ExtensionContext,
    private dataStorage: IDataStorage
  ) {
    this.backupsDir = path.join(context.globalStorageUri.fsPath, 'cursor-companion', 'backups');
  }

  async rollbackToMessage(messageId: string): Promise<RollbackResult> {
    const startTime = Date.now();
    
    try {
      // Get the message and its snapshot
      const message = await this.dataStorage.getMessage(messageId);
      if (!message) {
        return {
          success: false,
          modifiedFiles: [],
          error: `Message ${messageId} not found`
        };
      }

      const snapshot = await this.dataStorage.getSnapshot(messageId);
      if (!snapshot) {
        return {
          success: false,
          modifiedFiles: [],
          error: `No snapshot found for message ${messageId}`
        };
      }

      // Create backup before rollback
      const backupId = await this.createBackup(`Pre-rollback backup for message ${messageId}`);

      // Restore files from snapshot
      const modifiedFiles: string[] = [];
      
      for (const fileSnapshot of snapshot.snapshots) {
        try {
          const fileUri = vscode.Uri.file(fileSnapshot.filePath);
          
          // Check if file content is different
          let currentContent = '';
          try {
            const currentData = await vscode.workspace.fs.readFile(fileUri);
            currentContent = currentData.toString();
          } catch (error) {
            // File might not exist, which is fine
          }

          if (currentContent !== fileSnapshot.content) {
            // Restore the file content
            await vscode.workspace.fs.writeFile(
              fileUri,
              Buffer.from(fileSnapshot.content, 'utf8')
            );
            modifiedFiles.push(fileSnapshot.filePath);
          }
        } catch (error) {
          console.warn(`Failed to restore file ${fileSnapshot.filePath}:`, error);
        }
      }

      // TODO: Reset Cursor conversation context
      // This would require integration with Cursor's API
      const conversationReset = await this.resetConversationContext(message.conversationId);

      const duration = Date.now() - startTime;

      return {
        success: true,
        modifiedFiles,
        backupId,
        details: {
          filesRolledBack: modifiedFiles.length,
          conversationReset,
          duration
        }
      };

    } catch (error) {
      return {
        success: false,
        modifiedFiles: [],
        error: error instanceof Error ? error.message : 'Unknown rollback error'
      };
    }
  }

  async createBackup(description?: string): Promise<string> {
    const backupId = `backup-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const backupDir = path.join(this.backupsDir, backupId);

    try {
      // Create backup directory
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(backupDir));

      // Get all workspace files
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        throw new Error('No workspace folder found');
      }

      // Create backup manifest
      const manifest = {
        id: backupId,
        timestamp: Date.now(),
        description: description || 'Manual backup',
        workspaceRoot: workspaceFolder.uri.fsPath,
        files: [] as string[]
      };

      // Backup workspace files (excluding common ignore patterns)
      await this.backupDirectory(workspaceFolder.uri, backupDir, manifest.files);

      // Save manifest
      const manifestPath = path.join(backupDir, 'manifest.json');
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(manifestPath),
        Buffer.from(JSON.stringify(manifest, null, 2), 'utf8')
      );

      return backupId;

    } catch (error) {
      throw new Error(`Failed to create backup: ${error}`);
    }
  }

  async restoreBackup(backupId: string): Promise<void> {
    const backupDir = path.join(this.backupsDir, backupId);
    const manifestPath = path.join(backupDir, 'manifest.json');

    try {
      // Read backup manifest
      const manifestData = await vscode.workspace.fs.readFile(vscode.Uri.file(manifestPath));
      const manifest = JSON.parse(manifestData.toString());

      // Restore files
      for (const relativePath of manifest.files) {
        const backupFilePath = path.join(backupDir, relativePath);
        const targetFilePath = path.join(manifest.workspaceRoot, relativePath);

        try {
          const fileData = await vscode.workspace.fs.readFile(vscode.Uri.file(backupFilePath));
          await vscode.workspace.fs.writeFile(vscode.Uri.file(targetFilePath), fileData);
        } catch (error) {
          console.warn(`Failed to restore file ${relativePath}:`, error);
        }
      }

    } catch (error) {
      throw new Error(`Failed to restore backup ${backupId}: ${error}`);
    }
  }

  async listBackups(): Promise<Array<{ id: string; timestamp: number; description?: string }>> {
    try {
      const backups: Array<{ id: string; timestamp: number; description?: string }> = [];
      
      try {
        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(this.backupsDir));
        
        for (const [dirName] of entries) {
          try {
            const manifestPath = path.join(this.backupsDir, dirName, 'manifest.json');
            const manifestData = await vscode.workspace.fs.readFile(vscode.Uri.file(manifestPath));
            const manifest = JSON.parse(manifestData.toString());
            
            backups.push({
              id: manifest.id,
              timestamp: manifest.timestamp,
              description: manifest.description
            });
          } catch (error) {
            console.warn(`Failed to read backup manifest for ${dirName}:`, error);
          }
        }
      } catch (error) {
        // Backups directory might not exist yet
      }

      return backups.sort((a, b) => b.timestamp - a.timestamp);

    } catch (error) {
      throw new Error(`Failed to list backups: ${error}`);
    }
  }

  async deleteBackup(backupId: string): Promise<void> {
    const backupDir = path.join(this.backupsDir, backupId);
    
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(backupDir), { recursive: true });
    } catch (error) {
      throw new Error(`Failed to delete backup ${backupId}: ${error}`);
    }
  }

  async canRollback(messageId: string): Promise<boolean> {
    try {
      const message = await this.dataStorage.getMessage(messageId);
      if (!message) {
        return false;
      }

      const snapshot = await this.dataStorage.getSnapshot(messageId);
      return snapshot !== null && snapshot.snapshots.length > 0;
    } catch (error) {
      return false;
    }
  }

  private async backupDirectory(sourceUri: vscode.Uri, backupDir: string, fileList: string[]): Promise<void> {
    try {
      const entries = await vscode.workspace.fs.readDirectory(sourceUri);
      
      for (const [name, type] of entries) {
        // Skip common ignore patterns
        if (this.shouldIgnoreFile(name)) {
          continue;
        }

        const sourceItemUri = vscode.Uri.joinPath(sourceUri, name);
        
        if (type === vscode.FileType.File) {
          try {
            const fileData = await vscode.workspace.fs.readFile(sourceItemUri);
            const relativePath = path.relative(
              vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
              sourceItemUri.fsPath
            );
            
            const backupFilePath = path.join(backupDir, relativePath);
            const backupFileDir = path.dirname(backupFilePath);
            
            // Ensure directory exists
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(backupFileDir));
            
            // Copy file
            await vscode.workspace.fs.writeFile(vscode.Uri.file(backupFilePath), fileData);
            fileList.push(relativePath);
            
          } catch (error) {
            console.warn(`Failed to backup file ${sourceItemUri.fsPath}:`, error);
          }
        } else if (type === vscode.FileType.Directory) {
          // Recursively backup subdirectory
          await this.backupDirectory(sourceItemUri, backupDir, fileList);
        }
      }
    } catch (error) {
      console.warn(`Failed to backup directory ${sourceUri.fsPath}:`, error);
    }
  }

  private shouldIgnoreFile(name: string): boolean {
    const ignorePatterns = [
      'node_modules',
      '.git',
      '.vscode',
      'out',
      'dist',
      'build',
      '.DS_Store',
      'Thumbs.db',
      '*.log'
    ];

    return ignorePatterns.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        return regex.test(name);
      }
      return name === pattern;
    });
  }

  private async resetConversationContext(conversationId: string): Promise<boolean> {
    try {
      // TODO: Implement Cursor conversation context reset
      // This would require integration with Cursor's API
      // For now, we'll return false to indicate it's not implemented
      console.log(`TODO: Reset conversation context for ${conversationId}`);
      return false;
    } catch (error) {
      console.warn(`Failed to reset conversation context for ${conversationId}:`, error);
      return false;
    }
  }
}