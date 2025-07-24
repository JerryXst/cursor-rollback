/**
 * Data indexing and search functionality for Cursor Companion
 * Provides efficient search and filtering capabilities for conversations and messages
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { IDataStorage } from './interfaces';
import { 
  Conversation, 
  ConversationFilter, 
  Message, 
  MessageFilter,
  StorageError
} from '../models';

/**
 * Search result item for conversations
 */
export interface ConversationSearchResult {
  /** The conversation */
  conversation: Conversation;
  
  /** Search score (higher is better match) */
  score: number;
  
  /** Matched fields */
  matches: {
    /** Field name */
    field: string;
    
    /** Matched text */
    text: string;
    
    /** Match positions for highlighting */
    positions: Array<{ start: number; end: number }>;
  }[];
}

/**
 * Search result item for messages
 */
export interface MessageSearchResult {
  /** The message */
  message: Message;
  
  /** Search score (higher is better match) */
  score: number;
  
  /** Matched fields */
  matches: {
    /** Field name */
    field: string;
    
    /** Matched text */
    text: string;
    
    /** Match positions for highlighting */
    positions: Array<{ start: number; end: number }>;
  }[];
}

/**
 * Search options
 */
export interface SearchOptions {
  /** Maximum number of results to return */
  limit?: number;
  
  /** Fields to search in */
  fields?: string[];
  
  /** Whether to use fuzzy matching */
  fuzzy?: boolean;
  
  /** Minimum score for results (0-100) */
  minScore?: number;
  
  /** Whether to include highlights in results */
  includeHighlights?: boolean;
}

/**
 * Index statistics
 */
export interface IndexStats {
  /** Number of indexed conversations */
  conversationCount: number;
  
  /** Number of indexed messages */
  messageCount: number;
  
  /** Number of indexed terms */
  termCount: number;
  
  /** Last index update time */
  lastUpdated: number;
  
  /** Index size in bytes */
  indexSize: number;
}

/**
 * Data indexer service for efficient search and retrieval
 */
export class DataIndexer {
  // In-memory indexes
  private conversationIndex: Map<string, Map<string, number>> = new Map();
  private messageIndex: Map<string, Map<string, number>> = new Map();
  private termFrequency: Map<string, number> = new Map();
  private documentFrequency: Map<string, number> = new Map();
  
  // Indexed document counts
  private conversationCount = 0;
  private messageCount = 0;
  
  // Index metadata
  private lastIndexed = 0;
  private indexSize = 0;
  
  // Index status
  private isIndexing = false;
  private indexingPromise: Promise<void> | null = null;
  
  constructor(
    private storage: IDataStorage,
    private context: vscode.ExtensionContext
  ) {}
  
  /**
   * Initialize the indexer
   */
  async initialize(): Promise<void> {
    try {
      // Load existing index if available
      await this.loadIndex();
      
      // Schedule initial indexing
      this.scheduleIndexing();
    } catch (error) {
      console.error('Failed to initialize data indexer:', error);
      // Non-critical error, continue without index
    }
  }
  
  /**
   * Build or update the search index
   * @param forceRebuild Whether to force a complete rebuild
   */
  async buildIndex(forceRebuild = false): Promise<void> {
    // If already indexing, wait for it to complete
    if (this.isIndexing) {
      return this.indexingPromise!;
    }
    
    // Set indexing flag
    this.isIndexing = true;
    
    // Create a promise that resolves when indexing is complete
    this.indexingPromise = (async () => {
      try {
        console.log('Building search index...');
        
        // Clear index if rebuilding
        if (forceRebuild) {
          this.clearIndex();
        }
        
        // Index conversations
        const conversations = await this.storage.getConversations();
        for (const conversation of conversations) {
          this.indexConversation(conversation);
        }
        
        // Index messages (batch by conversation for efficiency)
        for (const conversation of conversations) {
          const messages = await this.storage.getMessages(conversation.id);
          for (const message of messages) {
            this.indexMessage(message);
          }
        }
        
        // Update index metadata
        this.lastIndexed = Date.now();
        this.calculateIndexSize();
        
        // Save index
        await this.saveIndex();
        
        console.log(`Search index built with ${this.conversationCount} conversations and ${this.messageCount} messages`);
      } catch (error) {
        console.error('Failed to build search index:', error);
      } finally {
        this.isIndexing = false;
      }
    })();
    
    return this.indexingPromise;
  }
  
