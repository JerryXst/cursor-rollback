import * as vscode from 'vscode';
import { IDataStorage } from '../services/interfaces';

/**
 * Provides UI for rollback confirmation and progress feedback
 */
export class RollbackConfirmationProvider {
  constructor(private dataStorage: IDataStorage) {}

  /**
   * Show rollback confirmation dialog with detailed information
   */
  async showRollbackConfirmation(messageId: string): Promise<RollbackConfirmationResult> {
    const message = await this.dataStorage.getMessage(messageId);
    if (!message) {
      vscode.window.showErrorMessage('Message not found');
      return { confirmed: false };
    }

    const conversation = await this.dataStorage.getConversation(message.conversationId);
    if (!conversation) {
      vscode.window.showErrorMessage('Conversation not found');
      return { confirmed: false };
    }

    // Get rollback impact information
    const impact = await this.calculateRollbackImpact(messageId);
    
    // Create confirmation message
    const confirmationMessage = this.buildConfirmationMessage(message, conversation, impact);
    
    // Show confirmation dialog
    const options = ['Rollback', 'Cancel'];
    const selection = await vscode.window.showWarningMessage(
      confirmationMessage,
      { modal: true },
      ...options
    );

    if (selection === 'Rollback') {
      // Show additional options
      const advancedOptions = await this.showAdvancedOptions();
      return {
        confirmed: true,
        options: advancedOptions
      };
    }

    return { confirmed: false };
  }

