import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { IDataStorage } from './interfaces';
import { ErrorHandler, ErrorSeverity } from './errorHandler';
import { DiagnosticInfo } from '../models/errors';

/**
 * Manages diagnostic information collection and debugging features
 */
export class DiagnosticManager {
  private static instance: DiagnosticManager;
  private readonly activityLog: ActivityLogEntry[] = [];
  private readonly maxActivityLogSize = 500;
  private performanceMetrics: PerformanceMetrics = {
    operationTimes: new Map(),
    memoryUsage: [],
    errorCounts: new Map()
  };

  private constructor(
    private context: vscode.ExtensionContext,
    private dataStorage: IDataStorage,
    private errorHandler: ErrorHandler
  ) {
    this.startPerformanceMonitoring();
  }

  public static getInstance(
    context: vscode.ExtensionContext,
    dataStorage: IDataStorage,
    errorHandler: ErrorHandler
  ): DiagnosticManager {
    if (!DiagnosticManager.instance) {
      DiagnosticManager.instance = new DiagnosticManager(context, dataStorage, errorHandler);
    }
    return DiagnosticManager.instance;
  }

  /**
   * Collect comprehensive diagnostic information
   */
  async collectDiagnosticInfo(): Promise<DiagnosticInfo> {
    const packageJson = await this.getPackageInfo();
    const systemInfo = this.getSystemInfo();
    const extensionState = await this.getExtensionState();
    const recentActivity = this.getRecentActivity();
    const config = this.getConfiguration();

    return {
      version: packageJson.version || 'unknown',
      vscodeVersion: vscode.version,
      system: systemInfo,
      state: extensionState,
      config,
      recentActivity
    };
  }

  /**
   * Generate a comprehensive diagnostic report
   */
  async generateDiagnosticReport(): Promise<string> {
    const diagnosticInfo = await this.collectDiagnosticInfo();
    const errorStats = this.errorHandler.getErrorStatistics();
    const performanceReport = this.generatePerformanceReport();

    const report = [
      '# Cursor Companion Diagnostic Report',
      `Generated: ${new Date().toISOString()}`,
      '',
      '## Extension Information',
      `- Version: ${diagnosticInfo.version}`,
      `- VSCode Version: ${diagnosticInfo.vscodeVersion}`,
      '',
      '## System Information',
      `- Platform: ${diagnosticInfo.system.platform}`,
      `- Architecture: ${diagnosticInfo.system.arch}`,
      `- Node Version: ${diagnosticInfo.system.nodeVersion}`,
      `- Memory: ${this.formatBytes(os.totalmem())} total, ${this.formatBytes(os.freemem())} free`,
      `- CPU: ${os.cpus()[0]?.model || 'Unknown'} (${os.cpus().length} cores)`,
      '',
      '## Extension State',
      `- Tracking Active: ${diagnosticInfo.state.isTracking}`,
      `- Conversation Count: ${diagnosticInfo.state.conversationCount}`,
      `- Last Error: ${diagnosticInfo.state.lastError ? 
        `${diagnosticInfo.state.lastError.message} (${new Date(diagnosticInfo.state.lastError.timestamp).toLocaleString()})` : 
        'None'}`,
      '',
      '## Error Statistics',
      `- Total Errors: ${errorStats.totalErrors}`,
      `- Errors (24h): ${errorStats.errorsLast24Hours}`,
      `- Errors (7d): ${errorStats.errorsLastWeek}`,
      `- Recovery Rate: ${errorStats.recoverySuccessRate}%`,
      `- Most Common: ${errorStats.mostCommonError}`,
      '',
      '### Errors by Category',
      ...Object.entries(errorStats.errorsByCategory).map(([category, count]) => 
        `- ${category}: ${count}`
      ),
      '',
      '## Performance Metrics',
      performanceReport,
      '',
      '## Configuration',
      '```json',
      JSON.stringify(diagnosticInfo.config, null, 2),
      '```',
      '',
      '## Recent Activity',
      ...diagnosticInfo.recentActivity.slice(-20).map(activity => 
        `- ${new Date(activity.timestamp).toLocaleString()}: ${activity.action} (${activity.success ? 'Success' : 'Failed'})`
      ),
      '',
      '## Workspace Information',
      `- Workspace Folders: ${vscode.workspace.workspaceFolders?.length || 0}`,
      `- Active Editor: ${vscode.window.activeTextEditor?.document.fileName || 'None'}`,
      `- Visible Editors: ${vscode.window.visibleTextEditors.length}`,
      '',
      '## Extension Storage',
      await this.getStorageInfo()
    ].join('\n');

    return report;
  }

