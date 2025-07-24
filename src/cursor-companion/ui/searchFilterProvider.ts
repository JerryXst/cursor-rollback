/**
 * Search and filter provider for conversation management
 * Handles search input, real-time filtering, and search result highlighting
 */

import * as vscode from 'vscode';
import { Conversation, Message, ConversationFilter } from '../models';
import { IDataStorage } from '../services/interfaces';

/**
 * Search filter options
 */
export interface SearchFilterOptions {
  query?: string;
  status?: 'all' | 'active' | 'archived';
  dateRange?: {
    start: Date;
    end: Date;
  };
  tags?: string[];
  sender?: 'all' | 'user' | 'ai';
  hasCodeChanges?: boolean;
  caseSensitive?: boolean;
}

/**
 * Search result item
 */
export interface SearchResult {
  conversation: Conversation;
  message?: Message;
  matchType: 'title' | 'content' | 'tag';
  matchText: string;
  highlightedText: string;
  score: number;
}

/**
 * Search history item
 */
export interface SearchHistoryItem {
  query: string;
  timestamp: number;
  resultCount: number;
}

/**
 * Search suggestions
 */
export interface SearchSuggestion {
  text: string;
  type: 'history' | 'tag' | 'keyword';
  frequency?: number;
}

/**
 * Provides search and filtering functionality for conversations
 */
export class SearchFilterProvider {
  private currentFilter: SearchFilterOptions = {};
  private searchHistory: SearchHistoryItem[] = [];
  private readonly maxHistoryItems = 50;
  private readonly maxSuggestions = 10;
  
  // Debounce timer for search
  private searchDebounceTimer?: NodeJS.Timeout;
  private readonly searchDebounceDelay = 300; // 300ms
  
  // Search callbacks
  private searchCallbacks: Array<(results: SearchResult[]) => void> = [];
  private filterCallbacks: Array<(filter: SearchFilterOptions) => void> = [];

  constructor(
    private context: vscode.ExtensionContext,
    private dataStorage: IDataStorage
  ) {
    this.loadSearchHistory();
  }

  /**
   * Perform search with debouncing
   */
  search(query: string, options: Partial<SearchFilterOptions> = {}): void {
    // Clear existing timer
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }

