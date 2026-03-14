# NanoClaw 配置管理工具

## 概述

NanoClaw 配置管理工具提供了一套完整的配置备份、恢复和健康检查功能，帮助用户避免 `.env` 文件丢失、配置错误等问题。

## 功能

1. **配置备份** - 自动备份 `.env` 文件并验证配置完整性
2. **配置恢复** - 从备份快速恢复配置
3. **配置验证** - 检查配置文件的完整性和正确性
4. **健康检查** - 全面的系统健康状态检查
5. **一键同步** - 将配置同步到容器环境

## 使用方法

### NPM Scripts (推荐)

```bash
# 配置备份
npm run config:backup

# 配置恢复
npm run config:restore

# 配置验证
npm run config:verify

# 配置同步
npm run config:sync

# 查看配置状态
npm run config:status

# 健康检查
npm run health
```

### 直接运行脚本

```bash
# 使用 Node.js
node scripts/config-backup.js backup
node scripts/config-backup.js restore
node scripts/config-backup.js verify

# 使用 Bash 包装器
./scripts/config-backup.sh backup
./scripts/config-backup.sh restore
./scripts/config-backup.sh verify

# 健康检查
node scripts/health-check.js
```

## 详细说明

### 1. 配置备份 (`config:backup`)

创建 `.env` 文件的备份，并自动验证配置完整性：

```bash
npm run config:backup
```

备份文件保存在 `.env-backups/` 目录：
- `.env.YYYY-MM-DD` - 按日期的备份
- `.env.latest` - 最新备份的符号链接
- `config-state.json` - 备份状态和验证结果

验证项目包括：
- ✅ 必需的配置键是否存在
- ✅ 配置值格式是否正确
- ⚠️  API 端点配置是否合理
- ⚠️  凭证格式是否正确

### 2. 配置恢复 (`config:restore`)

从备份恢复配置：

```bash
# 恢复最新备份
npm run config:restore

# 恢复指定日期的备份
npm run config:restore 2026-03-13
```

恢复前会自动创建当前配置的备份（`.env.prerestore.TIMESTAMP`）。

### 3. 配置验证 (`config:verify`)

验证当前配置是否正确：

```bash
npm run config:verify
```

验证输出示例：
```
✓ WECOM_BOT_ID is set
✓ WECOM_SECRET is set
✓ ANTHROPIC_API_KEY is set
✓ Using Zhipu AI (智谱 AI) - recommended for China users

Status: ✅ VALID
```

### 4. 配置同步 (`config:sync`)

将 `.env` 同步到容器环境：

```bash
npm run config:sync
```

这会将 `.env` 复制到 `data/env/env`，容器会从这里读取配置。

**重要提示**：每次修改 `.env` 后都需要运行此命令！

### 5. 配置状态 (`config:status`)

查看配置和备份状态：

```bash
npm run config:status
```

输出包括：
- `.env` 文件是否存在
- 配置是否有效
- 已配置的键数量
- 容器环境是否同步
- 可用的备份数量

### 6. 健康检查 (`health`)

全面的系统健康检查：

```bash
npm run health
```

检查项目：
1. **.env 文件检查** - 文件存在性、权限、必需配置键
2. **容器环境同步** - 配置是否已同步到容器
3. **服务状态** - NanoClaw 服务是否运行
4. **Credential Proxy** - API 代理是否正常工作
5. **通道连接** - 已注册的通道数量
6. **日志分析** - 检查最近的错误和警告

输出示例：
```
╔═══════════════════════════════════════════════════════╗
║        NanoClaw Health Check                          ║
╚═══════════════════════════════════════════════════════╝

==================================================
.env File Check
==================================================

✓ .env file exists
✓ File permissions: 600 (secure)
✓ Configuration keys: 5
✓ All required keys present
ℹ Using Zhipu AI (智谱 AI)

==================================================
Overall Score: 100%
✓ All checks passed! NanoClaw is healthy.
```

## 配置说明

### 必需配置

```bash
# WeCom (企业微信) Bot Configuration
WECOM_BOT_ID=aib2KkVVJ_c00tgeH3WKXcnyUvU3J9f7iqa
WECOM_SECRET=AGUoK2wIC2PyeaWvH2YBDD2pRSVka54saJKMN5RyIQw

# Claude API Authentication
ANTHROPIC_API_KEY=894797fedb3e4810b9add02deffc0880.ZjLwzi0yv79rpoH5
```

