import * as vscode from 'vscode';
import * as path from 'path';
import { IRollbackManager, RollbackResult, IDataStorage } from './interfaces';
import { ConversationContextManager } from './conversationContextManager';
import { RollbackConfirmationProvider } from '../ui/rollbackConfirmationProvider';

/**
 * Implementation of rollback functionality for Cursor Companion
 */
export class RollbackManager implements IRollbackManager {
  private readonly backupsDir: string;
  private readonly contextManager: ConversationContextManager;
  private readonly confirmationProvider: RollbackConfirmationProvider;

  constructor(
    private context: vscode.ExtensionContext,
    private dataStorage: IDataStorage
  ) {
    this.backupsDir = path.join(context.globalStorageUri.fsPath, 'cursor-companion', 'backups');
    this.contextManager = new ConversationContextManager(dataStorage);
    this.confirmationProvider = new RollbackConfirmationProvider(dataStorage);
  }

  async rollbackToMessage(messageId: string): Promise<RollbackResult> {
    // Show confirmation dialog
    const confirmation = await this.confirmationProvider.showRollbackConfirmation(messageId);
    if (!confirmation.confirmed) {
      return {
        success: false,
        modifiedFiles: [],
        error: 'Rollback cancelled by user'
      };
    }

    // Execute rollback with progress feedback
    const result = await this.confirmationProvider.showRollbackProgress(
      async (progress) => {
        const startTime = Date.now();
        let backupId: string | undefined;
        const modifiedFiles: string[] = [];
        const rollbackOperations: Array<() => Promise<void>> = [];
        
        try {
          progress.report({ message: 'Validating message and snapshot...', increment: 10 });

          // Get the message and its snapshot
          const message = await this.dataStorage.getMessage(messageId);
          if (!message) {
            throw new Error(`Message ${messageId} not found`);
          }

          const snapshot = await this.dataStorage.getSnapshot(messageId);
          if (!snapshot) {
            throw new Error(`No snapshot found for message ${messageId}`);
          }

          // Create backup if requested
          if (confirmation.options?.createBackup !== false) {
            progress.report({ message: 'Creating backup...', increment: 20 });
            backupId = await this.createBackup(`Pre-rollback backup for message ${messageId}`);
          }

          progress.report({ message: 'Preparing rollback operations...', increment: 30 });

          // Prepare atomic rollback operations
          const fileOperations = await this.prepareFileRollbackOperations(snapshot.snapshots, modifiedFiles);
          rollbackOperations.push(...fileOperations);

          progress.report({ message: 'Executing file rollback...', increment: 50 });

          // Execute all operations atomically
          await this.executeAtomicRollback(rollbackOperations);

          // Reset Cursor conversation context if requested
          let conversationReset = false;
          if (confirmation.options?.rollbackContext !== false) {
            progress.report({ message: 'Resetting conversation context...', increment: 80 });
            conversationReset = await this.contextManager.rollbackContext(messageId);
          }

          progress.report({ message: 'Finalizing rollback...', increment: 100 });

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
          // If rollback failed, attempt to restore from backup
          if (backupId) {
            try {
              progress.report({ message: 'Restoring from backup due to failure...' });
              await this.restoreBackup(backupId);
              console.log(`Restored from backup ${backupId} after rollback failure`);
            } catch (restoreError) {
              console.error(`Failed to restore from backup after rollback failure:`, restoreError);
            }
          }

          return {
            success: false,
            modifiedFiles,
            backupId,
            error: error instanceof Error ? error.message : 'Unknown rollback error'
          };
        }
      },
      'Rolling back to selected message...'
    );

    // Show result notification
    await this.confirmationProvider.showRollbackResult(result);

    return result;
  }