  /**
   * Show rollback progress with detailed feedback
   */
  async showRollbackProgress<T>(
    operation: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<T>,
    title: string = 'Rolling back changes...'
  ): Promise<T> {
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: false
      },
      async (progress) => {
        progress.report({ message: 'Preparing rollback...' });
        return await operation(progress);
      }
    );
  }

  /**
   * Show rollback result notification with summary
   */
  async showRollbackResult(result: RollbackResult): Promise<void> {
    if (result.success) {
      const message = this.buildSuccessMessage(result);
      const action = await vscode.window.showInformationMessage(
        message,
        'View Changes', 'Dismiss'
      );

      if (action === 'View Changes') {
        await this.showRollbackSummary(result);
      }
    } else {
      const message = this.buildErrorMessage(result);
      const action = await vscode.window.showErrorMessage(
        message,
        'View Details', 'Retry', 'Dismiss'
      );

      if (action === 'View Details') {
        await this.showErrorDetails(result);
      } else if (action === 'Retry') {
        // Emit retry event - this would be handled by the calling code
        vscode.commands.executeCommand('cursor-companion.retryRollback');
      }
    }
  }

  /**
   * Show detailed rollback summary in a new document
   */
  private async showRollbackSummary(result: RollbackResult): Promise<void> {
    const summary = this.generateRollbackSummary(result);
    
    const document = await vscode.workspace.openTextDocument({
      content: summary,
      language: 'markdown'
    });

    await vscode.window.showTextDocument(document);
  }

  /**
   * Show error details in a new document
   */
  private async showErrorDetails(result: RollbackResult): Promise<void> {
    const details = this.generateErrorDetails(result);
    
    const document = await vscode.workspace.openTextDocument({
      content: details,
      language: 'plaintext'
    });

    await vscode.window.showTextDocument(document);
  }

  /**
   * Calculate the impact of rolling back to a specific message
   */
  private async calculateRollbackImpact(messageId: string): Promise<RollbackImpact> {
    const message = await this.dataStorage.getMessage(messageId);
    if (!message) {
      return { filesAffected: 0, messagesLost: 0, codeChanges: 0 };
    }

    // Get all messages after this one in the conversation
    const allMessages = await this.dataStorage.getMessages(message.conversationId);
    const messageIndex = allMessages.findIndex(m => m.id === messageId);
    
    if (messageIndex === -1) {
      return { filesAffected: 0, messagesLost: 0, codeChanges: 0 };
    }

    const messagesAfter = allMessages.slice(messageIndex + 1);
    const filesAffected = new Set<string>();
    let codeChanges = 0;

    // Calculate impact from messages that will be lost
    for (const msg of messagesAfter) {
      for (const change of msg.codeChanges) {
        filesAffected.add(change.filePath);
        codeChanges++;
      }
    }

    return {
      filesAffected: filesAffected.size,
      messagesLost: messagesAfter.length,
      codeChanges,
      affectedFiles: Array.from(filesAffected)
    };
  }

  /**
   * Build confirmation message with rollback details
   */
  private buildConfirmationMessage(
    message: any,
    conversation: any,
    impact: RollbackImpact
  ): string {
    const messagePreview = message.content.length > 100 
      ? message.content.substring(0, 100) + '...'
      : message.content;

    const lines = [
      `Are you sure you want to rollback to this message?`,
      ``,
      `**Message:** ${messagePreview}`,
      `**Conversation:** ${conversation.title}`,
      `**Timestamp:** ${new Date(message.timestamp).toLocaleString()}`,
      ``,
      `**Impact:**`,
      `• ${impact.messagesLost} messages will be lost`,
      `• ${impact.filesAffected} files will be affected`,
      `• ${impact.codeChanges} code changes will be reverted`,
      ``,
      `This action cannot be undone without a backup.`
    ];

    return lines.join('\n');
  }

  /**
   * Show advanced rollback options
   */
  private async showAdvancedOptions(): Promise<RollbackOptions> {
    const options: vscode.QuickPickItem[] = [
      {
        label: '$(file-code) Rollback Code Only',
        description: 'Only revert file changes, keep conversation context',
        detail: 'Recommended for most cases'
      },
      {
        label: '$(comment-discussion) Rollback Code and Context',
        description: 'Revert files and reset conversation context',
        detail: 'Full rollback including chat history'
      },
      {
        label: '$(archive) Create Backup First',
        description: 'Create a backup before rolling back',
        detail: 'Safer option, allows recovery if needed'
      }
    ];

    const selected = await vscode.window.showQuickPick(options, {
      placeHolder: 'Choose rollback options',
      canPickMany: true
    });

    const rollbackCode = selected?.some(item => item.label.includes('Code Only') || item.label.includes('Code and Context')) ?? true;
    const rollbackContext = selected?.some(item => item.label.includes('Code and Context')) ?? false;
    const createBackup = selected?.some(item => item.label.includes('Create Backup')) ?? true;

    return {
      rollbackCode,
      rollbackContext,
      createBackup
    };
  }

  /**
   * Build success message for rollback completion
   */
  private buildSuccessMessage(result: RollbackResult): string {
    const details = result.details;
    if (!details) {
      return 'Rollback completed successfully';
    }

    const lines = [
      'Rollback completed successfully!',
      `• ${details.filesRolledBack} files restored`,
      `• Conversation context ${details.conversationReset ? 'reset' : 'preserved'}`,
      `• Completed in ${details.duration}ms`
    ];

    if (result.backupId) {
      lines.push(`• Backup created: ${result.backupId}`);
    }

    return lines.join('\n');
  }

  /**
   * Build error message for rollback failure
   */
  private buildErrorMessage(result: RollbackResult): string {
    const lines = [
      'Rollback failed!',
      `Error: ${result.error}`,
      ``
    ];

    if (result.modifiedFiles.length > 0) {
      lines.push(`Files that were partially modified:`);
      result.modifiedFiles.forEach(file => {
        lines.push(`• ${file}`);
      });
    }

    if (result.backupId) {
      lines.push(``, `Backup available: ${result.backupId}`);
    }

    return lines.join('\n');
  }

  /**
   * Generate detailed rollback summary
   */
  private generateRollbackSummary(result: RollbackResult): string {
    const timestamp = new Date().toLocaleString();
    const lines = [
      `# Rollback Summary`,
      ``,
      `**Date:** ${timestamp}`,
      `**Status:** ${result.success ? 'Success' : 'Failed'}`,
      ``,
      `## Files Modified`,
      ``
    ];

    if (result.modifiedFiles.length === 0) {
      lines.push('No files were modified.');
    } else {
      result.modifiedFiles.forEach(file => {
        lines.push(`- ${file}`);
      });
    }

    if (result.details) {
      lines.push(
        ``,
        `## Details`,
        ``,
        `- Files rolled back: ${result.details.filesRolledBack}`,
        `- Conversation reset: ${result.details.conversationReset ? 'Yes' : 'No'}`,
        `- Duration: ${result.details.duration}ms`
      );
    }

    if (result.backupId) {
      lines.push(
        ``,
        `## Backup`,
        ``,
        `A backup was created with ID: \`${result.backupId}\``,
        `You can restore from this backup if needed.`
      );
    }

    return lines.join('\n');
  }

  /**
   * Generate error details document
   */
  private generateErrorDetails(result: RollbackResult): string {
    const timestamp = new Date().toLocaleString();
    const lines = [
      `Rollback Error Details`,
      `========================`,
      ``,
      `Date: ${timestamp}`,
      `Error: ${result.error}`,
      ``,
      `Files that were being processed:`,
    ];

    if (result.modifiedFiles.length === 0) {
      lines.push('  (none)');
    } else {
      result.modifiedFiles.forEach(file => {
        lines.push(`  - ${file}`);
      });
    }

    if (result.backupId) {
      lines.push(
        ``,
        `Backup Information:`,
        `  ID: ${result.backupId}`,
        `  You can restore from this backup using the command palette.`
      );
    }

    lines.push(
      ``,
      `Troubleshooting:`,
      `  1. Check file permissions`,
      `  2. Ensure files are not locked by other processes`,
      `  3. Try rolling back to a different message`,
      `  4. Contact support if the issue persists`
    );

    return lines.join('\n');
  }
}

/**
 * Result of rollback confirmation dialog
 */
export interface RollbackConfirmationResult {
  confirmed: boolean;
  options?: RollbackOptions;
}

/**
 * Options for rollback operation
 */
export interface RollbackOptions {
  rollbackCode: boolean;
  rollbackContext: boolean;
  createBackup: boolean;
}

/**
 * Information about rollback impact
 */
export interface RollbackImpact {
  filesAffected: number;
  messagesLost: number;
  codeChanges: number;
  affectedFiles?: string[];
}

/**
 * Result of rollback operation (imported from interfaces)
 */
interface RollbackResult {
  success: boolean;
  modifiedFiles: string[];
  backupId?: string;
  error?: string;
  details?: {
    filesRolledBack: number;
    conversationReset: boolean;
    duration: number;
  };
}