    // Set new timer
    this.searchDebounceTimer = setTimeout(async () => {
      await this.performSearch(query, options);
    }, this.searchDebounceDelay);
  }

  /**
   * Perform immediate search without debouncing
   */
  async searchImmediate(query: string, options: Partial<SearchFilterOptions> = {}): Promise<SearchResult[]> {
    return await this.performSearch(query, options);
  }

  /**
   * Apply filter to conversations
   */
  async applyFilter(filter: SearchFilterOptions): Promise<void> {
    this.currentFilter = { ...filter };
    
    // Notify filter callbacks
    this.filterCallbacks.forEach(callback => {
      try {
        callback(this.currentFilter);
      } catch (error) {
        console.error('Error in filter callback:', error);
      }
    });
  }

  /**
   * Clear all filters
   */
  clearFilters(): void {
    this.currentFilter = {};
    this.applyFilter({});
  }

  /**
   * Get current filter
   */
  getCurrentFilter(): SearchFilterOptions {
    return { ...this.currentFilter };
  }

  /**
   * Get search suggestions based on input
   */
  async getSearchSuggestions(input: string): Promise<SearchSuggestion[]> {
    const suggestions: SearchSuggestion[] = [];
    const inputLower = input.toLowerCase();

    // Add history suggestions
    const historySuggestions = this.searchHistory
      .filter(item => item.query.toLowerCase().includes(inputLower))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 5)
      .map(item => ({
        text: item.query,
        type: 'history' as const,
        frequency: item.resultCount
      }));

    suggestions.push(...historySuggestions);

    // Add tag suggestions
    const tagSuggestions = await this.getTagSuggestions(inputLower);
    suggestions.push(...tagSuggestions);

    // Add keyword suggestions
    const keywordSuggestions = await this.getKeywordSuggestions(inputLower);
    suggestions.push(...keywordSuggestions);

    // Sort by relevance and limit
    return suggestions
      .sort((a, b) => (b.frequency || 0) - (a.frequency || 0))
      .slice(0, this.maxSuggestions);
  }

  /**
   * Get search history
   */
  getSearchHistory(): SearchHistoryItem[] {
    return [...this.searchHistory];
  }

  /**
   * Clear search history
   */
  clearSearchHistory(): void {
    this.searchHistory = [];
    this.saveSearchHistory();
  }

  /**
   * Register search result callback
   */
  onSearchResults(callback: (results: SearchResult[]) => void): void {
    this.searchCallbacks.push(callback);
  }

  /**
   * Register filter change callback
   */
  onFilterChange(callback: (filter: SearchFilterOptions) => void): void {
    this.filterCallbacks.push(callback);
  }

  /**
   * Create quick pick for advanced search
   */
  async showAdvancedSearchDialog(): Promise<SearchFilterOptions | undefined> {
    const options: vscode.QuickPickItem[] = [
      {
        label: '$(search) Search in content',
        description: 'Search in message content',
        detail: 'Enter search terms to find in message content'
      },
      {
        label: '$(tag) Filter by tags',
        description: 'Filter conversations by tags',
        detail: 'Select tags to filter conversations'
      },
      {
        label: '$(calendar) Filter by date range',
        description: 'Filter by date range',
        detail: 'Select conversations from specific date range'
      },
      {
        label: '$(person) Filter by sender',
        description: 'Filter by message sender',
        detail: 'Show messages from user or AI only'
      },
      {
        label: '$(archive) Filter by status',
        description: 'Filter by conversation status',
        detail: 'Show active or archived conversations'
      },
      {
        label: '$(code) Has code changes',
        description: 'Show only messages with code changes',
        detail: 'Filter messages that contain code modifications'
      }
    ];

    const selected = await vscode.window.showQuickPick(options, {
      placeHolder: 'Select search/filter option',
      canPickMany: false
    });

    if (!selected) {
      return undefined;
    }

    // Handle different filter types
    switch (selected.label) {
      case '$(search) Search in content':
        return await this.handleContentSearch();
      case '$(tag) Filter by tags':
        return await this.handleTagFilter();
      case '$(calendar) Filter by date range':
        return await this.handleDateRangeFilter();
      case '$(person) Filter by sender':
        return await this.handleSenderFilter();
      case '$(archive) Filter by status':
        return await this.handleStatusFilter();
      case '$(code) Has code changes':
        return { hasCodeChanges: true };
      default:
        return undefined;
    }
  }

  /**
   * Export search results
   */
  async exportSearchResults(results: SearchResult[]): Promise<void> {
    try {
      const content = this.formatSearchResultsForExport(results);
      
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`search-results-${Date.now()}.md`),
        filters: {
          'Markdown': ['md'],
          'Text': ['txt'],
          'All Files': ['*']
        }
      });

      if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
        vscode.window.showInformationMessage(`Search results exported to ${uri.fsPath}`);
      }
    } catch (error) {
      console.error('Failed to export search results:', error);
      vscode.window.showErrorMessage('Failed to export search results');
    }
  }

  // Private methods

  /**
   * Perform the actual search
   */
  private async performSearch(query: string, options: Partial<SearchFilterOptions>): Promise<SearchResult[]> {
    try {
      if (!query.trim()) {
        return [];
      }

      const searchOptions: SearchFilterOptions = {
        ...this.currentFilter,
        ...options,
        query: query.trim()
      };

      // Get all conversations
      const conversations = await this.dataStorage.getConversations();
      const results: SearchResult[] = [];

      // Search in conversations
      for (const conversation of conversations) {
        // Apply status filter
        if (searchOptions.status && searchOptions.status !== 'all' && conversation.status !== searchOptions.status) {
          continue;
        }

        // Apply date range filter
        if (searchOptions.dateRange) {
          const conversationDate = new Date(conversation.timestamp);
          if (conversationDate < searchOptions.dateRange.start || conversationDate > searchOptions.dateRange.end) {
            continue;
          }
        }

        // Apply tag filter
        if (searchOptions.tags && searchOptions.tags.length > 0) {
          const conversationTags = conversation.metadata?.tags || [];
          if (!searchOptions.tags.some(tag => conversationTags.includes(tag))) {
            continue;
          }
        }

        // Search in conversation title
        const titleMatch = this.searchInText(conversation.title, query, searchOptions.caseSensitive);
        if (titleMatch) {
          results.push({
            conversation,
            matchType: 'title',
            matchText: conversation.title,
            highlightedText: titleMatch.highlighted,
            score: titleMatch.score
          });
        }

        // Search in conversation tags
        if (conversation.metadata?.tags) {
          for (const tag of conversation.metadata.tags) {
            const tagMatch = this.searchInText(tag, query, searchOptions.caseSensitive);
            if (tagMatch) {
              results.push({
                conversation,
                matchType: 'tag',
                matchText: tag,
                highlightedText: tagMatch.highlighted,
                score: tagMatch.score * 0.8 // Lower score for tag matches
              });
            }
          }
        }

        // Search in messages
        try {
          const messages = await this.dataStorage.getMessages(conversation.id);
          
          for (const message of messages) {
            // Apply sender filter
            if (searchOptions.sender && searchOptions.sender !== 'all' && message.sender !== searchOptions.sender) {
              continue;
            }

            // Apply code changes filter
            if (searchOptions.hasCodeChanges && (!message.codeChanges || message.codeChanges.length === 0)) {
              continue;
            }

            // Search in message content
            const contentMatch = this.searchInText(message.content, query, searchOptions.caseSensitive);
            if (contentMatch) {
              results.push({
                conversation,
                message,
                matchType: 'content',
                matchText: message.content,
                highlightedText: contentMatch.highlighted,
                score: contentMatch.score * 0.9 // Slightly lower score for content matches
              });
            }
          }
        } catch (error) {
          console.warn(`Failed to search messages in conversation ${conversation.id}:`, error);
        }
      }

      // Sort results by score
      results.sort((a, b) => b.score - a.score);

      // Add to search history
      this.addToSearchHistory(query, results.length);

      // Notify callbacks
      this.searchCallbacks.forEach(callback => {
        try {
          callback(results);
        } catch (error) {
          console.error('Error in search callback:', error);
        }
      });

      return results;
    } catch (error) {
      console.error('Search failed:', error);
      vscode.window.showErrorMessage('Search failed');
      return [];
    }
  }

  /**
   * Search for text within a string
   */
  private searchInText(text: string, query: string, caseSensitive = false): { highlighted: string; score: number } | null {
    const searchText = caseSensitive ? text : text.toLowerCase();
    const searchQuery = caseSensitive ? query : query.toLowerCase();

    if (!searchText.includes(searchQuery)) {
      return null;
    }

    // Calculate score based on match position and length
    const index = searchText.indexOf(searchQuery);
    const score = this.calculateMatchScore(text, query, index);

    // Create highlighted text
    const highlighted = this.highlightMatches(text, query, caseSensitive);

    return { highlighted, score };
  }

  /**
   * Calculate match score
   */
  private calculateMatchScore(text: string, query: string, index: number): number {
    let score = 100;

    // Boost score for exact matches
    if (text.toLowerCase() === query.toLowerCase()) {
      score += 50;
    }

    // Boost score for matches at the beginning
    if (index === 0) {
      score += 30;
    } else if (index < 10) {
      score += 20;
    }

    // Boost score for longer queries
    score += query.length * 2;

    // Reduce score based on text length (shorter texts are more relevant)
    score -= Math.floor(text.length / 100);

    return Math.max(score, 1);
  }

  /**
   * Highlight matches in text
   */
  private highlightMatches(text: string, query: string, caseSensitive = false): string {
    if (!query.trim()) {
      return text;
    }

    const flags = caseSensitive ? 'g' : 'gi';
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedQuery})`, flags);

    return text.replace(regex, '**$1**'); // Use markdown bold for highlighting
  }

  /**
   * Get tag suggestions
   */
  private async getTagSuggestions(input: string): Promise<SearchSuggestion[]> {
    try {
      const conversations = await this.dataStorage.getConversations();
      const tagCounts = new Map<string, number>();

      // Count tag frequencies
      for (const conversation of conversations) {
        if (conversation.metadata?.tags) {
          for (const tag of conversation.metadata.tags) {
            if (tag.toLowerCase().includes(input)) {
              tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
            }
          }
        }
      }

      // Convert to suggestions
      return Array.from(tagCounts.entries())
        .map(([tag, count]) => ({
          text: tag,
          type: 'tag' as const,
          frequency: count
        }))
        .sort((a, b) => b.frequency! - a.frequency!)
        .slice(0, 5);
    } catch (error) {
      console.warn('Failed to get tag suggestions:', error);
      return [];
    }
  }

  /**
   * Get keyword suggestions
   */
  private async getKeywordSuggestions(input: string): Promise<SearchSuggestion[]> {
    // Common programming keywords that might be useful
    const keywords = [
      'function', 'class', 'interface', 'type', 'const', 'let', 'var',
      'import', 'export', 'async', 'await', 'promise', 'error', 'bug',
      'fix', 'refactor', 'optimize', 'test', 'debug', 'api', 'database',
      'component', 'service', 'util', 'helper', 'config', 'setup'
    ];

    return keywords
      .filter(keyword => keyword.includes(input))
      .map(keyword => ({
        text: keyword,
        type: 'keyword' as const
      }))
      .slice(0, 3);
  }

  /**
   * Handle content search dialog
   */
  private async handleContentSearch(): Promise<SearchFilterOptions | undefined> {
    const query = await vscode.window.showInputBox({
      prompt: 'Enter search terms',
      placeHolder: 'Search in message content...',
      value: this.currentFilter.query || ''
    });

    if (query !== undefined) {
      const caseSensitive = await vscode.window.showQuickPick(
        [
          { label: 'Case insensitive', value: false },
          { label: 'Case sensitive', value: true }
        ],
        { placeHolder: 'Search mode' }
      );

      return {
        query,
        caseSensitive: caseSensitive?.value || false
      };
    }

    return undefined;
  }

  /**
   * Handle tag filter dialog
   */
  private async handleTagFilter(): Promise<SearchFilterOptions | undefined> {
    try {
      // Get all available tags
      const conversations = await this.dataStorage.getConversations();
      const allTags = new Set<string>();

      for (const conversation of conversations) {
        if (conversation.metadata?.tags) {
          conversation.metadata.tags.forEach(tag => allTags.add(tag));
        }
      }

      if (allTags.size === 0) {
        vscode.window.showInformationMessage('No tags found in conversations');
        return undefined;
      }

      const tagItems = Array.from(allTags).map(tag => ({
        label: tag,
        picked: this.currentFilter.tags?.includes(tag) || false
      }));

      const selectedTags = await vscode.window.showQuickPick(tagItems, {
        placeHolder: 'Select tags to filter by',
        canPickMany: true
      });

      if (selectedTags) {
        return {
          tags: selectedTags.map(item => item.label)
        };
      }
    } catch (error) {
      console.error('Failed to handle tag filter:', error);
    }

    return undefined;
  }

  /**
   * Handle date range filter dialog
   */
  private async handleDateRangeFilter(): Promise<SearchFilterOptions | undefined> {
    const startDate = await vscode.window.showInputBox({
      prompt: 'Enter start date (YYYY-MM-DD)',
      placeHolder: '2024-01-01',
      validateInput: (value) => {
        if (value && !this.isValidDate(value)) {
          return 'Please enter a valid date in YYYY-MM-DD format';
        }
        return undefined;
      }
    });

    if (!startDate) {
      return undefined;
    }

    const endDate = await vscode.window.showInputBox({
      prompt: 'Enter end date (YYYY-MM-DD)',
      placeHolder: '2024-12-31',
      validateInput: (value) => {
        if (value && !this.isValidDate(value)) {
          return 'Please enter a valid date in YYYY-MM-DD format';
        }
        return undefined;
      }
    });

    if (!endDate) {
      return undefined;
    }

    return {
      dateRange: {
        start: new Date(startDate),
        end: new Date(endDate)
      }
    };
  }

  /**
   * Handle sender filter dialog
   */
  private async handleSenderFilter(): Promise<SearchFilterOptions | undefined> {
    const senderOptions = [
      { label: 'All messages', value: 'all' as const },
      { label: 'User messages only', value: 'user' as const },
      { label: 'AI messages only', value: 'ai' as const }
    ];

    const selected = await vscode.window.showQuickPick(senderOptions, {
      placeHolder: 'Filter by message sender'
    });

    if (selected) {
      return { sender: selected.value };
    }

    return undefined;
  }

  /**
   * Handle status filter dialog
   */
  private async handleStatusFilter(): Promise<SearchFilterOptions | undefined> {
    const statusOptions = [
      { label: 'All conversations', value: 'all' as const },
      { label: 'Active conversations', value: 'active' as const },
      { label: 'Archived conversations', value: 'archived' as const }
    ];

    const selected = await vscode.window.showQuickPick(statusOptions, {
      placeHolder: 'Filter by conversation status'
    });

    if (selected) {
      return { status: selected.value };
    }

    return undefined;
  }

  /**
   * Validate date string
   */
  private isValidDate(dateString: string): boolean {
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(dateString)) {
      return false;
    }

    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date.getTime());
  }

  /**
   * Add search to history
   */
  private addToSearchHistory(query: string, resultCount: number): void {
    // Remove existing entry if present
    this.searchHistory = this.searchHistory.filter(item => item.query !== query);

    // Add new entry at the beginning
    this.searchHistory.unshift({
      query,
      timestamp: Date.now(),
      resultCount
    });

    // Limit history size
    if (this.searchHistory.length > this.maxHistoryItems) {
      this.searchHistory = this.searchHistory.slice(0, this.maxHistoryItems);
    }

    // Save to storage
    this.saveSearchHistory();
  }

  /**
   * Load search history from storage
   */
  private loadSearchHistory(): void {
    try {
      const saved = this.context.globalState.get<SearchHistoryItem[]>('searchHistory', []);
      this.searchHistory = saved.filter(item => 
        item.query && typeof item.timestamp === 'number' && typeof item.resultCount === 'number'
      );
    } catch (error) {
      console.warn('Failed to load search history:', error);
      this.searchHistory = [];
    }
  }

  /**
   * Save search history to storage
   */
  private saveSearchHistory(): void {
    try {
      this.context.globalState.update('searchHistory', this.searchHistory);
    } catch (error) {
      console.warn('Failed to save search history:', error);
    }
  }

  /**
   * Format search results for export
   */
  private formatSearchResultsForExport(results: SearchResult[]): string {
    const lines: string[] = [];
    
    lines.push('# Search Results');
    lines.push(`Generated: ${new Date().toLocaleString()}`);
    lines.push(`Total Results: ${results.length}`);
    lines.push('');

    if (this.currentFilter.query) {
      lines.push(`**Search Query:** ${this.currentFilter.query}`);
    }

    if (this.currentFilter.status && this.currentFilter.status !== 'all') {
      lines.push(`**Status Filter:** ${this.currentFilter.status}`);
    }

    if (this.currentFilter.sender && this.currentFilter.sender !== 'all') {
      lines.push(`**Sender Filter:** ${this.currentFilter.sender}`);
    }

    if (this.currentFilter.tags && this.currentFilter.tags.length > 0) {
      lines.push(`**Tag Filter:** ${this.currentFilter.tags.join(', ')}`);
    }

    lines.push('');
    lines.push('---');
    lines.push('');

    // Group results by conversation
    const conversationGroups = new Map<string, SearchResult[]>();
    
    for (const result of results) {
      const convId = result.conversation.id;
      if (!conversationGroups.has(convId)) {
        conversationGroups.set(convId, []);
      }
      conversationGroups.get(convId)!.push(result);
    }

    // Format each conversation group
    for (const [convId, convResults] of conversationGroups) {
      const conversation = convResults[0].conversation;
      
      lines.push(`## ${conversation.title}`);
      lines.push(`**Created:** ${new Date(conversation.timestamp).toLocaleString()}`);
      lines.push(`**Status:** ${conversation.status || 'active'}`);
      
      if (conversation.metadata?.tags && conversation.metadata.tags.length > 0) {
        lines.push(`**Tags:** ${conversation.metadata.tags.join(', ')}`);
      }
      
      lines.push('');

      // Add matches
      for (const result of convResults) {
        lines.push(`### ${result.matchType.charAt(0).toUpperCase() + result.matchType.slice(1)} Match`);
        
        if (result.message) {
          lines.push(`**Sender:** ${result.message.sender === 'user' ? 'You' : 'Cursor AI'}`);
          lines.push(`**Time:** ${new Date(result.message.timestamp).toLocaleString()}`);
        }
        
        lines.push('');
        lines.push(result.highlightedText);
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    
    this.saveSearchHistory();
    this.searchCallbacks = [];
    this.filterCallbacks = [];
  }
}