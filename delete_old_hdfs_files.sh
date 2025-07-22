#!/bin/bash

# HDFS文件清理脚本 - 删除早于指定日期的文件
# 作者: AI Assistant
# 创建时间: $(date)
# 用途: 清理HDFS中早于2025年7月7日的文件

set -euo pipefail  # 启用严格模式

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置参数
TARGET_DATE="2025-07-07"  # 目标日期，早于此日期的文件将被删除
LOG_FILE="/tmp/hdfs_cleanup_$(date +%Y%m%d_%H%M%S).log"
PREVIEW_MODE=false
FORCE_DELETE=false
DRY_RUN=false

# 日志函数
log() {
    local level=$1
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    case $level in
        "INFO")
            echo -e "${GREEN}[INFO]${NC} $timestamp: $message" | tee -a "$LOG_FILE"
            ;;
        "WARN")
            echo -e "${YELLOW}[WARN]${NC} $timestamp: $message" | tee -a "$LOG_FILE"
            ;;
        "ERROR")
            echo -e "${RED}[ERROR]${NC} $timestamp: $message" | tee -a "$LOG_FILE"
            ;;
        "DEBUG")
            echo -e "${BLUE}[DEBUG]${NC} $timestamp: $message" | tee -a "$LOG_FILE"
            ;;
    esac
}

# 显示帮助信息
show_help() {
    cat << EOF
HDFS文件清理脚本

用法: $0 [选项] <HDFS目录路径>

选项:
    -d, --date DATE        指定目标日期 (格式: YYYY-MM-DD, 默认: 2025-07-07)
    -p, --preview          预览模式，只显示将要删除的文件，不实际删除
    -f, --force            强制删除，跳过确认提示
    -n, --dry-run          试运行模式，显示将要执行的操作但不实际执行
    -l, --log-file FILE    指定日志文件路径 (默认: /tmp/hdfs_cleanup_YYYYMMDD_HHMMSS.log)
    -h, --help             显示此帮助信息

示例:
    $0 /user/data/logs                    # 删除/user/data/logs下早于2025-07-07的文件
    $0 -d 2024-12-31 /user/data/logs     # 删除早于2024-12-31的文件
    $0 -p /user/data/logs                 # 预览将要删除的文件
    $0 -n -f /user/data/logs              # 试运行强制删除模式

注意事项:
    - 请确保有足够的HDFS权限
    - 建议先使用预览模式查看将要删除的文件
    - 删除操作不可逆，请谨慎操作
EOF
}

# 解析命令行参数
parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -d|--date)
                TARGET_DATE="$2"
                shift 2
                ;;
            -p|--preview)
                PREVIEW_MODE=true
                shift
                ;;
            -f|--force)
                FORCE_DELETE=true
                shift
                ;;
            -n|--dry-run)
                DRY_RUN=true
                shift
                ;;
            -l|--log-file)
                LOG_FILE="$2"
                shift 2
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            -*)
                log "ERROR" "未知选项: $1"
                show_help
                exit 1
                ;;
            *)
                HDFS_PATH="$1"
                shift
                ;;
        esac
    done
}

# 验证日期格式
validate_date() {
    if ! date -d "$TARGET_DATE" >/dev/null 2>&1; then
        log "ERROR" "无效的日期格式: $TARGET_DATE，请使用YYYY-MM-DD格式"
        exit 1
    fi
    
    # 转换为时间戳
    TARGET_TIMESTAMP=$(date -d "$TARGET_DATE" +%s)
    log "INFO" "目标日期: $TARGET_DATE (时间戳: $TARGET_TIMESTAMP)"
}

# 检查HDFS路径是否存在
check_hdfs_path() {
    if [[ -z "${HDFS_PATH:-}" ]]; then
        log "ERROR" "请指定HDFS目录路径"
        show_help
        exit 1
    fi
    
    log "INFO" "检查HDFS路径: $HDFS_PATH"
    
    if ! hdfs dfs -test -d "$HDFS_PATH" 2>/dev/null; then
        log "ERROR" "HDFS路径不存在或无法访问: $HDFS_PATH"
        exit 1
    fi
    
    log "INFO" "HDFS路径验证成功"
}

# 检查HDFS命令是否可用
check_hdfs_availability() {
    if ! command -v hdfs >/dev/null 2>&1; then
        log "ERROR" "HDFS客户端未安装或不在PATH中"
        exit 1
    fi
    
    if ! hdfs version >/dev/null 2>&1; then
        log "ERROR" "无法执行HDFS命令，请检查HDFS环境配置"
        exit 1
    fi
    
    log "INFO" "HDFS客户端检查通过"
}