  /**
   * Search for conversations
   * @param query Search query
   * @param filter Optional filter criteria
   * @param options Search options
   * @returns Search results
   */
  async searchConversations(
    query: string,
    filter?: ConversationFilter,
    options?: SearchOptions
  ): Promise<ConversationSearchResult[]> {
    // Default options
    const searchOptions: Required<SearchOptions> = {
      limit: options?.limit ?? 50,
      fields: options?.fields ?? ['title', 'messages'],
      fuzzy: options?.fuzzy ?? true,
      minScore: options?.minScore ?? 0,
      includeHighlights: options?.includeHighlights ?? true
    };
    
    // If no query, return all conversations matching filter
    if (!query || query.trim() === '') {
      const conversations = await this.storage.getConversations(filter);
      return conversations.map(conversation => ({
        conversation,
        score: 100,
        matches: []
      })).slice(0, searchOptions.limit);
    }
    
    // Tokenize query
    const queryTerms = this.tokenize(query);
    
    // Search results
    const results: ConversationSearchResult[] = [];
    
    // Search in index
    const scoredIds = new Map<string, number>();
    
    // Calculate scores for each conversation
    for (const term of queryTerms) {
      const termIndex = this.conversationIndex.get(term);
      
      if (termIndex) {
        for (const [id, termFrequency] of termIndex.entries()) {
          // Calculate TF-IDF score
          const score = this.calculateScore(term, termFrequency, this.conversationCount);
          
          // Add to scored IDs
          const currentScore = scoredIds.get(id) || 0;
          scoredIds.set(id, currentScore + score);
        }
      }
      
      // If fuzzy search is enabled, also search for similar terms
      if (searchOptions.fuzzy) {
        for (const [indexTerm, termIndex] of this.conversationIndex.entries()) {
          if (this.isFuzzyMatch(term, indexTerm)) {
            for (const [id, termFrequency] of termIndex.entries()) {
              // Calculate score with fuzzy penalty
              const fuzzyPenalty = 0.5; // Reduce score for fuzzy matches
              const score = this.calculateScore(indexTerm, termFrequency, this.conversationCount) * fuzzyPenalty;
              
              // Add to scored IDs
              const currentScore = scoredIds.get(id) || 0;
              scoredIds.set(id, currentScore + score);
            }
          }
        }
      }
    }
    
    // Normalize scores to 0-100 range
    const maxPossibleScore = queryTerms.length * 10; // Assuming max score of 10 per term
    
    // Get conversations for scored IDs
    for (const [id, score] of scoredIds.entries()) {
      // Skip low-scoring results
      const normalizedScore = Math.min(100, (score / maxPossibleScore) * 100);
      if (normalizedScore < searchOptions.minScore) {
        continue;
      }
      
      try {
        const conversation = await this.storage.getConversation(id);
        
        if (conversation && this.matchesFilter(conversation, filter)) {
          results.push({
            conversation,
            score: normalizedScore,
            matches: searchOptions.includeHighlights ? this.findMatches(conversation, queryTerms) : []
          });
        }
      } catch (error) {
        console.warn(`Failed to retrieve conversation ${id} for search results:`, error);
      }
    }
    
    // Sort by score (descending)
    results.sort((a, b) => b.score - a.score);
    
    // Limit results
    return results.slice(0, searchOptions.limit);
  }
  
