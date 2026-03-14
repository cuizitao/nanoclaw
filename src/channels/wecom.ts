import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { registerChannel, ChannelOpts } from './registry.js';
import {
  Channel,
  OnChatMetadata,
  OnInboundMessage,
  RegisteredGroup,
} from '../types.js';

export interface WeComChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

/**
 * WeCom (企业微信) Channel for NanoClaw
 *
 * Uses the official @wecom/aibot-node-sdk for WebSocket long-polling connection.
 * Supports text, image, voice, video, file messages and streaming responses.
 *
 * JID format:
 * - Single chat: wecom:single:{userid}
 * - Group chat: wecom:group:{chatid}
 */
export class WeComChannel implements Channel {
  name = 'wecom';

  // SDK instance
  private bot: any = null;

  // Configuration
  private opts: WeComChannelOpts;
  private botId: string;
  private secret: string;

  // Connection management
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  // Stream message buffering (stream.id -> content chunks)
  private streamMessageBuffer: Map<string, string[]> = new Map();
  // Stream timeout cleanup (stream.id -> timeout handle)
  private streamTimeouts: Map<string, NodeJS.Timeout> = new Map();
  // Store latest frame for each chat JID (for reply)
  private frameMap: Map<string, any> = new Map();

  constructor(botId: string, secret: string, opts: WeComChannelOpts) {
    this.botId = botId;
    this.secret = secret;
    this.opts = opts;
  }

  /**
   * Establish WebSocket connection to WeCom server
   */
  async connect(): Promise<void> {
    try {
      // Dynamically import SDK to avoid hard dependency
      const sdk = await import('@wecom/aibot-node-sdk');
      const WSClient = sdk.WSClient || sdk.default?.WSClient;

      this.bot = new WSClient({
        botId: this.botId,
        secret: this.secret,
      });

      return new Promise<void>((resolve, reject) => {
        // IMPORTANT: Setup ALL event handlers BEFORE connecting
        // Otherwise we may miss early events

        // Set connection timeout
        const timeout = setTimeout(() => {
          reject(new Error('WeCom connection timeout (30s)'));
        }, 30000);

        // Connection successful handler
        this.bot.on('connected', () => {
          clearTimeout(timeout);
          this.startHeartbeat();
          logger.info('企业微信机器人已连接');
          console.log('\n  企业微信: WebSocket 已连接');
          console.log('  发送消息获取 Chat ID 用于注册\n');
          resolve();
        });

        // Authentication handler
        this.bot.on('authenticated', () => {
          logger.info('企业微信认证成功');
        });

        // Error handler
        this.bot.on('error', (err: Error) => {
          clearTimeout(timeout);
          logger.error({ err: err.message }, '企业微信连接错误');
          this.scheduleReconnect(5000);
          reject(err);
        });

        // Disconnect handler
        this.bot.on('disconnected', () => {
          clearTimeout(timeout);
          logger.warn('企业微信连接已断开');
          this.scheduleReconnect(5000);
          reject(new Error('WeCom disconnected'));
        });

        // Setup message handlers BEFORE connecting
        this.setupEventHandlers();

        // Now start WebSocket connection
        try {
          this.bot.connect();
        } catch (err) {
          clearTimeout(timeout);
          logger.error({ err }, '企业微信连接失败');
          reject(err);
        }
      });
    } catch (err) {
      logger.error({ err }, '企业微信 SDK 加载失败');
      throw err;
    }
  }