### 可选配置

```bash
# API Base URL (智谱 AI 必需)
ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic
```

### API 提供商选择

#### 智谱 AI (Zhipu AI) - 推荐中国用户

```bash
ANTHROPIC_API_KEY=<your-zhipu-api-key>
ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic
```

#### Anthropic 官方

```bash
ANTHROPIC_API_KEY=<your-anthropic-api-key>
# 不设置 ANTHROPIC_BASE_URL（使用默认）
```

## 常见问题

### Q: .env 文件反复消失怎么办？

**A**: 这是 `.env shadowing` 机制的问题。解决方法：

1. 恢复备份：`npm run config:restore`
2. 验证配置：`npm run config:verify`
3. 同步环境：`npm run config:sync`
4. 重启服务：`launchctl kickstart -k gui/$(id -u)/com.nanoclaw`

### Q: 如何避免配置丢失？

**A**: 养成良好习惯：

1. 每次修改配置后立即备份：`npm run config:backup`
2. 修改配置后记得同步：`npm run config:sync`
3. 定期运行健康检查：`npm run health`
4. 保留多个版本的备份

### Q: 配置验证失败怎么办？

**A**: 检查验证输出的错误信息：

1. **Missing required keys** - 添加缺失的配置
2. **Invalid format** - 检查配置值格式
3. **Wrong API endpoint** - 确认 `ANTHROPIC_BASE_URL` 是否正确

修复后重新验证：`npm run config:verify`

### Q: 容器无法读取配置怎么办？

**A**: 运行同步命令：

```bash
npm run config:sync
```

然后重启服务使配置生效。

### Q: 如何从零开始配置？

**A**: 使用 `/add-wecom` skill 进行交互式配置：

1. 在 Claude Code 中运行：`/add-wecom`
2. 按照 skill 指导完成配置
3. 配置完成后自动备份

## 最佳实践

### 1. 定期备份

```bash
# 每次修改配置后备份
npm run config:backup
```

### 2. 修改后同步

```bash
# 修改 .env 后必须同步
vim .env
npm run config:sync
npm run build
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

### 3. 定期健康检查

```bash
# 每周或感觉有问题时
npm run health
```

### 4. 部署前验证

```bash
# 部署到生产环境前
npm run config:verify
npm run health
```

## 故障排查流程

### 问题：NanoClaw 不响应

```bash
# 1. 检查服务状态
npm run health

# 2. 检查配置
npm run config:verify

# 3. 查看日志
tail -100 logs/nanoclaw.log

# 4. 如果配置有问题，恢复备份
npm run config:restore
npm run config:sync
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

### 问题：API 返回 405 错误

```bash
# 1. 检查 ANTHROPIC_BASE_URL 配置
npm run config:verify

# 2. 对于智谱 AI，确保包含完整路径
# ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic

# 3. 同步并重启
npm run config:sync
npm run build
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

### 问题：收到 "Not logged in" 错误

```bash
# 1. 清理会话缓存
sqlite3 store/messages.db "DELETE FROM sessions WHERE group_folder='wecom_main';"

# 2. 检查 authMode 应该是 "api-key"
tail -100 logs/nanoclaw.log | grep authMode

# 3. 如果是 "oauth"，检查配置
npm run config:verify
npm run config:sync
```

## 备份策略

### 自动备份建议

创建定时任务自动备份（macOS）：

```bash
# 编辑 crontab
crontab -e

# 每天凌晨 2 点自动备份
0 2 * * * cd /Users/cuizitao/workspace/nanoclaw && npm run config:backup
```

### 手动备份时机

建议在以下时机手动备份：

1. ✅ 初次配置完成后
2. ✅ 修改任何配置后
3. ✅ 更新 NanoClaw 版本前
4. ✅ 系统维护前

## 相关文档

- [问题诊断文档](./TROUBLESHOOTING-2026-03-13.md)
- [/add-wecom skill](../.claude/skills/add-wecom/SKILL.md)
- [NanoClaw README](../README.md)

## 技术支持

如果遇到问题：

1. 运行健康检查：`npm run health`
2. 查看故障排查文档
3. 检查日志：`tail -100 logs/nanoclaw.log`
4. 恢复已知良好的配置：`npm run config:restore`
