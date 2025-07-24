/**
 * Conversation expand manager for handling conversation and message display
 * Manages the expansion/collapse state of conversations and message formatting
 */

import * as vscode from 'vscode';
import { Conversation, Message } from '../models';
import { IDataStorage } from '../services/interfaces';

/**
 * Represents the expansion state of a conversation
 */
export interface ConversationExpansionState {
  conversationId: string;
  isExpanded: boolean;
  expandedMessages: Set<string>;
  lastAccessed: number;
}

/**
 * Options for message display formatting
 */
export interface MessageDisplayOptions {
  showTimestamp: boolean;
  showSender: boolean;
  showCodeChanges: boolean;
  maxContentLength?: number;
  highlightSearchTerms?: string[];
}

/**
 * Formatted message for display in UI
 */
export interface FormattedMessage {
  id: string;
  displayContent: string;
  timestamp: string;
  sender: 'user' | 'ai';
  hasCodeChanges: boolean;
  codeChangesSummary?: string;
  isExpanded: boolean;
  canRollback: boolean;
}

/**
 * Manages conversation expansion state and message display formatting
 */
export class ConversationExpandManager {
  private expansionStates = new Map<string, ConversationExpansionState>();
  private readonly maxCachedStates = 100;
  private readonly stateCleanupInterval = 5 * 60 * 1000; // 5 minutes
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private context: vscode.ExtensionContext,
    private dataStorage: IDataStorage
  ) {
    this.loadExpansionStates();
    this.startCleanupTimer();
  }

  /**
   * Toggle the expansion state of a conversation
   */
  toggleConversationExpansion(conversationId: string): boolean {
    const state = this.getOrCreateExpansionState(conversationId);
    state.isExpanded = !state.isExpanded;
    state.lastAccessed = Date.now();
    
    this.saveExpansionStates();
    return state.isExpanded;
  }

  /**
   * Check if a conversation is expanded
   */
  isConversationExpanded(conversationId: string): boolean {
    const state = this.expansionStates.get(conversationId);
    return state?.isExpanded ?? false;
  }

  /**
   * Toggle the expansion state of a specific message
   */
  toggleMessageExpansion(conversationId: string, messageId: string): boolean {
    const state = this.getOrCreateExpansionState(conversationId);
    
    if (state.expandedMessages.has(messageId)) {
      state.expandedMessages.delete(messageId);
    } else {
      state.expandedMessages.add(messageId);
    }
    
    state.lastAccessed = Date.now();
    this.saveExpansionStates();
    
    return state.expandedMessages.has(messageId);
  }

  /**
   * Check if a message is expanded
   */
  isMessageExpanded(conversationId: string, messageId: string): boolean {
    const state = this.expansionStates.get(conversationId);
    return state?.expandedMessages.has(messageId) ?? false;
  }

  /**
   * Format messages for display in the UI
   */
  async formatMessagesForDisplay(
    conversationId: string,
    messages: Message[],
    options: MessageDisplayOptions = {
      showTimestamp: true,
      showSender: true,
      showCodeChanges: true
    }
  ): Promise<FormattedMessage[]> {
    const formattedMessages: FormattedMessage[] = [];
    
    for (const message of messages) {
      const isExpanded = this.isMessageExpanded(conversationId, message.id);
      const formattedMessage = await this.formatSingleMessage(message, options, isExpanded);
      formattedMessages.push(formattedMessage);
    }
    
    return formattedMessages;
  }

  /**
   * Format a single message for display
   */
  private async formatSingleMessage(
    message: Message,
    options: MessageDisplayOptions,
    isExpanded: boolean
  ): Promise<FormattedMessage> {
    let displayContent = message.content;
    
    // Apply content length limit if specified
    if (options.maxContentLength && displayContent.length > options.maxContentLength) {
      if (isExpanded) {
        // Show full content when expanded
        displayContent = displayContent;
      } else {
        // Truncate content when collapsed
        displayContent = displayContent.substring(0, options.maxContentLength) + '...';
      }
    }
    
    // Highlight search terms if provided
    if (options.highlightSearchTerms && options.highlightSearchTerms.length > 0) {
      displayContent = this.highlightSearchTerms(displayContent, options.highlightSearchTerms);
    }
    
    // Format timestamp
    const timestamp = options.showTimestamp 
      ? this.formatTimestamp(message.timestamp)
      : '';
    
    // Generate code changes summary
    const hasCodeChanges = message.codeChanges && message.codeChanges.length > 0;
    const codeChangesSummary = hasCodeChanges && options.showCodeChanges
      ? this.generateCodeChangesSummary(message.codeChanges)
      : undefined;
    
    // Determine if message can be rolled back
    const canRollback = await this.canMessageBeRolledBack(message);
    
    return {
      id: message.id,
      displayContent,
      timestamp,
      sender: message.sender,
      hasCodeChanges,
      codeChangesSummary,
      isExpanded,
      canRollback
    };
  }

  /**
   * Highlight search terms in content
   */
  private highlightSearchTerms(content: string, searchTerms: string[]): string {
    let highlightedContent = content;
    
    for (const term of searchTerms) {
      if (term.trim() === '') continue;
      
      // Create case-insensitive regex for the search term
      const regex = new RegExp(`(${this.escapeRegExp(term)})`, 'gi');
      highlightedContent = highlightedContent.replace(regex, '**$1**'); // Use markdown bold for highlighting
    }
    
    return highlightedContent;
  }

  /**
   * Escape special regex characters
   */
  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Format timestamp for display
   */
  private formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    
    // If it's today, show time only
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    // If it's this year, show month and day
    if (date.getFullYear() === now.getFullYear()) {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + 
             ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    // Otherwise, show full date
    return date.toLocaleDateString([], { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  /**
   * Generate a summary of code changes for display
   */
  private generateCodeChangesSummary(codeChanges: any[]): string {
    if (!codeChanges || codeChanges.length === 0) {
      return '';
    }
    
    const changeTypes = {
      create: 0,
      modify: 0,
      delete: 0
    };
    
    const affectedFiles = new Set<string>();
    
    for (const change of codeChanges) {
      if (change.changeType && changeTypes.hasOwnProperty(change.changeType)) {
        changeTypes[change.changeType as keyof typeof changeTypes]++;
      }
      if (change.filePath) {
        affectedFiles.add(change.filePath);
      }
    }
    
    const parts: string[] = [];
    
    if (changeTypes.create > 0) {
      parts.push(`${changeTypes.create} created`);
    }
    if (changeTypes.modify > 0) {
      parts.push(`${changeTypes.modify} modified`);
    }
    if (changeTypes.delete > 0) {
      parts.push(`${changeTypes.delete} deleted`);
    }
    
    const fileCount = affectedFiles.size;
    const fileText = fileCount === 1 ? 'file' : 'files';
    
    if (parts.length > 0) {
      return `${parts.join(', ')} • ${fileCount} ${fileText}`;
    } else {
      return `${fileCount} ${fileText} changed`;
    }
  }

  /**
   * Check if a message can be rolled back
   */
  private async canMessageBeRolledBack(message: Message): Promise<boolean> {
    try {
      // A message can be rolled back if:
      // 1. It has code changes, OR
      // 2. It has a snapshot (for conversation context rollback)
      const hasCodeChanges = message.codeChanges && message.codeChanges.length > 0;
      const hasSnapshot = message.snapshot && message.snapshot.length > 0;
      
      return hasCodeChanges || hasSnapshot;
    } catch (error) {
      console.warn(`Error checking rollback capability for message ${message.id}:`, error);
      return false;
    }
  }

  /**
   * Expand all messages in a conversation
   */
  expandAllMessages(conversationId: string, messageIds: string[]): void {
    const state = this.getOrCreateExpansionState(conversationId);
    
    for (const messageId of messageIds) {
      state.expandedMessages.add(messageId);
    }
    
    state.lastAccessed = Date.now();
    this.saveExpansionStates();
  }

  /**
   * Collapse all messages in a conversation
   */
  collapseAllMessages(conversationId: string): void {
    const state = this.getOrCreateExpansionState(conversationId);
    state.expandedMessages.clear();
    state.lastAccessed = Date.now();
    this.saveExpansionStates();
  }

  /**
   * Get or create expansion state for a conversation
   */
  private getOrCreateExpansionState(conversationId: string): ConversationExpansionState {
    let state = this.expansionStates.get(conversationId);
    
    if (!state) {
      state = {
        conversationId,
        isExpanded: false,
        expandedMessages: new Set<string>(),
        lastAccessed: Date.now()
      };
      this.expansionStates.set(conversationId, state);
    }
    
    return state;
  }

  /**
   * Load expansion states from persistent storage
   */
  private loadExpansionStates(): void {
    try {
      const savedStates = this.context.globalState.get<any[]>('conversationExpansionStates', []);
      
      for (const savedState of savedStates) {
        if (savedState.conversationId) {
          this.expansionStates.set(savedState.conversationId, {
            conversationId: savedState.conversationId,
            isExpanded: savedState.isExpanded || false,
            expandedMessages: new Set(savedState.expandedMessages || []),
            lastAccessed: savedState.lastAccessed || Date.now()
          });
        }
      }
      
      console.log(`Cursor Companion: Loaded ${this.expansionStates.size} conversation expansion states`);
    } catch (error) {
      console.warn('Failed to load conversation expansion states:', error);
    }
  }

  /**
   * Save expansion states to persistent storage
   */
  private saveExpansionStates(): void {
    try {
      const statesToSave: any[] = [];
      
      for (const [conversationId, state] of this.expansionStates) {
        statesToSave.push({
          conversationId,
          isExpanded: state.isExpanded,
          expandedMessages: Array.from(state.expandedMessages),
          lastAccessed: state.lastAccessed
        });
      }
      
      this.context.globalState.update('conversationExpansionStates', statesToSave);
    } catch (error) {
      console.warn('Failed to save conversation expansion states:', error);
    }
  }

  /**
   * Start cleanup timer to remove old expansion states
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupOldStates();
    }, this.stateCleanupInterval);
  }

  /**
   * Clean up old expansion states to prevent memory leaks
   */
  private cleanupOldStates(): void {
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
    const statesToRemove: string[] = [];
    
    // Find states that are too old
    for (const [conversationId, state] of this.expansionStates) {
      if (now - state.lastAccessed > maxAge) {
        statesToRemove.push(conversationId);
      }
    }
    
    // Remove old states
    for (const conversationId of statesToRemove) {
      this.expansionStates.delete(conversationId);
    }
    
    // If we still have too many states, remove the oldest ones
    if (this.expansionStates.size > this.maxCachedStates) {
      const sortedStates = Array.from(this.expansionStates.entries())
        .sort(([, a], [, b]) => a.lastAccessed - b.lastAccessed);
      
      const toRemove = sortedStates.slice(0, this.expansionStates.size - this.maxCachedStates);
      for (const [conversationId] of toRemove) {
        this.expansionStates.delete(conversationId);
      }
    }
    
    if (statesToRemove.length > 0) {
      console.log(`Cursor Companion: Cleaned up ${statesToRemove.length} old expansion states`);
      this.saveExpansionStates();
    }
  }

  /**
   * Get statistics about expansion states
   */
  getExpansionStats(): {
    totalConversations: number;
    expandedConversations: number;
    totalExpandedMessages: number;
  } {
    let expandedConversations = 0;
    let totalExpandedMessages = 0;
    
    for (const state of this.expansionStates.values()) {
      if (state.isExpanded) {
        expandedConversations++;
      }
      totalExpandedMessages += state.expandedMessages.size;
    }
    
    return {
      totalConversations: this.expansionStates.size,
      expandedConversations,
      totalExpandedMessages
    };
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    
    this.saveExpansionStates();
    this.expansionStates.clear();
  }
}