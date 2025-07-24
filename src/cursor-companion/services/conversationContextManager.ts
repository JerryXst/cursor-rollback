import * as vscode from 'vscode';
import { IDataStorage } from './interfaces';

/**
 * Manages Cursor conversation context and provides rollback functionality
 */
export class ConversationContextManager {
  private readonly contextHistory: Map<string, ConversationContext> = new Map();
  private currentContext: ConversationContext | null = null;

  constructor(private dataStorage: IDataStorage) {}

  /**
   * Capture current conversation context
   */
  async captureContext(conversationId: string, messageId: string): Promise<ConversationContext> {
    const context: ConversationContext = {
      conversationId,
      messageId,
      timestamp: Date.now(),
      chatHistory: await this.extractChatHistory(),
      workspaceState: await this.captureWorkspaceState(),
      activeFiles: this.getActiveFiles(),
      cursorSelection: this.getCursorSelection()
    };

    this.contextHistory.set(messageId, context);
    this.currentContext = context;
    
    return context;
  }

  /**
   * Rollback conversation context to a specific message point
   */
  async rollbackContext(messageId: string): Promise<boolean> {
    const targetContext = this.contextHistory.get(messageId);
    if (!targetContext) {
      console.warn(`No context found for message ${messageId}`);
      return false;
    }

    try {
      // Step 1: Clear current chat context
      await this.clearCurrentChatContext();

      // Step 2: Restore workspace state
      await this.restoreWorkspaceState(targetContext.workspaceState);

      // Step 3: Restore active files and selections
      await this.restoreActiveFiles(targetContext.activeFiles);
      await this.restoreCursorSelection(targetContext.cursorSelection);

      // Step 4: Attempt to restore chat history (limited capability)
      await this.restoreChatHistory(targetContext.chatHistory);

      this.currentContext = targetContext;
      return true;
    } catch (error) {
      console.error(`Failed to rollback context to message ${messageId}:`, error);
      return false;
    }
  }

  /**
   * Get conversation context truncated to a specific message
   */
  async getTruncatedContext(messageId: string): Promise<ConversationContext | null> {
    const message = await this.dataStorage.getMessage(messageId);
    if (!message) {
      return null;
    }

    // Get all messages up to the target message
    const conversation = await this.dataStorage.getConversation(message.conversationId);
    if (!conversation) {
      return null;
    }

    const messages = await this.dataStorage.getMessages(message.conversationId);
    const messageIndex = messages.findIndex(m => m.id === messageId);
    
    if (messageIndex === -1) {
      return null;
    }

    const truncatedMessages = messages.slice(0, messageIndex + 1);
    
    return {
      conversationId: message.conversationId,
      messageId,
      timestamp: message.timestamp,
      chatHistory: truncatedMessages.map(m => ({
        role: m.sender === 'user' ? 'user' : 'assistant',
        content: m.content,
        timestamp: m.timestamp
      })),
      workspaceState: {
        activeDocument: null,
        visibleDocuments: [],
        workspaceFolders: []
      },
      activeFiles: [],
      cursorSelection: null
    };
  }

  private async clearCurrentChatContext(): Promise<void> {
    const clearCommands = [
      'cursor.chat.clear',
      'cursor.agent.reset',
      'workbench.action.chat.clear',
      'workbench.action.chat.clearHistory'
    ];

    for (const command of clearCommands) {
      try {
        await vscode.commands.executeCommand(command);
        console.log(`Successfully executed ${command}`);
        return; // If one succeeds, we're done
      } catch (error) {
        console.log(`Command ${command} not available or failed`);
      }
    }

    // Fallback: try to manipulate chat panel
    try {
      await vscode.commands.executeCommand('workbench.action.chat.close');
      await new Promise(resolve => setTimeout(resolve, 200));
      await vscode.commands.executeCommand('workbench.action.chat.open');
    } catch (error) {
      console.warn('Failed to reset chat context via panel manipulation');
    }
  }

  private async extractChatHistory(): Promise<ChatMessage[]> {
    // This is a placeholder - in a real implementation, we would need to
    // integrate with Cursor's internal chat API to extract current history
    // For now, we'll return empty array as we can't easily access this
    return [];
  }