  /**
   * Log an activity for debugging purposes
   */
  logActivity(action: string, success: boolean, details?: any): void {
    const entry: ActivityLogEntry = {
      timestamp: Date.now(),
      action,
      success,
      details
    };

    this.activityLog.push(entry);

    // Keep log size manageable
    if (this.activityLog.length > this.maxActivityLogSize) {
      this.activityLog.splice(0, this.activityLog.length - this.maxActivityLogSize);
    }

    // Save to context for persistence
    this.saveActivityLog();
  }

  /**
   * Start performance monitoring for an operation
   */
  startPerformanceTimer(operationName: string): PerformanceTimer {
    const startTime = Date.now();
    const startMemory = process.memoryUsage();

    return {
      end: () => {
        const endTime = Date.now();
        const endMemory = process.memoryUsage();
        const duration = endTime - startTime;

        // Record operation time
        const times = this.performanceMetrics.operationTimes.get(operationName) || [];
        times.push(duration);
        this.performanceMetrics.operationTimes.set(operationName, times);

        // Record memory usage
        this.performanceMetrics.memoryUsage.push({
          timestamp: endTime,
          heapUsed: endMemory.heapUsed,
          heapTotal: endMemory.heapTotal,
          external: endMemory.external
        });

        // Keep memory usage history manageable
        if (this.performanceMetrics.memoryUsage.length > 1000) {
          this.performanceMetrics.memoryUsage.splice(0, 500);
        }

        this.logActivity(`Performance: ${operationName}`, true, {
          duration,
          memoryDelta: endMemory.heapUsed - startMemory.heapUsed
        });

        return duration;
      }
    };
  }

  /**
   * Record an error for performance tracking
   */
  recordError(errorType: string): void {
    const count = this.performanceMetrics.errorCounts.get(errorType) || 0;
    this.performanceMetrics.errorCounts.set(errorType, count + 1);
  }

