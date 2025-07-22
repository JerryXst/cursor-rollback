# 回滚失败处理和恢复系统 (Rollback Failure Handling and Recovery System)

## 概述 (Overview)

这个模块实现了一个完整的回滚失败处理和恢复系统，用于处理Cursor伴侣UI中的回滚操作失败情况。系统提供自动检测、分类处理、自动恢复和用户手动恢复选项。

This module implements a complete rollback failure handling and recovery system for handling rollback operation failures in the Cursor Companion UI. The system provides automatic detection, categorized handling, automatic recovery, and user manual recovery options.

## 核心功能 (Core Features)

### 1. 失败检测和分类 (Failure Detection and Categorization)

系统能够自动检测回滚失败并将错误分类为以下类型：
- `PERMISSION`: 权限错误
- `FILE_ACCESS`: 文件访问错误  
- `CORRUPTION`: 数据损坏错误
- `PARTIAL_FAILURE`: 部分失败
- `UNKNOWN`: 未知错误

### 2. 自动恢复策略 (Automatic Recovery Strategies)

针对不同类型的错误，系统实施不同的自动恢复策略：

- **文件访问错误**: 检查文件存在性，创建必要的目录结构
- **权限错误**: 提示用户检查权限，提供文件夹访问选项
- **数据损坏错误**: 尝试从备份恢复
- **部分失败**: 重新应用未完成的更改
- **未知错误**: 基本恢复策略

### 3. 恢复状态管理 (Recovery State Management)

- 创建工作区状态快照
- 管理多个恢复点
- 支持状态恢复和回滚
- 自动清理过期状态

### 4. 用户手动恢复选项 (User Manual Recovery Options)

提供直观的用户界面选项：
- 重试自动恢复
- 从备份恢复
- 选择恢复状态
- 查看失败详情
- 忽略失败

## 使用方法 (Usage)

### 基本使用 (Basic Usage)

```typescript
import { RecoveryCommands } from './rollback/recoveryCommands';

// 在扩展激活时初始化
const recoveryCommands = new RecoveryCommands(context);

// 处理回滚失败
try {
    await performRollback();
} catch (error) {
    await recoveryCommands.handleRollbackFailure(
        messageId,
        error,
        affectedFiles,
        backupId
    );
}
```

### 高级使用 (Advanced Usage)

```typescript
// 创建恢复状态
const stateId = await recoveryManager.createRecoveryState();

// 手动触发恢复
await recoveryManager.attemptAutoRecovery(failureId);

// 恢复到特定状态
await recoveryManager.restoreToRecoveryState(stateId);
```

## 可用命令 (Available Commands)

- `cursorRollback.showRecoveryOptions`: 显示恢复选项
- `cursorRollback.createRecoveryState`: 创建恢复状态
- `cursorRollback.viewActiveFailures`: 查看活跃失败
- `cursorRollback.cleanupRecoveryStates`: 清理恢复状态
- `cursorRollback.manualRecovery`: 手动恢复

## 配置选项 (Configuration Options)

系统提供以下可配置参数：

- `maxRecoveryAttempts`: 最大自动恢复尝试次数 (默认: 3)
- `recoveryTimeout`: 恢复操作超时时间 (默认: 30秒)
- `maxRecoveryStates`: 最大恢复状态数量
- `stateRetentionDays`: 状态保留天数 (默认: 7天)

## 错误处理策略 (Error Handling Strategies)

### 自动恢复流程 (Automatic Recovery Flow)

1. 检测失败并分类错误类型
2. 根据错误类型选择恢复策略
3. 执行自动恢复操作
4. 记录恢复尝试次数
5. 达到最大尝试次数后停止自动恢复

### 手动恢复流程 (Manual Recovery Flow)

1. 用户选择失败的回滚操作
2. 系统显示可用的恢复选项
3. 用户选择恢复方式
4. 执行恢复操作并提供反馈

## 数据持久化 (Data Persistence)

系统使用VSCode的全局状态存储来持久化：
- 失败记录历史
- 恢复状态快照
- 配置设置

## 性能考虑 (Performance Considerations)

- 恢复状态采用增量快照策略
- 定期清理过期数据
- 异步处理大文件操作
- 内存使用优化

## 测试 (Testing)

运行测试套件：

```bash
npm test
```

测试覆盖以下场景：
- 失败检测和分类
- 自动恢复逻辑
- 状态管理
- 错误边界处理

## 故障排除 (Troubleshooting)

### 常见问题 (Common Issues)

1. **权限错误**: 检查文件和目录权限
2. **存储空间不足**: 清理旧的恢复状态
3. **状态损坏**: 重新创建恢复状态
4. **性能问题**: 调整配置参数

### 调试信息 (Debug Information)

启用详细日志记录：
```typescript
console.log('Recovery system debug info:', {
    activeFailures: recoveryManager.getActiveFailures().length,
    recoveryStates: recoveryManager.getRecoveryStates().length
});
```

## 扩展性 (Extensibility)

系统设计为可扩展的，支持：
- 自定义恢复策略
- 插件式错误处理器
- 自定义状态快照格式
- 第三方集成接口

## 安全考虑 (Security Considerations)

- 敏感信息过滤
- 文件访问权限验证
- 状态数据加密存储
- 操作审计日志