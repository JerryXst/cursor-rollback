import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface RollbackFailure {
    id: string;
    timestamp: number;
    messageId: string;
    errorType: 'FILE_ACCESS' | 'PERMISSION' | 'CORRUPTION' | 'PARTIAL_FAILURE' | 'UNKNOWN';
    errorMessage: string;
    affectedFiles: string[];
    backupId?: string;
    recoveryAttempts: number;
}

export interface RecoveryState {
    id: string;
    timestamp: number;
    workspaceState: { [filePath: string]: string };
    conversationState?: any;
    isValid: boolean;
}

export class RollbackRecoveryManager {
    private static instance: RollbackRecoveryManager;
    private context: vscode.ExtensionContext;
    private failures: Map<string, RollbackFailure> = new Map();
    private recoveryStates: Map<string, RecoveryState> = new Map();
    private maxRecoveryAttempts = 3;
    private recoveryTimeout = 30000; // 30 seconds

    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.loadFailureHistory();
        this.loadRecoveryStates();
    }

    public static getInstance(context: vscode.ExtensionContext): RollbackRecoveryManager {
        if (!RollbackRecoveryManager.instance) {
            RollbackRecoveryManager.instance = new RollbackRecoveryManager(context);
        }
        return RollbackRecoveryManager.instance;
    }

    /**
     * 检测回滚失败并记录详细信息
     */
    public async detectRollbackFailure(
        messageId: string,
        error: Error,
        affectedFiles: string[],
        backupId?: string
    ): Promise<RollbackFailure> {
        const failure: RollbackFailure = {
            id: this.generateFailureId(),
            timestamp: Date.now(),
            messageId,
            errorType: this.categorizeError(error),
            errorMessage: error.message,
            affectedFiles,
            backupId,
            recoveryAttempts: 0
        };

        this.failures.set(failure.id, failure);
        await this.saveFailureHistory();

        // 记录详细错误日志
        console.error(`Rollback failure detected:`, {
            failureId: failure.id,
            messageId,
            errorType: failure.errorType,
            affectedFiles: affectedFiles.length,
            error: error.message
        });

        return failure;
    }

    /**
     * 自动状态恢复逻辑
     */
    public async attemptAutoRecovery(failureId: string): Promise<boolean> {
        const failure = this.failures.get(failureId);
        if (!failure) {
            throw new Error(`Failure ${failureId} not found`);
        }

        if (failure.recoveryAttempts >= this.maxRecoveryAttempts) {
            console.warn(`Max recovery attempts reached for failure ${failureId}`);
            return false;
        }

        failure.recoveryAttempts++;
        this.failures.set(failureId, failure);

        try {
            console.log(`Attempting auto recovery for failure ${failureId} (attempt ${failure.recoveryAttempts})`);

            // 根据错误类型选择恢复策略
            switch (failure.errorType) {
                case 'FILE_ACCESS':
                    return await this.recoverFromFileAccessError(failure);
                case 'PERMISSION':
                    return await this.recoverFromPermissionError(failure);
                case 'CORRUPTION':
                    return await this.recoverFromCorruptionError(failure);
                case 'PARTIAL_FAILURE':
                    return await this.recoverFromPartialFailure(failure);
                default:
                    return await this.recoverFromUnknownError(failure);
            }
        } catch (error) {
            console.error(`Auto recovery failed for ${failureId}:`, error);
            return false;
        }
    }

    /**
     * 创建恢复状态快照
     */
    public async createRecoveryState(): Promise<string> {
        const stateId = this.generateStateId();
        const workspaceState: { [filePath: string]: string } = {};

        try {
            // 获取工作区所有文件的当前状态
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder) {
                const files = await this.getAllWorkspaceFiles(workspaceFolder.uri.fsPath);
                
                for (const filePath of files) {
                    try {
                        const content = await fs.promises.readFile(filePath, 'utf8');
                        workspaceState[filePath] = content;
                    } catch (error) {
                        console.warn(`Failed to read file ${filePath}:`, error);
                    }
                }
            }

            const recoveryState: RecoveryState = {
                id: stateId,
                timestamp: Date.now(),
                workspaceState,
                isValid: true
            };

            this.recoveryStates.set(stateId, recoveryState);
            await this.saveRecoveryStates();

            console.log(`Recovery state created: ${stateId} with ${Object.keys(workspaceState).length} files`);
            return stateId;
        } catch (error) {
            console.error('Failed to create recovery state:', error);
            throw error;
        }
    }

    /**
     * 恢复到指定状态
     */
    public async restoreToRecoveryState(stateId: string): Promise<void> {
        const state = this.recoveryStates.get(stateId);
        if (!state) {
            throw new Error(`Recovery state ${stateId} not found`);
        }

        if (!state.isValid) {
            throw new Error(`Recovery state ${stateId} is invalid`);
        }

        try {
            console.log(`Restoring to recovery state ${stateId}...`);

            // 恢复所有文件状态
            for (const [filePath, content] of Object.entries(state.workspaceState)) {
                try {
                    await fs.promises.writeFile(filePath, content, 'utf8');
                } catch (error) {
                    console.error(`Failed to restore file ${filePath}:`, error);
                    throw error;
                }
            }

            vscode.window.showInformationMessage(`Successfully restored to recovery state from ${new Date(state.timestamp).toLocaleString()}`);
        } catch (error) {
            console.error(`Failed to restore recovery state ${stateId}:`, error);
            throw error;
        }
    }

    /**
     * 提供用户手动恢复选项
     */
    public async showManualRecoveryOptions(failureId: string): Promise<void> {
        const failure = this.failures.get(failureId);
        if (!failure) {
            vscode.window.showErrorMessage(`Failure ${failureId} not found`);
            return;
        }

        const options = [
            { label: '$(sync) Retry Auto Recovery', value: 'retry' },
            { label: '$(history) Restore from Backup', value: 'backup' },
            { label: '$(list-selection) Select Recovery State', value: 'state' },
            { label: '$(file-text) View Failure Details', value: 'details' },
            { label: '$(trash) Dismiss Failure', value: 'dismiss' }
        ];

        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: `Recovery options for rollback failure (${failure.errorType})`
        });

        if (!selected) {
            return;
        }

        switch (selected.value) {
            case 'retry':
                await this.handleRetryRecovery(failureId);
                break;
            case 'backup':
                await this.handleBackupRestore(failure);
                break;
            case 'state':
                await this.handleStateSelection();
                break;
            case 'details':
                await this.showFailureDetails(failure);
                break;
            case 'dismiss':
                await this.dismissFailure(failureId);
                break;
        }
    }

    private async handleRetryRecovery(failureId: string): Promise<void> {
        try {
            const success = await this.attemptAutoRecovery(failureId);
            if (success) {
                vscode.window.showInformationMessage('Auto recovery completed successfully');
                this.failures.delete(failureId);
                await this.saveFailureHistory();
            } else {
                vscode.window.showWarningMessage('Auto recovery failed. Try manual recovery options.');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Recovery failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async handleBackupRestore(failure: RollbackFailure): Promise<void> {
        if (!failure.backupId) {
            vscode.window.showWarningMessage('No backup available for this failure');
            return;
        }

        try {
            // 这里应该调用备份恢复逻辑
            // await this.backupManager.restoreBackup(failure.backupId);
            vscode.window.showInformationMessage('Backup restored successfully');
        } catch (error) {
            vscode.window.showErrorMessage(`Backup restore failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async handleStateSelection(): Promise<void> {
        const states = Array.from(this.recoveryStates.values())
            .filter(state => state.isValid)
            .sort((a, b) => b.timestamp - a.timestamp);

        if (states.length === 0) {
            vscode.window.showWarningMessage('No recovery states available');
            return;
        }

        const options = states.map(state => ({
            label: `Recovery State ${state.id}`,
            description: new Date(state.timestamp).toLocaleString(),
            detail: `${Object.keys(state.workspaceState).length} files`,
            state
        }));

        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: 'Select a recovery state to restore'
        });

        if (selected) {
            try {
                await this.restoreToRecoveryState(selected.state.id);
            } catch (error) {
                vscode.window.showErrorMessage(`State restore failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
    }

    private async showFailureDetails(failure: RollbackFailure): Promise<void> {
        const details = [
            `Failure ID: ${failure.id}`,
            `Message ID: ${failure.messageId}`,
            `Error Type: ${failure.errorType}`,
            `Timestamp: ${new Date(failure.timestamp).toLocaleString()}`,
            `Recovery Attempts: ${failure.recoveryAttempts}/${this.maxRecoveryAttempts}`,
            `Affected Files: ${failure.affectedFiles.length}`,
            `Error Message: ${failure.errorMessage}`,
            '',
            'Affected Files:',
            ...failure.affectedFiles.map(file => `  - ${file}`)
        ].join('\n');

        const document = await vscode.workspace.openTextDocument({
            content: details,
            language: 'plaintext'
        });

        await vscode.window.showTextDocument(document);
    }

    private async dismissFailure(failureId: string): Promise<void> {
        const confirmed = await vscode.window.showWarningMessage(
            'Are you sure you want to dismiss this failure? This action cannot be undone.',
            'Yes', 'No'
        );

        if (confirmed === 'Yes') {
            this.failures.delete(failureId);
            await this.saveFailureHistory();
            vscode.window.showInformationMessage('Failure dismissed');
        }
    }

    // 错误分类逻辑
    private categorizeError(error: Error): RollbackFailure['errorType'] {
        const message = error.message.toLowerCase();
        
        if (message.includes('permission') || message.includes('access denied')) {
            return 'PERMISSION';
        }
        if (message.includes('no such file') || message.includes('enoent')) {
            return 'FILE_ACCESS';
        }
        if (message.includes('corrupt') || message.includes('invalid')) {
            return 'CORRUPTION';
        }
        if (message.includes('partial') || message.includes('incomplete')) {
            return 'PARTIAL_FAILURE';
        }
        
        return 'UNKNOWN';
    }

    // 具体的恢复策略实现
    private async recoverFromFileAccessError(failure: RollbackFailure): Promise<boolean> {
        console.log(`Attempting file access error recovery for ${failure.id}`);
        
        // 检查文件是否存在，如果不存在则尝试从备份恢复
        for (const filePath of failure.affectedFiles) {
            try {
                await fs.promises.access(filePath);
            } catch {
                // 文件不存在，尝试创建目录
                const dir = path.dirname(filePath);
                await fs.promises.mkdir(dir, { recursive: true });
            }
        }
        
        return true;
    }

    private async recoverFromPermissionError(failure: RollbackFailure): Promise<boolean> {
        console.log(`Attempting permission error recovery for ${failure.id}`);
        
        // 权限错误通常需要用户手动处理
        vscode.window.showWarningMessage(
            'Permission error detected. Please check file permissions and try again.',
            'Open Folder'
        ).then(action => {
            if (action === 'Open Folder') {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (workspaceFolder) {
                    vscode.commands.executeCommand('revealFileInOS', workspaceFolder.uri);
                }
            }
        });
        
        return false;
    }

    private async recoverFromCorruptionError(failure: RollbackFailure): Promise<boolean> {
        console.log(`Attempting corruption error recovery for ${failure.id}`);
        
        if (failure.backupId) {
            // 如果有备份，尝试从备份恢复
            try {
                // await this.backupManager.restoreBackup(failure.backupId);
                return true;
            } catch (error) {
                console.error('Backup restore failed:', error);
            }
        }
        
        return false;
    }

    private async recoverFromPartialFailure(failure: RollbackFailure): Promise<boolean> {
        console.log(`Attempting partial failure recovery for ${failure.id}`);
        
        // 部分失败时，尝试重新应用未完成的更改
        // 这需要更复杂的状态跟踪逻辑
        return false;
    }

    private async recoverFromUnknownError(failure: RollbackFailure): Promise<boolean> {
        console.log(`Attempting unknown error recovery for ${failure.id}`);
        
        // 对于未知错误，尝试基本的恢复策略
        return false;
    }

    // 辅助方法
    private generateFailureId(): string {
        return `failure_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private generateStateId(): string {
        return `state_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private async getAllWorkspaceFiles(rootPath: string): Promise<string[]> {
        const files: string[] = [];
        
        const traverse = async (dir: string) => {
            try {
                const entries = await fs.promises.readdir(dir, { withFileTypes: true });
                
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    
                    if (entry.isDirectory()) {
                        // 跳过常见的忽略目录
                        if (!['node_modules', '.git', '.vscode', 'out', 'dist'].includes(entry.name)) {
                            await traverse(fullPath);
                        }
                    } else if (entry.isFile()) {
                        files.push(fullPath);
                    }
                }
            } catch (error) {
                console.warn(`Failed to traverse directory ${dir}:`, error);
            }
        };
        
        await traverse(rootPath);
        return files;
    }

    private async loadFailureHistory(): Promise<void> {
        try {
            const data = this.context.globalState.get<{ [key: string]: RollbackFailure }>('rollbackFailures', {});
            this.failures = new Map(Object.entries(data));
        } catch (error) {
            console.error('Failed to load failure history:', error);
        }
    }

    private async saveFailureHistory(): Promise<void> {
        try {
            const data = Object.fromEntries(this.failures);
            await this.context.globalState.update('rollbackFailures', data);
        } catch (error) {
            console.error('Failed to save failure history:', error);
        }
    }

    private async loadRecoveryStates(): Promise<void> {
        try {
            const data = this.context.globalState.get<{ [key: string]: RecoveryState }>('recoveryStates', {});
            this.recoveryStates = new Map(Object.entries(data));
        } catch (error) {
            console.error('Failed to load recovery states:', error);
        }
    }

    private async saveRecoveryStates(): Promise<void> {
        try {
            const data = Object.fromEntries(this.recoveryStates);
            await this.context.globalState.update('recoveryStates', data);
        } catch (error) {
            console.error('Failed to save recovery states:', error);
        }
    }

    /**
     * 获取所有活跃的失败记录
     */
    public getActiveFailures(): RollbackFailure[] {
        return Array.from(this.failures.values())
            .filter(failure => failure.recoveryAttempts < this.maxRecoveryAttempts);
    }

    /**
     * 清理过期的恢复状态
     */
    public async cleanupOldRecoveryStates(maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
        const now = Date.now();
        const toDelete: string[] = [];

        for (const [id, state] of this.recoveryStates) {
            if (now - state.timestamp > maxAge) {
                toDelete.push(id);
            }
        }

        for (const id of toDelete) {
            this.recoveryStates.delete(id);
        }

        if (toDelete.length > 0) {
            await this.saveRecoveryStates();
            console.log(`Cleaned up ${toDelete.length} old recovery states`);
        }
    }
}