  private async captureWorkspaceState(): Promise<WorkspaceState> {
    const activeEditor = vscode.window.activeTextEditor;
    const visibleEditors = vscode.window.visibleTextEditors;

    return {
      activeDocument: activeEditor?.document.uri.fsPath || null,
      visibleDocuments: visibleEditors.map(editor => editor.document.uri.fsPath),
      workspaceFolders: vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) || []
    };
  }

  private getActiveFiles(): string[] {
    return vscode.window.visibleTextEditors.map(editor => editor.document.uri.fsPath);
  }

  private getCursorSelection(): CursorSelection | null {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      return null;
    }

    return {
      filePath: activeEditor.document.uri.fsPath,
      selection: {
        start: {
          line: activeEditor.selection.start.line,
          character: activeEditor.selection.start.character
        },
        end: {
          line: activeEditor.selection.end.line,
          character: activeEditor.selection.end.character
        }
      }
    };
  }

  private async restoreWorkspaceState(state: WorkspaceState): Promise<void> {
    try {
      // Close all current editors
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');

      // Reopen visible documents
      for (const filePath of state.visibleDocuments) {
        try {
          const document = await vscode.workspace.openTextDocument(filePath);
          await vscode.window.showTextDocument(document, { preview: false });
        } catch (error) {
          console.warn(`Failed to reopen document ${filePath}:`, error);
        }
      }

      // Set active document
      if (state.activeDocument) {
        try {
          const document = await vscode.workspace.openTextDocument(state.activeDocument);
          await vscode.window.showTextDocument(document);
        } catch (error) {
          console.warn(`Failed to set active document ${state.activeDocument}:`, error);
        }
      }
    } catch (error) {
      console.error('Failed to restore workspace state:', error);
    }
  }

  private async restoreActiveFiles(filePaths: string[]): Promise<void> {
    for (const filePath of filePaths) {
      try {
        const document = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(document, { preview: false });
      } catch (error) {
        console.warn(`Failed to restore active file ${filePath}:`, error);
      }
    }
  }

  private async restoreCursorSelection(selection: CursorSelection | null): Promise<void> {
    if (!selection) {
      return;
    }

    try {
      const document = await vscode.workspace.openTextDocument(selection.filePath);
      const editor = await vscode.window.showTextDocument(document);
      
      const start = new vscode.Position(selection.selection.start.line, selection.selection.start.character);
      const end = new vscode.Position(selection.selection.end.line, selection.selection.end.character);
      
      editor.selection = new vscode.Selection(start, end);
      editor.revealRange(new vscode.Range(start, end));
    } catch (error) {
      console.warn(`Failed to restore cursor selection in ${selection.filePath}:`, error);
    }
  }

  private async restoreChatHistory(history: ChatMessage[]): Promise<void> {
    // This is a placeholder - in a real implementation, we would need to
    // integrate with Cursor's internal chat API to restore history
    // For now, we'll just log what we would restore
    console.log(`Would restore ${history.length} chat messages`);
    
    // Potential approach: try to simulate the conversation by sending messages
    // This would require careful integration with Cursor's chat API
    for (const message of history) {
      if (message.role === 'user') {
        // We could potentially send this message to restart the conversation
        console.log(`User message: ${message.content.substring(0, 100)}...`);
      }
    }
  }

  /**
   * Clean up old context history
   */
  cleanupOldContexts(maxAge: number = 24 * 60 * 60 * 1000): void {
    const now = Date.now();
    const toDelete: string[] = [];

    this.contextHistory.forEach((context, messageId) => {
      if (now - context.timestamp > maxAge) {
        toDelete.push(messageId);
      }
    });

    for (const messageId of toDelete) {
      this.contextHistory.delete(messageId);
    }

    if (toDelete.length > 0) {
      console.log(`Cleaned up ${toDelete.length} old conversation contexts`);
    }
  }
}

/**
 * Represents a conversation context at a specific point in time
 */
export interface ConversationContext {
  conversationId: string;
  messageId: string;
  timestamp: number;
  chatHistory: ChatMessage[];
  workspaceState: WorkspaceState;
  activeFiles: string[];
  cursorSelection: CursorSelection | null;
}

/**
 * Represents a chat message in the conversation history
 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

/**
 * Represents the state of the workspace
 */
export interface WorkspaceState {
  activeDocument: string | null;
  visibleDocuments: string[];
  workspaceFolders: string[];
}

/**
 * Represents cursor selection in a file
 */
export interface CursorSelection {
  filePath: string;
  selection: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}