  /**
   * Send message to WeCom chat
   */
  async sendMessage(jid: string, text: string): Promise<void> {
    logger.info({ jid, textLength: text.length }, '开始发送企业微信消息');

    if (!this.bot || !this.isConnected()) {
      logger.warn('企业微信未连接，无法发送消息');
      return;
    }

    try {
      // Get the original frame for this chat (needed for reply)
      const frame = this.frameMap.get(jid);
      logger.info({ jid, hasFrame: !!frame, frameKeys: frame ? Object.keys(frame) : [] }, '获取 frame 结果');

      if (!frame) {
        logger.warn({ jid }, '未找到原始消息帧，无法回复');
        return;
      }

      logger.info({ jid, frameCmd: frame.cmd, hasHeaders: !!frame.headers, reqId: frame.headers?.req_id }, 'frame 详情');

      // WeCom has a 2048 character limit per message
      const MAX_LENGTH = 2048;

      if (text.length <= MAX_LENGTH) {
        await this.sendSingleMessage(frame, text);
      } else {
        // Split long messages
        for (let i = 0; i < text.length; i += MAX_LENGTH) {
          await this.sendSingleMessage(frame, text.slice(i, i + MAX_LENGTH));
        }
      }

      logger.info({ jid, length: text.length }, '企业微信消息已发送');
    } catch (err) {
      logger.error({ jid, err }, '企业微信消息发送失败');
    }
  }

  /**
   * Check if WebSocket connection is active
   */
  isConnected(): boolean {
    return this.bot !== null;
  }

  /**
   * Check if this channel owns the given JID
   */
  ownsJid(jid: string): boolean {
    return jid.startsWith('wecom:');
  }

  /**
   * Disconnect from WeCom server
   */
  async disconnect(): Promise<void> {
    // Clear timers
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Clear stream buffers
    this.streamMessageBuffer.clear();
    this.streamTimeouts.forEach((timer) => clearTimeout(timer));
    this.streamTimeouts.clear();

    // Disconnect bot
    if (this.bot) {
      try {
        if (typeof this.bot.disconnect === 'function') {
          this.bot.disconnect();
        }
      } catch (err) {
        logger.debug({ err }, '企业微信断开连接时出错');
      }
      this.bot = null;
      logger.info('企业微信已断开连接');
    }
  }

  /**
   * Setup event handlers for WeCom events
   */
  private setupEventHandlers(): void {
    if (!this.bot) {
      logger.error('setupEventHandlers: bot is null');
      return;
    }

    logger.info('开始设置企业微信事件处理器');

    // Text message handler - SDK emits 'message.text' event
    this.bot.on('message.text', (frame: any) => {
      try {
        logger.info({ frame }, '收到企业微信 message.text 事件');
        const msg = frame.body;

        // Store frame for reply
        const chatId = msg.chatid || msg.from?.userid || '';
        const chatType = msg.chattype || 'single';
        const chatJid = this.getJid(chatId, chatType);
        this.frameMap.set(chatJid, frame);

        logger.info({ msgContent: msg.text?.content, from: msg.from?.userid, chattype: msg.chattype }, '准备处理文本消息');
        logger.debug({ frame }, '收到企业微信文本消息');
        this.handleTextMessage(msg);
        logger.info('handleTextMessage 调用完成');
      } catch (err) {
        logger.error({ err, frame }, '企业微信文本消息处理失败');
      }
    });

    // Image message handler
    this.bot.on('message.image', (frame: any) => {
      try {
        const msg = frame.body;
        logger.debug({ frame }, '收到企业微信图片消息');
        this.handleMediaMessage(msg);
      } catch (err) {
        logger.error({ err, frame }, '企业微信图片消息处理失败');
      }
    });

    // Voice message handler
    this.bot.on('message.voice', (frame: any) => {
      try {
        const msg = frame.body;
        logger.debug({ frame }, '收到企业微信语音消息');
        this.handleMediaMessage(msg);
      } catch (err) {
        logger.error({ err, frame }, '企业微信语音消息处理失败');
      }
    });

    // File message handler
    this.bot.on('message.file', (frame: any) => {
      try {
        const msg = frame.body;
        logger.debug({ frame }, '收到企业微信文件消息');
        this.handleMediaMessage(msg);
      } catch (err) {
        logger.error({ err, frame }, '企业微信文件消息处理失败');
      }
    });

    // Mixed message handler
    this.bot.on('message.mixed', (frame: any) => {
      try {
        const msg = frame.body;
        logger.debug({ frame }, '收到企业微信图文混排消息');
        this.handleMediaMessage(msg);
      } catch (err) {
        logger.error({ err, frame }, '企业微信图文混排消息处理失败');
      }
    });

    // Enter chat event
    this.bot.on('event.enter_chat', (frame: any) => {
      logger.debug({ frame }, '用户进入会话');
    });

    // Leave session event
    this.bot.on('event.leave_session', (frame: any) => {
      logger.debug({ frame }, '用户离开会话');
    });
  }