  /**
   * Export diagnostic data for support
   */
  async exportDiagnosticData(): Promise<string> {
    const diagnosticInfo = await this.collectDiagnosticInfo();
    const errorLog = await this.errorHandler.exportErrorLog();
    const performanceData = this.exportPerformanceData();

    const exportData = {
      timestamp: new Date().toISOString(),
      diagnostic: diagnosticInfo,
      errors: JSON.parse(errorLog),
      performance: performanceData,
      activityLog: this.activityLog.slice(-100) // Last 100 activities
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Show diagnostic information in a new document
   */
  async showDiagnosticReport(): Promise<void> {
    const report = await this.generateDiagnosticReport();
    
    const document = await vscode.workspace.openTextDocument({
      content: report,
      language: 'markdown'
    });

    await vscode.window.showTextDocument(document);
  }

  /**
   * Run system health check
   */
  async runHealthCheck(): Promise<HealthCheckResult> {
    const results: HealthCheckItem[] = [];

    // Check storage accessibility
    try {
      await this.dataStorage.initialize();
      results.push({
        name: 'Storage Access',
        status: 'pass',
        message: 'Storage is accessible'
      });
    } catch (error) {
      results.push({
        name: 'Storage Access',
        status: 'fail',
        message: `Storage error: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }

    // Check memory usage
    const memoryUsage = process.memoryUsage();
    const memoryUsageMB = memoryUsage.heapUsed / 1024 / 1024;
    results.push({
      name: 'Memory Usage',
      status: memoryUsageMB < 100 ? 'pass' : memoryUsageMB < 200 ? 'warning' : 'fail',
      message: `${memoryUsageMB.toFixed(2)} MB used`
    });

    // Check error rate
    const errorStats = this.errorHandler.getErrorStatistics();
    const recentErrorRate = errorStats.errorsLast24Hours;
    results.push({
      name: 'Error Rate',
      status: recentErrorRate < 5 ? 'pass' : recentErrorRate < 20 ? 'warning' : 'fail',
      message: `${recentErrorRate} errors in last 24 hours`
    });

    // Check workspace state
    const workspaceOk = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0;
    results.push({
      name: 'Workspace',
      status: workspaceOk ? 'pass' : 'warning',
      message: workspaceOk ? 'Workspace folder available' : 'No workspace folder'
    });

    // Check performance
    const avgOperationTime = this.getAverageOperationTime();
    results.push({
      name: 'Performance',
      status: avgOperationTime < 100 ? 'pass' : avgOperationTime < 500 ? 'warning' : 'fail',
      message: `Average operation time: ${avgOperationTime.toFixed(2)}ms`
    });

    const overallStatus = results.some(r => r.status === 'fail') ? 'fail' :
                         results.some(r => r.status === 'warning') ? 'warning' : 'pass';

    return {
      overall: overallStatus,
      timestamp: Date.now(),
      results
    };
  }

  /**
   * Show health check results
   */
  async showHealthCheck(): Promise<void> {
    const healthCheck = await this.runHealthCheck();
    
    const statusIcon = {
      pass: '✅',
      warning: '⚠️',
      fail: '❌'
    };

    const report = [
      `# System Health Check`,
      ``,
      `**Overall Status:** ${statusIcon[healthCheck.overall]} ${healthCheck.overall.toUpperCase()}`,
      `**Timestamp:** ${new Date(healthCheck.timestamp).toLocaleString()}`,
      ``,
      `## Results`,
      ``,
      ...healthCheck.results.map(result => 
        `- ${statusIcon[result.status]} **${result.name}**: ${result.message}`
      )
    ].join('\n');

    const document = await vscode.workspace.openTextDocument({
      content: report,
      language: 'markdown'
    });

    await vscode.window.showTextDocument(document);
  }

  private async getPackageInfo(): Promise<any> {
    try {
      const packagePath = path.join(this.context.extensionPath, 'package.json');
      const packageContent = await vscode.workspace.fs.readFile(vscode.Uri.file(packagePath));
      return JSON.parse(packageContent.toString());
    } catch (error) {
      return { version: 'unknown' };
    }
  }

  private getSystemInfo() {
    return {
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version
    };
  }

  private async getExtensionState() {
    try {
      const conversations = await this.dataStorage.getConversations();
      const lastError = this.context.globalState.get<any>('lastError');

      return {
        isTracking: true, // This would come from conversation tracker
        conversationCount: conversations.length,
        lastError
      };
    } catch (error) {
      return {
        isTracking: false,
        conversationCount: 0,
        lastError: {
          message: error instanceof Error ? error.message : 'Unknown error',
          timestamp: Date.now()
        }
      };
    }
  }

  private getRecentActivity() {
    return this.activityLog.slice(-50).map(entry => ({
      action: entry.action,
      timestamp: entry.timestamp,
      success: entry.success
    }));
  }

  private getConfiguration() {
    const config = vscode.workspace.getConfiguration('cursor-companion');
    return {
      // Add configuration options here as they're implemented
      autoTrack: config.get('autoTrack', true),
      maxConversations: config.get('maxConversations', 1000),
      snapshotRetention: config.get('snapshotRetention', 30)
    };
  }

  private async getStorageInfo(): Promise<string> {
    try {
      const storageUri = this.context.globalStorageUri;
      const entries = await vscode.workspace.fs.readDirectory(storageUri);
      
      let totalSize = 0;
      const fileInfo: string[] = [];

      for (const [name, type] of entries) {
        if (type === vscode.FileType.File) {
          try {
            const fileUri = vscode.Uri.joinPath(storageUri, name);
            const stat = await vscode.workspace.fs.stat(fileUri);
            totalSize += stat.size;
            fileInfo.push(`- ${name}: ${this.formatBytes(stat.size)}`);
          } catch (error) {
            fileInfo.push(`- ${name}: Error reading file`);
          }
        } else if (type === vscode.FileType.Directory) {
          fileInfo.push(`- ${name}/: Directory`);
        }
      }

      return [
        `Total Size: ${this.formatBytes(totalSize)}`,
        `Files:`,
        ...fileInfo
      ].join('\n');
    } catch (error) {
      return `Storage info unavailable: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  private generatePerformanceReport(): string {
    const lines: string[] = [];

    // Operation times
    if (this.performanceMetrics.operationTimes.size > 0) {
      lines.push('### Operation Times');
      this.performanceMetrics.operationTimes.forEach((times, operation) => {
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        const min = Math.min(...times);
        const max = Math.max(...times);
        lines.push(`- ${operation}: avg ${avg.toFixed(2)}ms, min ${min}ms, max ${max}ms (${times.length} samples)`);
      });
      lines.push('');
    }

    // Memory usage trend
    if (this.performanceMetrics.memoryUsage.length > 0) {
      const recent = this.performanceMetrics.memoryUsage.slice(-10);
      const avgMemory = recent.reduce((sum, entry) => sum + entry.heapUsed, 0) / recent.length;
      lines.push('### Memory Usage');
      lines.push(`- Average (last 10): ${this.formatBytes(avgMemory)}`);
      lines.push(`- Current: ${this.formatBytes(process.memoryUsage().heapUsed)}`);
      lines.push('');
    }

    // Error counts
    if (this.performanceMetrics.errorCounts.size > 0) {
      lines.push('### Error Counts');
      this.performanceMetrics.errorCounts.forEach((count, errorType) => {
        lines.push(`- ${errorType}: ${count}`);
      });
    }

    return lines.join('\n');
  }

  private exportPerformanceData() {
    return {
      operationTimes: Object.fromEntries(this.performanceMetrics.operationTimes),
      memoryUsage: this.performanceMetrics.memoryUsage.slice(-100),
      errorCounts: Object.fromEntries(this.performanceMetrics.errorCounts)
    };
  }

  private getAverageOperationTime(): number {
    let totalTime = 0;
    let totalOperations = 0;

    this.performanceMetrics.operationTimes.forEach(times => {
      totalTime += times.reduce((a, b) => a + b, 0);
      totalOperations += times.length;
    });

    return totalOperations > 0 ? totalTime / totalOperations : 0;
  }

  private startPerformanceMonitoring(): void {
    // Monitor memory usage periodically
    setInterval(() => {
      const memoryUsage = process.memoryUsage();
      this.performanceMetrics.memoryUsage.push({
        timestamp: Date.now(),
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
        external: memoryUsage.external
      });

      // Keep memory usage history manageable
      if (this.performanceMetrics.memoryUsage.length > 1000) {
        this.performanceMetrics.memoryUsage.splice(0, 500);
      }
    }, 60000); // Every minute
  }

  private async saveActivityLog(): Promise<void> {
    try {
      await this.context.globalState.update('activityLog', this.activityLog.slice(-100));
    } catch (error) {
      console.warn('Failed to save activity log:', error);
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

// Types and interfaces

export interface ActivityLogEntry {
  timestamp: number;
  action: string;
  success: boolean;
  details?: any;
}

export interface PerformanceMetrics {
  operationTimes: Map<string, number[]>;
  memoryUsage: MemoryUsageEntry[];
  errorCounts: Map<string, number>;
}

export interface MemoryUsageEntry {
  timestamp: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
}

export interface PerformanceTimer {
  end(): number;
}

export interface HealthCheckResult {
  overall: 'pass' | 'warning' | 'fail';
  timestamp: number;
  results: HealthCheckItem[];
}

export interface HealthCheckItem {
  name: string;
  status: 'pass' | 'warning' | 'fail';
  message: string;
}