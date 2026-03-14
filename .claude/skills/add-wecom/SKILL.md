---
name: add-wecom
description: Add WeCom (企业微信) as a channel. WeCom is the enterprise messaging platform by Tencent. Requires WeCom Bot ID and Secret from the WeCom management backend.
---

# Add WeCom Channel

This skill adds WeCom (企业微信) support to NanoClaw. It guides through configuration, authentication, and registration.

## Phase 1: Pre-flight

### Check if already applied

Check if `src/channels/wecom.ts` exists. If it does, skip to Phase 3 (Setup).

### Ask the user

Use `AskUserQuestion` to collect configuration:

AskUserQuestion: Do you have WeCom Bot credentials (Bot ID and Secret), or do you need help getting them?

If they need help, explain:

> To get WeCom Bot credentials:
>
> 1. Log in to [WeCom Management Console](https://work.weixin.qq.com/)
> 2. Go to **Application Management** > **Applications**
> 3. Create or select an app (need "Manage Customer Contact" permission)
> 4. In **App Details**, find:
>    - **Bot ID** (机器人 ID): like `aib2KkVVJ_c00tgeH3WKXcnyUvU3J9f7iqa`
>    - **Secret** (密钥): like `AGUoK2wIC2PyeaWvH2YBDD2pRSVka54saJKMN5RyIQw`
>
> The bot must be in the "Customer Contact" scope (应用管理 > 客户联系) to receive messages.

Wait for the user to provide the Bot ID and Secret.

## Phase 2: Apply Code Changes

### Check if WeCom SDK is installed

```bash
grep @wecom/aibot-node-sdk package.json
```

If not found, install it:

```bash
npm install @wecom/aibot-node-sdk
```

### Verify WeCom channel exists

```bash
ls -la src/channels/wecom.ts
```

If it doesn't exist, the WeCom channel code needs to be created. For now, skip to Phase 3 if the file exists.

## Phase 3: Setup

### Configure environment

Add to `.env`:

```bash
WECOM_BOT_ID=<their-bot-id>
WECOM_SECRET=<their-secret>
```

Channels auto-enable when their credentials are present.

Sync to container environment:

```bash
mkdir -p data/env && cp .env data/env/env
```

The container reads environment from `data/env/env`, not `.env` directly.

### Configure Claude API

AskUserQuestion: Which Claude API are you using?

- **Anthropic Official** - api.anthropic.com (requires international access)
- **Zhipu AI (智谱 AI)** - open.bigmodel.cn (recommended for China users)

If they chose Zhipu AI, add to `.env`:

```bash
ANTHROPIC_API_KEY=<their-zhipu-api-key>
ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic
```

If they chose Anthropic, add to `.env`:

```bash
ANTHROPIC_API_KEY=<their-anthropic-api-key>
```

Sync to container environment:

```bash
mkdir -p data/env && cp .env data/env/env
```

### Build and restart

```bash
npm run build
```

Restart the service:

```bash
# macOS (launchd)
launchctl kickstart -k gui/$(id -u)/com.nanoclaw

# Linux (systemd)
systemctl --user restart nanoclaw
```

### Verify connection

```bash
tail -50 logs/nanoclaw.log | grep "企业微信认证成功"
```

If successful, you should see:
- `Credential proxy started` with `authMode: "api-key"`
- `企业微信机器人已连接`
- `企业微信认证成功`

## Phase 4: Registration

### Get Chat ID

Tell the user:

> Send a message to your WeCom bot (any message), then run:
>
> ```bash
> tail -100 logs/nanoclaw.log | grep "生成的 JID"
> ```
>
> This will show the JID (Chat ID) for registration.

Wait for the user to provide the JID (format: `wecom:single:userid` or `wecom:group:chatid`).

### Configure registration settings

AskUserQuestion: What should the assistant be called?

- **Andy** - Default name
- **Claude** - Match the AI name
- **Custom** - Enter a custom name

AskUserQuestion: What trigger word should activate the assistant?

- **@Andy** - Default trigger
- **@<name>** - Match the assistant name
- **Custom** - Enter a custom trigger

### Register the chat

For a main chat (responds to all messages):

```bash
npx tsx setup/index.ts --step register \
  --jid "<jid>" \
  --name "<chat-name>" \
  --trigger "@<trigger>" \
  --folder "wecom_main" \
  --channel wecom \
  --assistant-name "<name>" \
  --is-main
```

For additional chats (trigger-only):

```bash
npx tsx setup/index.ts --step register \
  --jid "<jid>" \
  --name "<chat-name>" \
  --trigger "@<trigger>" \
  --folder "wecom_<group-name>" \
  --channel wecom
```

## Phase 5: Verify

### Test the connection

Tell the user:

> Send a message to your registered WeCom chat:
> - For main chat: Any message works
> - For non-main: Use the trigger word (e.g., "@Andy hello")
>
> The assistant should respond within a few seconds.

### Check logs if needed

```bash
tail -f logs/nanoclaw.log
```

Look for:
- `收到企业微信 message.text 事件` - Message received
- `Spawning container agent` - Container started
- `Agent output:` - AI response
- `企业微信消息已发送` - Response sent

## Troubleshooting

### "Channel credentials missing" error

**Symptoms**: Logs show `Channel installed but credentials missing — skipping`

**Solutions**:
1. Verify `.env` exists and contains `WECOM_BOT_ID` and `WECOM_SECRET`
2. Check file permissions: `ls -la .env`
3. Sync to container: `mkdir -p data/env && cp .env data/env/env`
4. Restart service: `launchctl kickstart -k gui/$(id -u)/com.nanoclaw`

### "405 Not Allowed" API error

**Symptoms**: Agent returns `API Error: 405 Not Allowed`

**Solutions**:
1. Verify `ANTHROPIC_BASE_URL` is set correctly in `.env`
2. For Zhipu AI: `ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic`
3. For Anthropic: Don't set `ANTHROPIC_BASE_URL` (uses default)
4. Check credential proxy is working: `curl -X POST http://127.0.0.1:3001/v1/messages -H "x-api-key: test" -H "content-type: application/json" -d '{"model":"glm-4.7","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}'`

### "Not logged in" error

**Symptoms**: Agent returns `Not logged in · Please run /login`

**Solutions**:
1. Check `authMode` in logs: Should be `"api-key"`, not `"oauth"`
2. Verify `ANTHROPIC_API_KEY` is set in `.env`
3. Clear old session: `sqlite3 store/messages.db "DELETE FROM sessions WHERE group_folder='wecom_main';"`
4. Restart service

### Bot not responding

**Symptoms**: No response after sending message

**Check list**:
1. Service is running: `launchctl list | grep nanoclaw`
2. WeCom is connected: `tail -50 logs/nanoclaw.log | grep "企业微信认证成功"`
3. Chat is registered: `sqlite3 store/messages.db "SELECT * FROM registered_groups WHERE jid LIKE 'wecom:%'"`
4. Message was received: `tail -100 logs/nanoclaw.log | grep "企业微信消息已接收"`
5. Check for errors: `tail -200 logs/nanoclaw.log | grep ERROR`

### Container keeps crashing

**Symptoms**: Container exits with code 1 repeatedly

**Solutions**:
1. Check container logs: `ls -lt groups/wecom_main/logs/`
2. Read latest log: `cat groups/wecom_main/logs/container-*.log | tail -50`
3. Verify `.env` is not shadowed (empty): `cat .env`
4. If `.env` is empty, recreate it from backup or reconfigure
5. Clear session cache: `rm -rf data/sessions/wecom_main/.claude`

### Connection keeps dropping

**Symptoms**: Frequent reconnects in logs

**Solutions**:
1. Check network stability
2. Verify bot credentials are correct
3. Check WeCom service status: https://work.weixin.qq.com/
4. Increase heartbeat interval (modify `wecom.ts` if needed)

## After Setup

If running `npm run dev` while the service is active:

```bash
# macOS:
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
npm run dev
# When done testing:
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist

# Linux:
# systemctl --user stop nanoclaw
# npm run dev
# systemctl --user start nanoclaw
```

## Removal

To remove WeCom integration:

1. Remove credentials from `.env`: Delete `WECOM_BOT_ID` and `WECOM_SECRET` lines
2. Remove WeCom registrations: `sqlite3 store/messages.db "DELETE FROM registered_groups WHERE jid LIKE 'wecom:%'"`
3. Clear session cache: `rm -rf data/sessions/wecom_main`
4. Sync env: `mkdir -p data/env && cp .env data/env/env`
5. Rebuild and restart: `npm run build && launchctl kickstart -k gui/$(id -u)/com.nanoclaw` (macOS) or `npm run build && systemctl --user restart nanoclaw` (Linux)

## API Compatibility Notes

### Zhipu AI (智谱 AI) Configuration

For users in China, Zhipu AI provides Anthropic-compatible API:

```bash
# Get API key from: https://open.bigmodel.cn/
ANTHROPIC_API_KEY=<your-zhipu-api-key>
ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic
```

**Important**: The `ANTHROPIC_BASE_URL` must include `/api/anthropic` path for correct routing.

### Supported Models

- Zhipu AI: `glm-4.7`, `glm-4.5`, `glm-4-air`, `glm-4-flash`
- Anthropic: `claude-3-7-sonnet-20250219`, `claude-3-5-sonnet-20241022`

### Model Selection

Set the model in group's CLAUDE.md:

```markdown
<!-- model: glm-4.7 -->
```

Or via environment: `ANTHROPIC_MODEL=glm-4.7`