  /**
   * Handle text messages
   */
  private handleTextMessage(msg: any): void {
    logger.info('handleTextMessage 开始处理');

    // Extract fields from nested structure
    const chatId = msg.chatid || msg.from?.userid || '';
    const chatType = msg.chattype || 'single';
    const sender = msg.from?.userid || '';
    const senderName = msg.from?.username || sender;

    logger.info({ chatId, chatType, sender }, '解析的消息字段');

    const chatJid = this.getJid(chatId, chatType);
    const timestamp = new Date(msg.timestamp || Date.now()).toISOString();
    const content = msg.text?.content || '';
    const msgId = msg.msgid || `${timestamp}-${sender}`;

    logger.info({ chatJid, content }, '生成的 JID 和内容');

    // Determine if this is a group chat
    const isGroup = chatType === 'group';

    // Store chat metadata for discovery
    this.opts.onChatMetadata(
      chatJid,
      timestamp,
      msg.chatname || (isGroup ? undefined : senderName),
      'wecom',
      isGroup
    );

    // Check if this chat is registered
    const group = this.opts.registeredGroups()[chatJid];
    if (!group) {
      logger.debug({ chatJid }, '未注册的企业微信会话');
      return;
    }

    logger.info({ chatJid, isMain: group.isMain }, '聊天已注册，准备传递消息');

    // Deliver message
    this.opts.onMessage(chatJid, {
      id: msgId,
      chat_jid: chatJid,
      sender,
      sender_name: senderName,
      content,
      timestamp,
      is_from_me: false,
    });

    logger.info(
      { chatJid, sender: senderName, content },
      '企业微信消息已接收'
    );
  }

  /**
   * Handle media messages (image, voice, video, file, etc.)
   */
  private handleMediaMessage(msg: any): void {
    const chatId = msg.chatid || msg.from?.userid || '';
    const chatType = msg.chattype || 'single';
    const chatJid = this.getJid(chatId, chatType);
    const group = this.opts.registeredGroups()[chatJid];
    if (!group) return;

    const timestamp = new Date(msg.timestamp || Date.now()).toISOString();
    const sender = msg.from?.userid || '';
    const senderName = msg.from?.username || sender;
    const msgId = msg.msgid || `${timestamp}-${sender}`;

    let placeholder = '';
    const msgType = msg.msgtype;

    switch (msgType) {
      case 'image':
        placeholder = '[图片]';
        break;
      case 'voice':
        placeholder = '[语音]';
        break;
      case 'video':
        placeholder = '[视频]';
        break;
      case 'file':
        const fileName = msg.file?.filename || '文件';
        placeholder = `[文件: ${fileName}]`;
        break;
      case 'news':
        placeholder = '[图文消息]';
        break;
      case 'link':
        placeholder = '[链接]';
        break;
      case 'markdown':
        placeholder = '[Markdown消息]';
        break;
      default:
        placeholder = `[${msgType}]`;
    }

    // Add caption if available
    if (msg[msgType]?.description) {
      placeholder += ` ${msg[msgType].description}`;
    }

    // Store chat metadata
    const isGroup = msg.chattype === 'group';
    this.opts.onChatMetadata(
      chatJid,
      timestamp,
      undefined,
      'wecom',
      isGroup
    );

    // Deliver message with placeholder
    this.opts.onMessage(chatJid, {
      id: msgId,
      chat_jid: chatJid,
      sender,
      sender_name: senderName,
      content: placeholder,
      timestamp,
      is_from_me: false,
    });
  }

