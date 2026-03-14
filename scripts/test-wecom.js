#!/usr/bin/env node
/**
 * 企业微信渠道测试脚本
 *
 * 测试企业微信渠道的连接和消息功能
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WeComChannel } from '../dist/channels/wecom.js';
import { logger } from '../dist/logger.js';

// 获取项目根目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// 手动读取 .env 文件
function readEnvVars(keys) {
  const envFile = path.join(projectRoot, '.env');
  try {
    const content = fs.readFileSync(envFile, 'utf-8');
    const result = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      if (!keys.includes(key)) continue;
      let value = trimmed.slice(eqIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (value) result[key] = value;
    }
    return result;
  } catch (err) {
    return {};
  }
}

// 模拟 opts
const mockOpts = {
  onMessage: (jid, msg) => {
    console.log('\n✅ 收到消息:');
    console.log('  JID:', jid);
    console.log('  发送者:', msg.sender_name);
    console.log('  内容:', msg.content);
    console.log('  时间:', msg.timestamp);
  },
  onChatMetadata: (jid, timestamp, name, source, isGroup) => {
    console.log('\n📋 聊天元数据:');
    console.log('  JID:', jid);
    console.log('  名称:', name || '(未知)');
    console.log('  类型:', isGroup ? '群聊' : '单聊');
  },
  registeredGroups: () => ({
    'wecom:single:test': { isMain: true },
  }),
};

async function testConnection() {
  console.log('\n========================================');
  console.log('  企业微信渠道测试');
  console.log('========================================\n');

  // 读取环境变量
  const envVars = readEnvVars(['WECOM_BOT_ID', 'WECOM_SECRET']);
  const botId = process.env.WECOM_BOT_ID || envVars.WECOM_BOT_ID;
  const secret = process.env.WECOM_SECRET || envVars.WECOM_SECRET;

  if (!botId || !secret) {
    console.error('❌ 缺少 WECOM_BOT_ID 或 WECOM_SECRET');
    process.exit(1);
  }

  console.log('配置信息:');
  console.log('  Bot ID:', botId.substring(0, 10) + '...');
  console.log('  Secret:', secret.substring(0, 10) + '...\n');

  // 创建渠道实例
  const channel = new WeComChannel(botId, secret, mockOpts);

  try {
    // 测试连接
    console.log('🔌 测试连接...');
    await channel.connect();
    console.log('✅ 连接成功!\n');

    // 等待用户测试
    console.log('📱 请在企业微信中发送测试消息...');
    console.log('⏱️  等待 30 秒...\n');

    await new Promise(resolve => setTimeout(resolve, 30000));

    console.log('\n✅ 测试完成!');

    // 断开连接
    await channel.disconnect();
    console.log('✅ 已断开连接\n');

  } catch (err) {
    console.error('\n❌ 测试失败:', err.message);
    process.exit(1);
  }
}

testConnection();