# 获取文件列表并过滤
get_files_to_delete() {
    local temp_file="/tmp/hdfs_files_$$.tmp"
    local files_to_delete=()
    
    log "INFO" "获取HDFS文件列表..."
    
    # 获取文件列表，包含时间戳信息
    if ! hdfs dfs -ls "$HDFS_PATH" > "$temp_file" 2>/dev/null; then
        log "ERROR" "无法获取HDFS文件列表"
        rm -f "$temp_file"
        exit 1
    fi
    
    # 解析文件列表，过滤出早于目标日期的文件
    while IFS= read -r line; do
        # 跳过目录行和空行
        if [[ -z "$line" ]] || [[ "$line" =~ ^d ]]; then
            continue
        fi
        
        # 解析文件信息
        local file_info=($line)
        if [[ ${#file_info[@]} -lt 8 ]]; then
            continue
        fi
        
        local file_date="${file_info[5]} ${file_info[6]}"
        local file_path="${file_info[7]}"
        
        # 转换文件日期为时间戳
        local file_timestamp
        if file_timestamp=$(date -d "$file_date" +%s 2>/dev/null); then
            if [[ $file_timestamp -lt $TARGET_TIMESTAMP ]]; then
                files_to_delete+=("$file_path")
                log "DEBUG" "找到过期文件: $file_path (修改时间: $file_date)"
            fi
        else
            log "WARN" "无法解析文件时间: $file_path ($file_date)"
        fi
    done < "$temp_file"
    
    rm -f "$temp_file"
    
    echo "${files_to_delete[@]}"
}

# 显示将要删除的文件
show_files_to_delete() {
    local files=("$@")
    
    if [[ ${#files[@]} -eq 0 ]]; then
        log "INFO" "没有找到需要删除的文件"
        return 0
    fi
    
    log "INFO" "找到 ${#files[@]} 个需要删除的文件:"
    
    for file in "${files[@]}"; do
        echo "  - $file"
    done
    
    # 计算总大小
    local total_size=0
    for file in "${files[@]}"; do
        local size
        if size=$(hdfs dfs -du -s "$file" 2>/dev/null | awk '{print $1}'); then
            total_size=$((total_size + size))
        fi
    done
    
    log "INFO" "总大小: $(numfmt --to=iec $total_size)"
}

# 确认删除操作
confirm_deletion() {
    local files=("$@")
    
    if [[ ${#files[@]} -eq 0 ]]; then
        return 0
    fi
    
    if [[ "$FORCE_DELETE" == "true" ]]; then
        log "INFO" "强制删除模式，跳过确认"
        return 0
    fi
    
    echo
    echo -e "${YELLOW}警告: 即将删除 ${#files[@]} 个文件${NC}"
    echo "这些操作不可逆，请确认是否继续？"
    echo -n "输入 'yes' 确认删除，或按回车取消: "
    
    read -r confirmation
    
    if [[ "$confirmation" != "yes" ]]; then
        log "INFO" "用户取消删除操作"
        exit 0
    fi
    
    log "INFO" "用户确认删除操作"
}

# 执行删除操作
delete_files() {
    local files=("$@")
    local deleted_count=0
    local failed_count=0
    
    if [[ ${#files[@]} -eq 0 ]]; then
        log "INFO" "没有文件需要删除"
        return 0
    fi
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log "INFO" "试运行模式 - 将执行以下删除操作:"
        for file in "${files[@]}"; do
            echo "  hdfs dfs -rm \"$file\""
        done
        return 0
    fi
    
    log "INFO" "开始删除文件..."
    
    for file in "${files[@]}"; do
        if hdfs dfs -rm "$file" >/dev/null 2>&1; then
            log "INFO" "成功删除: $file"
            ((deleted_count++))
        else
            log "ERROR" "删除失败: $file"
            ((failed_count++))
        fi
    done
    
    log "INFO" "删除操作完成 - 成功: $deleted_count, 失败: $failed_count"
    
    if [[ $failed_count -gt 0 ]]; then
        log "WARN" "有 $failed_count 个文件删除失败，请检查日志"
        return 1
    fi
    
    return 0
}

# 主函数
main() {
    log "INFO" "HDFS文件清理脚本启动"
    log "INFO" "日志文件: $LOG_FILE"
    
    # 解析参数
    parse_arguments "$@"
    
    # 验证环境
    check_hdfs_availability
    validate_date
    check_hdfs_path
    
    # 获取需要删除的文件列表
    mapfile -t files_to_delete < <(get_files_to_delete)
    
    # 显示文件列表
    show_files_to_delete "${files_to_delete[@]}"
    
    # 如果是预览模式，直接退出
    if [[ "$PREVIEW_MODE" == "true" ]]; then
        log "INFO" "预览模式完成"
        exit 0
    fi
    
    # 确认删除操作
    confirm_deletion "${files_to_delete[@]}"
    
    # 执行删除
    if delete_files "${files_to_delete[@]}"; then
        log "INFO" "文件清理任务完成"
        exit 0
    else
        log "ERROR" "文件清理任务失败"
        exit 1
    fi
}

# 错误处理
trap 'log "ERROR" "脚本执行被中断"; exit 1' INT TERM

# 执行主函数
main "$@" 