  /**
   * Search for messages
   * @param query Search query
   * @param filter Optional filter criteria
   * @param options Search options
   * @returns Search results
   */
  async searchMessages(
    query: string,
    filter?: MessageFilter,
    options?: SearchOptions
  ): Promise<MessageSearchResult[]> {
    // Default options
    const searchOptions: Required<SearchOptions> = {
      limit: options?.limit ?? 100,
      fields: options?.fields ?? ['content'],
      fuzzy: options?.fuzzy ?? true,
      minScore: options?.minScore ?? 0,
      includeHighlights: options?.includeHighlights ?? true
    };
    
    // If no query and filter has conversationId, return all messages for that conversation
    if ((!query || query.trim() === '') && filter?.conversationId) {
      const messages = await this.storage.getMessages(filter.conversationId, filter);
      return messages.map(message => ({
        message,
        score: 100,
        matches: []
      })).slice(0, searchOptions.limit);
    }
    
    // Tokenize query
    const queryTerms = this.tokenize(query);
    
    // Search results
    const results: MessageSearchResult[] = [];
    
    // Search in index
    const scoredIds = new Map<string, number>();
    
    // Calculate scores for each message
    for (const term of queryTerms) {
      const termIndex = this.messageIndex.get(term);
      
      if (termIndex) {
        for (const [id, termFrequency] of termIndex.entries()) {
          // Calculate TF-IDF score
          const score = this.calculateScore(term, termFrequency, this.messageCount);
          
          // Add to scored IDs
          const currentScore = scoredIds.get(id) || 0;
          scoredIds.set(id, currentScore + score);
        }
      }
      
      // If fuzzy search is enabled, also search for similar terms
      if (searchOptions.fuzzy) {
        for (const [indexTerm, termIndex] of this.messageIndex.entries()) {
          if (this.isFuzzyMatch(term, indexTerm)) {
            for (const [id, termFrequency] of termIndex.entries()) {
              // Calculate score with fuzzy penalty
              const fuzzyPenalty = 0.5; // Reduce score for fuzzy matches
              const score = this.calculateScore(indexTerm, termFrequency, this.messageCount) * fuzzyPenalty;
              
              // Add to scored IDs
              const currentScore = scoredIds.get(id) || 0;
              scoredIds.set(id, currentScore + score);
            }
          }
        }
      }
    }
    
    // Normalize scores to 0-100 range
    const maxPossibleScore = queryTerms.length * 10; // Assuming max score of 10 per term
    
    // Get messages for scored IDs
    for (const [id, score] of scoredIds.entries()) {
      // Skip low-scoring results
      const normalizedScore = Math.min(100, (score / maxPossibleScore) * 100);
      if (normalizedScore < searchOptions.minScore) {
        continue;
      }
      
      try {
        const message = await this.storage.getMessage(id);
        
        if (message && this.matchesMessageFilter(message, filter)) {
          results.push({
            message,
            score: normalizedScore,
            matches: searchOptions.includeHighlights ? this.findMessageMatches(message, queryTerms) : []
          });
        }
      } catch (error) {
        console.warn(`Failed to retrieve message ${id} for search results:`, error);
      }
    }
    
    // Sort by score (descending)
    results.sort((a, b) => b.score - a.score);
    
    // Limit results
    return results.slice(0, searchOptions.limit);
  }
  
  /**
   * Get index statistics
   * @returns Index statistics
   */
  getIndexStats(): IndexStats {
    return {
      conversationCount: this.conversationCount,
      messageCount: this.messageCount,
      termCount: this.termFrequency.size,
      lastUpdated: this.lastIndexed,
      indexSize: this.indexSize
    };
  }
  
  /**
   * Update index for a conversation
   * @param conversation The conversation to index
   */
  async updateConversationIndex(conversation: Conversation): Promise<void> {
    // Remove existing index entries for this conversation
    await this.removeConversationFromIndex(conversation.id);
    
    // Add new index entries
    this.indexConversation(conversation);
    
    // Save index
    await this.saveIndex();
  }
  
  /**
   * Update index for a message
   * @param message The message to index
   */
  async updateMessageIndex(message: Message): Promise<void> {
    // Remove existing index entries for this message
    await this.removeMessageFromIndex(message.id);
    
    // Add new index entries
    this.indexMessage(message);
    
    // Save index
    await this.saveIndex();
  }
  
