# NanoClaw 问题诊断与解决方案

## 问题发现日期：2026-03-12 ~ 2026-03-13

---

## 1. `.env` 文件丢失问题

### 问题描述
- `.env` 文件在服务运行过程中反复消失
- 导致服务启动时无法读取配置，企业微信和 API 认证失败

### 根本原因
`src/container-runner.ts` 中的 `.env shadowing` 机制：

1. **目的**：防止容器内进程读取宿主机的敏感信息
2. **机制**：在启动 main 容器前：
   - 将 `.env` 重命名为 `.env.nanoclaw.bak`
   - 创建空的、只读的 `.env` 文件
3. **恢复时机**：容器退出时将 `.env.nanoclaw.bak` 重命名回 `.env`

**问题**：
- 当服务异常退出（如 SIGKILL、系统崩溃）时，`.env` 无法恢复
- 导致服务重启时 `.env` 不存在，所有配置丢失

### 解决方案
已在 `src/container-runner.ts` 修复：
- 第 285 行：在 shadow `.env` **之前**检测 `authMode`
- 第 293 行：将 `authMode` 作为参数传递给 `buildContainerArgs()`

---

## 2. 认证模式检测时机问题

### 问题描述
- 容器参数使用 `CLAUDE_CODE_OAUTH_TOKEN=placeholder`（OAuth 模式）
- 应该使用 `ANTHROPIC_API_KEY=placeholder`（API key 模式）
- 导致容器内 Claude Code 无法正确认证

### 根本原因
`src/container-runner.ts` 中 `buildContainerArgs()` 函数：

**错误代码**（第 229 行）：
```typescript
const authMode = detectAuthMode();  // ❌ 在调用时才检测
```

**执行顺序问题**：
1. `runContainerAgent()` 启动
2. Shadow `.env`（清空文件）← 在此之前
3. `buildContainerArgs()` 调用
4. `detectAuthMode()` 读取 `.env` → 文件已空，返回 'oauth'

### 解决方案
修改 `src/container-runner.ts`：

**修复后**：
```typescript
// 在 shadow .env 之前检测
const authMode = detectAuthMode();
// ... shadow .env ...
const containerArgs = buildContainerArgs(mounts, containerName, input.isMain, authMode);
```

同时修改 `buildContainerArgs()` 函数签名：
```typescript
function buildContainerArgs(
  mounts: VolumeMount[],
  containerName: string,
  isMain: boolean,
  authMode: AuthMode,  // 新增参数
): string[]
```

---

## 3. Credential Proxy 路径转发问题

### 问题描述
- API 调用返回 `405 Not Allowed` 错误
- 智谱 AI 的 API 兼容端点无法正常工作

### 根本原因
`src/credential-proxy.ts` 第 86 行：

**错误代码**：
```typescript
path: req.url,  // ❌ 只有 /v1/messages
```

**问题分析**：
- 上游 URL：`https://open.bigmodel.cn/api/anthropic`
- 容器请求：`http://127.0.0.1:3001/v1/messages`
- `req.url`：`/v1/messages`
- 实际转发到：`https://open.bigmodel.cn/v1/messages` ❌
- 应该转发到：`https://open.bigmodel.cn/api/anthropic/v1/messages` ✅

### 解决方案
修改 `src/credential-proxy.ts` 第 86 行：

**修复后**：
```typescript
path: upstreamUrl.pathname + req.url,
```

---

## 4. 会话缓存问题

### 问题描述
- 即使服务重启并使用正确的 `.env`，容器仍然使用旧的错误配置
- 数据库中的会话 ID 保留了 OAuth 模式的配置

### 根本原因
- 会话 ID 存储在 `store/messages.db` 的 `sessions` 表中
- 容器恢复会话时，使用的是旧会话的配置
- 旧会话可能是在 `.env` 丢失时创建的（OAuth 模式）

### 解决方案
清理会话缓存：
```bash
sqlite3 store/messages.db "DELETE FROM sessions WHERE group_folder='wecom_main';"
```

或删除整个会话目录：
```bash
rm -rf data/sessions/wecom_main
```

---

## 修复的文件列表

1. `src/credential-proxy.ts` - 路径转发修复
2. `src/container-runner.ts` - 认证模式检测时机修复

---

## 验证方法

### 1. 验证 `.env` 配置
```bash
cat .env
```

### 2. 验证认证模式
```bash
tail -100 logs/nanoclaw.log | grep authMode
# 应显示：authMode: "api-key"
```

### 3. 验证 Credential Proxy
```bash
curl -X POST http://127.0.0.1:3001/v1/messages \
  -H "x-api-key: test" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"glm-4.7","max_tokens":20,"messages":[{"role":"user","content":"测试"}]}'
```

### 4. 验证企业微信连接
```bash
tail -100 logs/nanoclaw.log | grep "企业微信认证成功"
```

---

## 后续改进建议

1. **配置备份机制**：建立 `.env` 自动备份和恢复机制
2. **健康检查**：添加配置验证和健康检查端点
3. **错误处理**：改进 `.env` shadowing 的错误处理逻辑
4. **文档完善**：更新故障排查文档

---

生成时间：2026-03-13
生成者：Claude Code Assistant