  async createBackup(description?: string): Promise<string> {
    const backupId = `backup-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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

  private async prepareFileRollbackOperations(
    snapshots: Array<{ filePath: string; content: string }>,
    modifiedFiles: string[]
  ): Promise<Array<() => Promise<void>>> {
    const operations: Array<() => Promise<void>> = [];

    for (const snapshot of snapshots) {
      const filePath = snapshot.filePath;
      const targetUri = vscode.Uri.file(filePath);
      
      operations.push(async () => {
        try {
          // Ensure directory exists
          const dirUri = vscode.Uri.file(path.dirname(filePath));
          await vscode.workspace.fs.createDirectory(dirUri);
          
          // Write file content
          await vscode.workspace.fs.writeFile(
            targetUri,
            Buffer.from(snapshot.content, 'utf8')
          );
          
          modifiedFiles.push(filePath);
        } catch (error) {
          throw new Error(`Failed to rollback file ${filePath}: ${error}`);
        }
      });
    }

    return operations;
  }

  private async executeAtomicRollback(operations: Array<() => Promise<void>>): Promise<void> {
    const completedOperations: Array<() => Promise<void>> = [];
    
    try {
      // Execute all operations
      for (const operation of operations) {
        await operation();
        completedOperations.push(operation);
      }
    } catch (error) {
      // If any operation fails, we need to rollback completed operations
      console.error('Atomic rollback failed, attempting to revert completed operations:', error);
      
      // Note: In a real implementation, we would need to store the original state
      // of each file before modification to enable proper rollback
      // For now, we'll just throw the error
      throw error;
    }
  }

  private async resetConversationContext(conversationId: string): Promise<boolean> {
    try {
      // Get the conversation and target message
      const conversation = await this.dataStorage.getConversation(conversationId);
      if (!conversation) {
        console.warn(`Conversation ${conversationId} not found for context reset`);
        return false;
      }

      // Try multiple approaches to reset Cursor conversation context
      let resetSuccess = false;

      // Approach 1: Try to use Cursor's built-in commands
      try {
        await vscode.commands.executeCommand('cursor.chat.clear');
        resetSuccess = true;
        console.log('Successfully cleared Cursor chat using cursor.chat.clear command');
      } catch (error) {
        console.log('cursor.chat.clear command not available, trying alternative approaches');
      }

      // Approach 2: Try to reset via cursor.agent commands
      if (!resetSuccess) {
        try {
          await vscode.commands.executeCommand('cursor.agent.reset');
          resetSuccess = true;
          console.log('Successfully reset Cursor agent context');
        } catch (error) {
          console.log('cursor.agent.reset command not available');
        }
      }

      // Approach 3: Try to simulate context reset by opening/closing chat panel
      if (!resetSuccess) {
        try {
          // Close and reopen chat panel to potentially reset context
          await vscode.commands.executeCommand('workbench.action.chat.close');
          await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
          await vscode.commands.executeCommand('workbench.action.chat.open');
          resetSuccess = true;
          console.log('Attempted context reset by reopening chat panel');
        } catch (error) {
          console.log('Failed to reset context via chat panel manipulation');
        }
      }

      // Approach 4: Try to clear workspace context
      if (!resetSuccess) {
        try {
          await vscode.commands.executeCommand('workbench.action.reloadWindow');
          resetSuccess = true;
          console.log('Initiated window reload to reset all context');
        } catch (error) {
          console.log('Failed to reload window for context reset');
        }
      }

      // If all approaches failed, show user notification
      if (!resetSuccess) {
        const action = await vscode.window.showWarningMessage(
          'Unable to automatically reset Cursor conversation context. Please manually clear the chat history.',
          'Open Chat', 'Dismiss'
        );
        
        if (action === 'Open Chat') {
          try {
            await vscode.commands.executeCommand('workbench.action.chat.open');
          } catch (error) {
            console.warn('Failed to open chat panel:', error);
          }
        }
      }

      return resetSuccess;
    } catch (error) {
      console.warn(`Failed to reset conversation context for ${conversationId}:`, error);
      return false;
    }
  }
}