  /**
   * Remove a conversation from the index
   * @param id Conversation ID
   */
  async removeConversationFromIndex(id: string): Promise<void> {
    // Find all terms that reference this conversation
    for (const [term, termIndex] of this.conversationIndex.entries()) {
      if (termIndex.has(id)) {
        // Update document frequency
        const df = this.documentFrequency.get(term) || 0;
        this.documentFrequency.set(term, Math.max(0, df - 1));
        
        // Remove from term index
        termIndex.delete(id);
        
        // If term index is empty, remove it
        if (termIndex.size === 0) {
          this.conversationIndex.delete(term);
          this.termFrequency.delete(term);
        }
      }
    }
    
    // Update conversation count
    this.conversationCount = Math.max(0, this.conversationCount - 1);
    
    // Save index
    await this.saveIndex();
  }
  
  /**
   * Remove a message from the index
   * @param id Message ID
   */
  async removeMessageFromIndex(id: string): Promise<void> {
    // Find all terms that reference this message
    for (const [term, termIndex] of this.messageIndex.entries()) {
      if (termIndex.has(id)) {
        // Update document frequency
        const df = this.documentFrequency.get(term) || 0;
        this.documentFrequency.set(term, Math.max(0, df - 1));
        
        // Remove from term index
        termIndex.delete(id);
        
        // If term index is empty, remove it
        if (termIndex.size === 0) {
          this.messageIndex.delete(term);
          this.termFrequency.delete(term);
        }
      }
    }
    
    // Update message count
    this.messageCount = Math.max(0, this.messageCount - 1);
    
    // Save index
    await this.saveIndex();
  }
  
  // Private helper methods
  
  /**
   * Schedule periodic indexing
   */
  private scheduleIndexing(): void {
    // Schedule initial indexing
    setTimeout(() => {
      this.buildIndex().catch(error => {
        console.error('Scheduled indexing failed:', error);
      });
      
      // Schedule periodic reindexing (every 30 minutes)
      setInterval(() => {
        this.buildIndex().catch(error => {
          console.error('Scheduled indexing failed:', error);
        });
      }, 30 * 60 * 1000);
    }, 5000); // Start after 5 seconds to allow extension to initialize
  }
  
  /**
   * Clear the index
   */
  private clearIndex(): void {
    this.conversationIndex.clear();
    this.messageIndex.clear();
    this.termFrequency.clear();
    this.documentFrequency.clear();
    this.conversationCount = 0;
    this.messageCount = 0;
  }
  
  /**
   * Calculate the size of the index
   */
  private calculateIndexSize(): void {
    let size = 0;
    
    // Estimate size of conversation index
    for (const [term, termIndex] of this.conversationIndex.entries()) {
      size += term.length * 2; // Term string
      size += 8; // Map overhead
      size += termIndex.size * 16; // Map entries (8 bytes key + 8 bytes value)
    }
    
    // Estimate size of message index
    for (const [term, termIndex] of this.messageIndex.entries()) {
      size += term.length * 2; // Term string
      size += 8; // Map overhead
      size += termIndex.size * 16; // Map entries (8 bytes key + 8 bytes value)
    }
    
    // Estimate size of term frequency map
    size += this.termFrequency.size * 24; // Map entries (term string + number)
    
    // Estimate size of document frequency map
    size += this.documentFrequency.size * 24; // Map entries (term string + number)
    
    this.indexSize = size;
  }
  
  /**
   * Index a conversation
   * @param conversation The conversation to index
   */
  private indexConversation(conversation: Conversation): void {
    // Skip if already indexed
    const alreadyIndexed = Array.from(this.conversationIndex.values()).some(termIndex => termIndex.has(conversation.id));
    if (alreadyIndexed) {
      return;
    }
    
    // Index title
    const titleTerms = this.tokenize(conversation.title);
    for (const term of titleTerms) {
      this.addTermToConversationIndex(term, conversation.id, 2); // Title terms have higher weight
    }
    
    // Update conversation count
    this.conversationCount++;
  }
  