  /**
   * Handle streaming messages
   * WeCom supports streaming responses where the AI's reply comes in chunks
   */
  private handleStreamMessage(msg: any): void {
    const streamId = msg.stream?.id;
    if (!streamId) return;

    // Clear existing timeout for this stream
    const existingTimeout = this.streamTimeouts.get(streamId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Initialize buffer if needed
    if (!this.streamMessageBuffer.has(streamId)) {
      this.streamMessageBuffer.set(streamId, []);
    }

    // Add content chunk
    const buffer = this.streamMessageBuffer.get(streamId)!;
    const content = msg.text?.content || '';
    buffer.push(content);

    // Set timeout to clean up stale streams (6 minutes)
    const timeout = setTimeout(() => {
      logger.warn({ streamId }, '流式消息超时，清理缓冲区');
      this.streamMessageBuffer.delete(streamId);
      this.streamTimeouts.delete(streamId);
    }, 6 * 60 * 1000);
    this.streamTimeouts.set(streamId, timeout);

    // Check if this is the last chunk
    if (msg.stream?.end === true) {
      const fullContent = buffer.join('');
      this.streamMessageBuffer.delete(streamId);
      this.streamTimeouts.delete(streamId);

      // Process the complete message
      this.handleTextMessage({
        ...msg,
        text: { content: fullContent },
        stream: undefined, // Remove stream marker
      });

      logger.debug({ streamId, length: fullContent.length }, '流式消息已合并');
    }
  }

  /**
   * Start heartbeat to keep connection alive
   * WeCom requires 30s heartbeat interval
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.bot && this.isConnected()) {
        logger.debug('企业微信心跳检查');
        // SDK handles automatic heartbeat internally
      }
    }, 30000); // 30 seconds
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(delay: number): void {
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        logger.info('尝试重新连接企业微信...');
        await this.connect();
      } catch (err) {
        logger.error({ err }, '重连失败，5秒后重试');
        this.scheduleReconnect(5000);
      }
    }, delay);
  }

  /**
   * Generate JID from WeCom chat data
   */
  private getJid(chatId: string, chatType: string): string {
    if (chatType === 'group') {
      return `wecom:group:${chatId}`;
    }
    return `wecom:single:${chatId}`;
  }

  /**
   * Parse JID to extract chat type and ID
   */
  private parseJid(jid: string): { chatType: string; chatId: string } {
    if (jid.startsWith('wecom:group:')) {
      return { chatType: 'group', chatId: jid.replace('wecom:group:', '') };
    }
    if (jid.startsWith('wecom:single:')) {
      return { chatType: 'single', chatId: jid.replace('wecom:single:', '') };
    }
    // Fallback for backwards compatibility
    return { chatType: 'single', chatId: jid.replace('wecom:', '') };
  }

  /**
   * Send a single message to WeCom
   */
  private async sendSingleMessage(
    frame: any,
    text: string
  ): Promise<void> {
    if (!this.bot) {
      logger.warn('企业微信未连接，无法发送消息');
      return;
    }

    try {
      // Use reply() method with the original frame
      // Note: WeCom reply() method only supports markdown and text types
      // Use markdown format for better compatibility
      logger.debug({ reqId: frame.headers?.req_id, contentLength: text.length }, '发送企业微信消息');

      await this.bot.reply(frame, {
        msgtype: 'markdown',
        markdown: { content: text },
      });

      logger.info({ reqId: frame.headers?.req_id, length: text.length }, '企业微信消息已发送');
    } catch (err) {
      logger.error({ reqId: frame.headers?.req_id, err }, '企业微信消息发送失败');
      throw err;
    }
  }
}

// Auto-registration
registerChannel('wecom', (opts: ChannelOpts) => {
  const envVars = readEnvFile(['WECOM_BOT_ID', 'WECOM_SECRET']);
  const botId = process.env.WECOM_BOT_ID || envVars.WECOM_BOT_ID || '';
  const secret = process.env.WECOM_SECRET || envVars.WECOM_SECRET || '';

  if (!botId || !secret) {
    logger.debug('企业微信: WECOM_BOT_ID 或 WECOM_SECRET 未设置');
    return null;
  }

  return new WeComChannel(botId, secret, opts);
});
