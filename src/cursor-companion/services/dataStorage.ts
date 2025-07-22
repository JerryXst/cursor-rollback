import * as vscode from 'vscode';
import * as path from 'path';
import { IDataStorage } from './interfaces';
import { Conversation, Message, ConversationFilter, MessageFilter } from '../models';
import { SnapshotCollection } from '../models/fileSnapshot';

/**
 * Local file-based storage implementation for conversation data
 */
export class DataStorage implements IDataStorage {
  private readonly storageRoot: string;
  private readonly conversationsDir: string;
  private readonly messagesDir: string;
  private readonly snapshotsDir: string;
  private readonly backupsDir: string;

  constructor(private context: vscode.ExtensionContext) {
    this.storageRoot = path.join(context.globalStorageUri.fsPath, 'cursor-companion');
    this.conversationsDir = path.join(this.storageRoot, 'conversations');
    this.messagesDir = path.join(this.storageRoot, 'messages');
    this.snapshotsDir = path.join(this.storageRoot, 'snapshots');
    this.backupsDir = path.join(this.storageRoot, 'backups');
  }

  async initialize(): Promise<void> {
    try {
      // Create storage directories
      await this.ensureDirectoryExists(this.storageRoot);
      await this.ensureDirectoryExists(this.conversationsDir);
      await this.ensureDirectoryExists(this.messagesDir);
      await this.ensureDirectoryExists(this.snapshotsDir);
      await this.ensureDirectoryExists(this.backupsDir);

      console.log('Cursor Companion: Data storage initialized');
    } catch (error) {
      throw new Error(`Failed to initialize data storage: ${error}`);
    }
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    try {
      const filePath = path.join(this.conversationsDir, `${conversation.id}.json`);
      const data = JSON.stringify(conversation, null, 2);
      await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), Buffer.from(data, 'utf8'));
    } catch (error) {
      throw new Error(`Failed to save conversation ${conversation.id}: ${error}`);
    }
  }

  async getConversations(filter?: ConversationFilter): Promise<Conversation[]> {
    try {
      const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(this.conversationsDir));
      const conversations: Conversation[] = [];

      for (const [fileName] of files) {
        if (fileName.endsWith('.json')) {
          try {
            const filePath = path.join(this.conversationsDir, fileName);
            const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
            const conversation: Conversation = JSON.parse(data.toString());
            
            if (this.matchesFilter(conversation, filter)) {
              conversations.push(conversation);
            }
          } catch (error) {
            console.warn(`Failed to load conversation from ${fileName}:`, error);
          }
        }
      }

      // Sort by timestamp (newest first)
      return conversations.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      throw new Error(`Failed to get conversations: ${error}`);
    }
  }

  async getConversation(id: string): Promise<Conversation | null> {
    try {
      const filePath = path.join(this.conversationsDir, `${id}.json`);
      const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      return JSON.parse(data.toString());
    } catch (error) {
      // File not found or parse error
      return null;
    }
  }

  async deleteConversation(id: string): Promise<void> {
    try {
      const filePath = path.join(this.conversationsDir, `${id}.json`);
      await vscode.workspace.fs.delete(vscode.Uri.file(filePath));
      
      // Also delete associated messages and snapshots
      await this.deleteConversationMessages(id);
      await this.deleteConversationSnapshots(id);
    } catch (error) {
      throw new Error(`Failed to delete conversation ${id}: ${error}`);
    }
  }

  async archiveConversation(id: string): Promise<void> {
    try {
      const conversation = await this.getConversation(id);
      if (conversation) {
        conversation.status = 'archived';
        await this.saveConversation(conversation);
      }
    } catch (error) {
      throw new Error(`Failed to archive conversation ${id}: ${error}`);
    }
  }

  async saveMessage(message: Message): Promise<void> {
    try {
      const filePath = path.join(this.messagesDir, `${message.id}.json`);
      const data = JSON.stringify(message, null, 2);
      await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), Buffer.from(data, 'utf8'));
    } catch (error) {
      throw new Error(`Failed to save message ${message.id}: ${error}`);
    }
  }

  async getMessages(conversationId: string, filter?: MessageFilter): Promise<Message[]> {
    try {
      const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(this.messagesDir));
      const messages: Message[] = [];

      for (const [fileName] of files) {
        if (fileName.endsWith('.json')) {
          try {
            const filePath = path.join(this.messagesDir, fileName);
            const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
            const message: Message = JSON.parse(data.toString());
            
            if (message.conversationId === conversationId && this.matchesMessageFilter(message, filter)) {
              messages.push(message);
            }
          } catch (error) {
            console.warn(`Failed to load message from ${fileName}:`, error);
          }
        }
      }

      // Sort by timestamp (oldest first)
      return messages.sort((a, b) => a.timestamp - b.timestamp);
    } catch (error) {
      throw new Error(`Failed to get messages for conversation ${conversationId}: ${error}`);
    }
  }

  async getMessage(id: string): Promise<Message | null> {
    try {
      const filePath = path.join(this.messagesDir, `${id}.json`);
      const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      return JSON.parse(data.toString());
    } catch (error) {
      return null;
    }
  }

  async saveSnapshot(snapshot: SnapshotCollection): Promise<void> {
    try {
      const filePath = path.join(this.snapshotsDir, `${snapshot.id}.json`);
      const data = JSON.stringify(snapshot, null, 2);
      await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), Buffer.from(data, 'utf8'));
    } catch (error) {
      throw new Error(`Failed to save snapshot ${snapshot.id}: ${error}`);
    }
  }

  async getSnapshot(messageId: string): Promise<SnapshotCollection | null> {
    try {
      const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(this.snapshotsDir));
      
      for (const [fileName] of files) {
        if (fileName.endsWith('.json')) {
          try {
            const filePath = path.join(this.snapshotsDir, fileName);
            const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
            const snapshot: SnapshotCollection = JSON.parse(data.toString());
            
            if (snapshot.messageId === messageId) {
              return snapshot;
            }
          } catch (error) {
            console.warn(`Failed to load snapshot from ${fileName}:`, error);
          }
        }
      }
      
      return null;
    } catch (error) {
      throw new Error(`Failed to get snapshot for message ${messageId}: ${error}`);
    }
  }

  async cleanup(olderThanDays: number): Promise<void> {
    const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    
    try {
      // Clean up old conversations
      await this.cleanupDirectory(this.conversationsDir, cutoffTime);
      await this.cleanupDirectory(this.messagesDir, cutoffTime);
      await this.cleanupDirectory(this.snapshotsDir, cutoffTime);
      await this.cleanupDirectory(this.backupsDir, cutoffTime);
    } catch (error) {
      throw new Error(`Failed to cleanup old data: ${error}`);
    }
  }

  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
    } catch (error) {
      // Directory might already exist, which is fine
    }
  }

  private matchesFilter(conversation: Conversation, filter?: ConversationFilter): boolean {
    if (!filter) return true;

    if (filter.status && filter.status !== 'all' && conversation.status !== filter.status) {
      return false;
    }

    if (filter.searchQuery) {
      const query = filter.searchQuery.toLowerCase();
      if (!conversation.title.toLowerCase().includes(query)) {
        return false;
      }
    }

    if (filter.dateRange) {
      if (conversation.timestamp < filter.dateRange.start || conversation.timestamp > filter.dateRange.end) {
        return false;
      }
    }

    return true;
  }

  private matchesMessageFilter(message: Message, filter?: MessageFilter): boolean {
    if (!filter) return true;

    if (filter.sender && filter.sender !== 'all' && message.sender !== filter.sender) {
      return false;
    }

    if (filter.searchQuery) {
      const query = filter.searchQuery.toLowerCase();
      if (!message.content.toLowerCase().includes(query)) {
        return false;
      }
    }

    if (filter.hasCodeChanges !== undefined) {
      const hasChanges = message.codeChanges.length > 0;
      if (filter.hasCodeChanges !== hasChanges) {
        return false;
      }
    }

    if (filter.dateRange) {
      if (message.timestamp < filter.dateRange.start || message.timestamp > filter.dateRange.end) {
        return false;
      }
    }

    return true;
  }

  private async deleteConversationMessages(conversationId: string): Promise<void> {
    try {
      const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(this.messagesDir));
      
      for (const [fileName] of files) {
        if (fileName.endsWith('.json')) {
          try {
            const filePath = path.join(this.messagesDir, fileName);
            const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
            const message: Message = JSON.parse(data.toString());
            
            if (message.conversationId === conversationId) {
              await vscode.workspace.fs.delete(vscode.Uri.file(filePath));
            }
          } catch (error) {
            console.warn(`Failed to check message file ${fileName}:`, error);
          }
        }
      }
    } catch (error) {
      console.warn(`Failed to delete messages for conversation ${conversationId}:`, error);
    }
  }

  private async deleteConversationSnapshots(conversationId: string): Promise<void> {
    // TODO: Implement snapshot cleanup for conversation
    // This would require tracking which snapshots belong to which conversation
  }

  private async cleanupDirectory(dirPath: string, cutoffTime: number): Promise<void> {
    try {
      const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dirPath));
      
      for (const [fileName] of files) {
        try {
          const filePath = path.join(dirPath, fileName);
          const stat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
          
          if (stat.mtime < cutoffTime) {
            await vscode.workspace.fs.delete(vscode.Uri.file(filePath));
          }
        } catch (error) {
          console.warn(`Failed to cleanup file ${fileName}:`, error);
        }
      }
    } catch (error) {
      console.warn(`Failed to cleanup directory ${dirPath}:`, error);
    }
  }
}