  /**
   * Index a message
   * @param message The message to index
   */
  private indexMessage(message: Message): void {
    // Skip if already indexed
    const alreadyIndexed = Array.from(this.messageIndex.values()).some(termIndex => termIndex.has(message.id));
    if (alreadyIndexed) {
      return;
    }
    
    // Index content
    const contentTerms = this.tokenize(message.content);
    for (const term of contentTerms) {
      this.addTermToMessageIndex(term, message.id, 1);
    }
    
    // Index code changes
    if (Array.isArray(message.codeChanges)) {
      for (const change of message.codeChanges) {
        // Index file path
        const pathTerms = this.tokenize(change.filePath);
        for (const term of pathTerms) {
          this.addTermToMessageIndex(term, message.id, 0.5);
        }
        
        // Index content (with lower weight)
        if (change.afterContent) {
          const codeTerms = this.tokenize(change.afterContent);
          for (const term of codeTerms) {
            this.addTermToMessageIndex(term, message.id, 0.2);
          }
        }
      }
    }
    
    // Update message count
    this.messageCount++;
  }
  
  /**
   * Add a term to the conversation index
   * @param term The term to add
   * @param id Conversation ID
   * @param weight Term weight
   */
  private addTermToConversationIndex(term: string, id: string, weight: number): void {
    // Skip short terms
    if (term.length < 2) {
      return;
    }
    
    // Get or create term index
    let termIndex = this.conversationIndex.get(term);
    if (!termIndex) {
      termIndex = new Map();
      this.conversationIndex.set(term, termIndex);
    }
    
    // Add to term index
    const currentFreq = termIndex.get(id) || 0;
    termIndex.set(id, currentFreq + weight);
    
    // Update term frequency
    const tf = this.termFrequency.get(term) || 0;
    this.termFrequency.set(term, tf + weight);
    
    // Update document frequency if this is the first occurrence in this document
    if (currentFreq === 0) {
      const df = this.documentFrequency.get(term) || 0;
      this.documentFrequency.set(term, df + 1);
    }
  }
  
  /**
   * Add a term to the message index
   * @param term The term to add
   * @param id Message ID
   * @param weight Term weight
   */
  private addTermToMessageIndex(term: string, id: string, weight: number): void {
    // Skip short terms
    if (term.length < 2) {
      return;
    }
    
    // Get or create term index
    let termIndex = this.messageIndex.get(term);
    if (!termIndex) {
      termIndex = new Map();
      this.messageIndex.set(term, termIndex);
    }
    
    // Add to term index
    const currentFreq = termIndex.get(id) || 0;
    termIndex.set(id, currentFreq + weight);
    
    // Update term frequency
    const tf = this.termFrequency.get(term) || 0;
    this.termFrequency.set(term, tf + weight);
    
    // Update document frequency if this is the first occurrence in this document
    if (currentFreq === 0) {
      const df = this.documentFrequency.get(term) || 0;
      this.documentFrequency.set(term, df + 1);
    }
  }
  
  /**
   * Tokenize text into terms
   * @param text Text to tokenize
   * @returns Array of terms
   */
  private tokenize(text: string): string[] {
    if (!text) {
      return [];
    }
    
    // Convert to lowercase
    const lowerText = text.toLowerCase();
    
    // Split into words
    const words = lowerText.split(/\s+/);
    
    // Filter and normalize
    return words
      .map(word => word.replace(/[^\w\d]/g, '')) // Remove non-alphanumeric chars
      .filter(word => word.length >= 2); // Skip short words
  }
  
  /**
   * Calculate TF-IDF score for a term
   * @param term The term
   * @param termFrequency Term frequency in document
   * @param documentCount Total number of documents
   * @returns TF-IDF score
   */
  private calculateScore(term: string, termFrequency: number, documentCount: number): number {
    // Get document frequency (number of documents containing this term)
    const df = this.documentFrequency.get(term) || 1;
    
    // Calculate inverse document frequency
    const idf = Math.log(documentCount / df);
    
    // Calculate TF-IDF score
    return termFrequency * idf;
  }
  
  /**
   * Check if two terms match with fuzzy matching
   * @param term1 First term
   * @param term2 Second term
   * @returns Whether the terms match
   */
  private isFuzzyMatch(term1: string, term2: string): boolean {
    // Exact match
    if (term1 === term2) {
      return true;
    }
    
    // Length difference too large
    if (Math.abs(term1.length - term2.length) > 2) {
      return false;
    }
    
    // Check if term1 is prefix of term2
    if (term2.startsWith(term1)) {
      return true;
    }
    
    // Check if term2 is prefix of term1
    if (term1.startsWith(term2)) {
      return true;
    }
    
    // Check edit distance (Levenshtein distance)
    const distance = this.levenshteinDistance(term1, term2);
    
    // Allow distance of 1 for terms up to 5 chars, 2 for longer terms
    const maxDistance = term1.length <= 5 ? 1 : 2;
    
    return distance <= maxDistance;
  }
  
  /**
   * Calculate Levenshtein distance between two strings
   * @param s1 First string
   * @param s2 Second string
   * @returns Edit distance
   */
  private levenshteinDistance(s1: string, s2: string): number {
    // Create matrix
    const matrix: number[][] = [];
    
    // Initialize first row
    for (let i = 0; i <= s2.length; i++) {
      matrix[0] = matrix[0] || [];
      matrix[0][i] = i;
    }
    
    // Initialize first column
    for (let i = 0; i <= s1.length; i++) {
      matrix[i] = matrix[i] || [];
      matrix[i][0] = i;
    }
    
    // Fill matrix
    for (let i = 1; i <= s1.length; i++) {
      for (let j = 1; j <= s2.length; j++) {
        if (s1[i - 1] === s2[j - 1]) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // Substitution
            matrix[i][j - 1] + 1,     // Insertion
            matrix[i - 1][j] + 1      // Deletion
          );
        }
      }
    }
    
    return matrix[s1.length][s2.length];
  }
  
  /**
   * Find matches for query terms in a conversation
   * @param conversation The conversation
   * @param queryTerms Query terms
   * @returns Matches
   */
  private findMatches(conversation: Conversation, queryTerms: string[]): ConversationSearchResult['matches'] {
    const matches: ConversationSearchResult['matches'] = [];
    
    // Check title
    const titleLower = conversation.title.toLowerCase();
    for (const term of queryTerms) {
      let pos = titleLower.indexOf(term);
      while (pos !== -1) {
        matches.push({
          field: 'title',
          text: conversation.title,
          positions: [{ start: pos, end: pos + term.length }]
        });
        pos = titleLower.indexOf(term, pos + 1);
      }
    }
    
    return matches;
  }
  
  /**
   * Find matches for query terms in a message
   * @param message The message
   * @param queryTerms Query terms
   * @returns Matches
   */
  private findMessageMatches(message: Message, queryTerms: string[]): MessageSearchResult['matches'] {
    const matches: MessageSearchResult['matches'] = [];
    
    // Check content
    const contentLower = message.content.toLowerCase();
    for (const term of queryTerms) {
      let pos = contentLower.indexOf(term);
      while (pos !== -1) {
        matches.push({
          field: 'content',
          text: message.content.substring(Math.max(0, pos - 20), Math.min(message.content.length, pos + term.length + 20)),
          positions: [{ start: Math.min(20, pos), end: Math.min(20, pos) + term.length }]
        });
        pos = contentLower.indexOf(term, pos + 1);
      }
    }
    
    // Check code changes
    if (Array.isArray(message.codeChanges)) {
      for (let i = 0; i < message.codeChanges.length; i++) {
        const change = message.codeChanges[i];
        
        // Check file path
        const pathLower = change.filePath.toLowerCase();
        for (const term of queryTerms) {
          let pos = pathLower.indexOf(term);
          while (pos !== -1) {
            matches.push({
              field: `codeChanges[${i}].filePath`,
              text: change.filePath,
              positions: [{ start: pos, end: pos + term.length }]
            });
            pos = pathLower.indexOf(term, pos + 1);
          }
        }
        
        // Check content
        if (change.afterContent) {
          const contentLower = change.afterContent.toLowerCase();
          for (const term of queryTerms) {
            let pos = contentLower.indexOf(term);
            while (pos !== -1) {
              // Get context around match
              const start = Math.max(0, pos - 20);
              const end = Math.min(change.afterContent.length, pos + term.length + 20);
              const context = change.afterContent.substring(start, end);
              
              matches.push({
                field: `codeChanges[${i}].afterContent`,
                text: context,
                positions: [{ start: pos - start, end: pos - start + term.length }]
              });
              pos = contentLower.indexOf(term, pos + 1);
            }
          }
        }
      }
    }
    
    return matches;
  }
  
  /**
   * Check if a conversation matches the filter criteria
   * @param conversation The conversation to check
   * @param filter Filter criteria
   * @returns Whether the conversation matches the filter
   */
  private matchesFilter(conversation: Conversation, filter?: ConversationFilter): boolean {
    if (!filter) {
      return true;
    }
    
    // Check status
    if (filter.status && filter.status !== 'all') {
      if (conversation.status !== filter.status) {
        return false;
      }
    }
    
    // Check tags
    if (filter.tags && filter.tags.length > 0) {
      const conversationTags = conversation.metadata?.tags || [];
      
      // Check if conversation has at least one of the filter tags
      if (!filter.tags.some(tag => conversationTags.includes(tag))) {
        return false;
      }
    }
    
    // Check date range
    if (filter.dateRange) {
      if (conversation.timestamp < filter.dateRange.start || conversation.timestamp > filter.dateRange.end) {
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Check if a message matches the filter criteria
   * @param message The message to check
   * @param filter Filter criteria
   * @returns Whether the message matches the filter
   */
  private matchesMessageFilter(message: Message, filter?: MessageFilter): boolean {
    if (!filter) {
      return true;
    }
    
    // Check conversation ID
    if (filter.conversationId && message.conversationId !== filter.conversationId) {
      return false;
    }
    
    // Check sender
    if (filter.sender && filter.sender !== 'all' && message.sender !== filter.sender) {
      return false;
    }
    
    // Check if has code changes
    if (filter.hasCodeChanges !== undefined) {
      const hasChanges = Array.isArray(message.codeChanges) && message.codeChanges.length > 0;
      
      if (filter.hasCodeChanges !== hasChanges) {
        return false;
      }
    }
    
    // Check date range
    if (filter.dateRange) {
      if (message.timestamp < filter.dateRange.start || message.timestamp > filter.dateRange.end) {
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Save the index to disk
   */
  private async saveIndex(): Promise<void> {
    try {
      const indexDir = path.join(this.context.globalStorageUri.fsPath, 'cursor-companion', 'indexes');
      
      // Ensure directory exists
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(indexDir));
      } catch {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(indexDir));
      }
      
      // Save conversation index
      const conversationIndexPath = path.join(indexDir, 'conversation-index.json');
      const conversationIndexData = this.serializeIndex(this.conversationIndex);
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(conversationIndexPath),
        Buffer.from(conversationIndexData, 'utf8')
      );
      
      // Save message index
      const messageIndexPath = path.join(indexDir, 'message-index.json');
      const messageIndexData = this.serializeIndex(this.messageIndex);
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(messageIndexPath),
        Buffer.from(messageIndexData, 'utf8')
      );
      
      // Save term frequency
      const termFrequencyPath = path.join(indexDir, 'term-frequency.json');
      const termFrequencyData = JSON.stringify(Array.from(this.termFrequency.entries()));
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(termFrequencyPath),
        Buffer.from(termFrequencyData, 'utf8')
      );
      
      // Save document frequency
      const documentFrequencyPath = path.join(indexDir, 'document-frequency.json');
      const documentFrequencyData = JSON.stringify(Array.from(this.documentFrequency.entries()));
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(documentFrequencyPath),
        Buffer.from(documentFrequencyData, 'utf8')
      );
      
      // Save metadata
      const metadataPath = path.join(indexDir, 'index-metadata.json');
      const metadata = {
        conversationCount: this.conversationCount,
        messageCount: this.messageCount,
        termCount: this.termFrequency.size,
        lastUpdated: Date.now(),
        version: '1.0.0'
      };
      
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(metadataPath),
        Buffer.from(JSON.stringify(metadata, null, 2), 'utf8')
      );
    } catch (error) {
      console.error('Failed to save search index:', error);
    }
  }
  
  /**
   * Load the index from disk
   */
  private async loadIndex(): Promise<void> {
    try {
      const indexDir = path.join(this.context.globalStorageUri.fsPath, 'cursor-companion', 'indexes');
      
      // Check if index exists
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(indexDir));
      } catch {
        // Index doesn't exist yet
        return;
      }
      
      // Load metadata
      const metadataPath = path.join(indexDir, 'index-metadata.json');
      try {
        const metadataData = await vscode.workspace.fs.readFile(vscode.Uri.file(metadataPath));
        const metadata = JSON.parse(metadataData.toString());
        
        this.conversationCount = metadata.conversationCount || 0;
        this.messageCount = metadata.messageCount || 0;
        this.lastIndexed = metadata.lastUpdated || 0;
      } catch {
        // Metadata doesn't exist yet
      }
      
      // Load conversation index
      const conversationIndexPath = path.join(indexDir, 'conversation-index.json');
      try {
        const conversationIndexData = await vscode.workspace.fs.readFile(vscode.Uri.file(conversationIndexPath));
        this.conversationIndex = this.deserializeIndex(conversationIndexData.toString());
      } catch {
        // Conversation index doesn't exist yet
      }
      
      // Load message index
      const messageIndexPath = path.join(indexDir, 'message-index.json');
      try {
        const messageIndexData = await vscode.workspace.fs.readFile(vscode.Uri.file(messageIndexPath));
        this.messageIndex = this.deserializeIndex(messageIndexData.toString());
      } catch {
        // Message index doesn't exist yet
      }
      
      // Load term frequency
      const termFrequencyPath = path.join(indexDir, 'term-frequency.json');
      try {
        const termFrequencyData = await vscode.workspace.fs.readFile(vscode.Uri.file(termFrequencyPath));
        this.termFrequency = new Map(JSON.parse(termFrequencyData.toString()));
      } catch {
        // Term frequency doesn't exist yet
      }
      
      // Load document frequency
      const documentFrequencyPath = path.join(indexDir, 'document-frequency.json');
      try {
        const documentFrequencyData = await vscode.workspace.fs.readFile(vscode.Uri.file(documentFrequencyPath));
        this.documentFrequency = new Map(JSON.parse(documentFrequencyData.toString()));
      } catch {
        // Document frequency doesn't exist yet
      }
      
      // Calculate index size
      this.calculateIndexSize();
      
      console.log(`Loaded search index with ${this.conversationCount} conversations and ${this.messageCount} messages`);
    } catch (error) {
      console.error('Failed to load search index:', error);
      
      // Reset index
      this.clearIndex();
    }
  }
  
  /**
   * Serialize an index to JSON
   * @param index The index to serialize
   * @returns JSON string
   */
  private serializeIndex(index: Map<string, Map<string, number>>): string {
    const serialized: Record<string, Record<string, number>> = {};
    
    for (const [term, termIndex] of index.entries()) {
      serialized[term] = Object.fromEntries(termIndex);
    }
    
    return JSON.stringify(serialized);
  }
  
  /**
   * Deserialize an index from JSON
   * @param json JSON string
   * @returns Deserialized index
   */
  private deserializeIndex(json: string): Map<string, Map<string, number>> {
    const deserialized = new Map<string, Map<string, number>>();
    const parsed = JSON.parse(json) as Record<string, Record<string, number>>;
    
    for (const [term, termIndex] of Object.entries(parsed)) {
      deserialized.set(term, new Map(Object.entries(termIndex)));
    }
    
    return deserialized;
  }
}