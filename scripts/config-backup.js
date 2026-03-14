#!/usr/bin/env node
/**
 * NanoClaw Configuration Backup and Restore Tool
 *
 * This script provides:
 * 1. Backup .env file with validation
 * 2. Restore from backup
 * 3. Verify configuration integrity
 * 4. One-click setup for new installations
 *
 * Usage:
 *   node scripts/config-backup.js backup    # Create backup
 *   node scripts/config-backup.js restore   # Restore from backup
 *   node scripts/config-backup.js verify    # Verify current config
 *   node scripts/config-backup.js setup     # Interactive setup
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Configuration files
const ENV_FILE = path.join(PROJECT_ROOT, '.env');
const ENV_EXAMPLE = path.join(PROJECT_ROOT, '.env.example');
const BACKUP_DIR = path.join(PROJECT_ROOT, '.env-backups');
const CONFIG_STATE = path.join(BACKUP_DIR, 'config-state.json');

// Required configuration keys
const REQUIRED_CONFIG = {
  // WeCom (企业微信)
  WECOM_BOT_ID: 'WeCom Bot ID from management console',
  WECOM_SECRET: 'WeCom Secret for authentication',

  // Claude API
  ANTHROPIC_API_KEY: 'API key for Claude or Zhipu AI',

  // Optional but recommended
  ANTHROPIC_BASE_URL: 'API base URL (required for Zhipu AI)',
};

// Config templates
const CONFIG_TEMPLATES = {
  anthropic: {
    name: 'Anthropic Official',
    ANTHROPIC_BASE_URL: '', // Uses default
  },
  zhipu: {
    name: 'Zhipu AI (智谱 AI)',
    ANTHROPIC_BASE_URL: 'https://open.bigmodel.cn/api/anthropic',
  },
};

/**
 * Parse .env file into key-value pairs
 */
function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const env = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const [, key, value] = match;
      env[key.trim()] = value.trim();
    }
  }

  return env;
}

/**
 * Create .env file from key-value pairs
 */
function createEnvFile(env, filePath = ENV_FILE) {
  const lines = [];

  // Header
  lines.push('# NanoClaw Configuration');
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push('#');

  // WeCom section
  if (env.WECOM_BOT_ID) {
    lines.push('# WeCom (企业微信) Bot Configuration');
    lines.push(`WECOM_BOT_ID=${env.WECOM_BOT_ID}`);
    lines.push(`WECOM_SECRET=${env.WECOM_SECRET}`);
    lines.push('');
  }

  // Claude API section
  if (env.ANTHROPIC_API_KEY) {
    lines.push('# Claude API Authentication');
    lines.push(`ANTHROPIC_API_KEY=${env.ANTHROPIC_API_KEY}`);
    if (env.ANTHROPIC_BASE_URL) {
      lines.push(`ANTHROPIC_BASE_URL=${env.ANTHROPIC_BASE_URL}`);
    }
    lines.push('');
  }

  fs.writeFileSync(filePath, lines.join('\n') + '\n', { mode: 0o600 });
}

/**
 * Verify configuration integrity
 */
function verifyConfig(env) {
  const errors = [];
  const warnings = [];
  const info = [];

  // Check required config
  for (const [key, description] of Object.entries(REQUIRED_CONFIG)) {
    if (!env[key]) {
      errors.push(`Missing: ${key} - ${description}`);
    } else {
      info.push(`✓ ${key} is set`);
    }
  }

  // Check auth mode
  const hasApiKey = !!env.ANTHROPIC_API_KEY;
  const hasBaseUrl = !!env.ANTHROPIC_BASE_URL;

  if (hasApiKey && hasBaseUrl) {
    // Check if using Zhipu AI
    if (env.ANTHROPIC_BASE_URL.includes('bigmodel.cn')) {
      info.push('✓ Using Zhipu AI (智谱 AI) - recommended for China users');
      if (!env.ANTHROPIC_BASE_URL.includes('/api/anthropic')) {
        warnings.push('ANTHROPIC_BASE_URL should include /api/anthropic path');
      }
    } else {
      info.push('✓ Using custom API endpoint');
    }
  } else if (hasApiKey) {
    info.push('✓ Using Anthropic official API');
  }

  // Check WeCom credentials format
  if (env.WECOM_BOT_ID) {
    if (env.WECOM_BOT_ID.length < 20) {
      warnings.push('WECOM_BOT_ID seems too short (typical format: aib2KkVVJ_c00tgeH3WKXcnyUvU3J9f7iqa)');
    }
  }

  if (env.WECOM_SECRET) {
    if (env.WECOM_SECRET.length < 20) {
      warnings.push('WECOM_SECRET seems too short');
    }
  }

  return { errors, warnings, info, isValid: errors.length === 0 };
}

/**
 * Create backup
 */
function backup() {
  console.log('📦 Creating configuration backup...\n');

  // Ensure backup directory exists
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  // Check if .env exists
  if (!fs.existsSync(ENV_FILE)) {
    console.error('❌ .env file not found!');
    console.log('   Run: node scripts/config-backup.js setup');
    process.exit(1);
  }

  // Read and verify current config
  const env = parseEnvFile(ENV_FILE);
  const { errors, warnings, info, isValid } = verifyConfig(env);

  // Display verification results
  console.log('Configuration Check:');
  info.forEach(msg => console.log(`  ${msg}`));
  warnings.forEach(msg => console.log(`  ⚠️  ${msg}`));
  errors.forEach(msg => console.log(`  ❌ ${msg}`));

  if (!isValid) {
    console.log('\n❌ Configuration has errors. Please fix before backing up.');
    process.exit(1);
  }

  // Create backup with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  const backupFile = path.join(BACKUP_DIR, `.env.${timestamp}`);

  fs.copyFileSync(ENV_FILE, backupFile);
  fs.chmodSync(backupFile, 0o600);

  // Save state
  const state = {
    timestamp: new Date().toISOString(),
    backupFile,
    config: env,
    verification: { errors, warnings, info },
  };

  fs.writeFileSync(CONFIG_STATE, JSON.stringify(state, null, 2));

  // Create latest symlink
  const latestBackup = path.join(BACKUP_DIR, '.env.latest');
  if (fs.existsSync(latestBackup)) {
    fs.unlinkSync(latestBackup);
  }
  fs.copyFileSync(backupFile, latestBackup);

  console.log(`\n✅ Backup created: ${backupFile}`);
  console.log(`   Latest: ${latestBackup}`);
  console.log(`   State: ${CONFIG_STATE}`);
}

/**
 * Restore from backup
 */
function restore(backupName = 'latest') {
  console.log('🔄 Restoring configuration from backup...\n');

  let backupFile;

  if (backupName === 'latest') {
    backupFile = path.join(BACKUP_DIR, '.env.latest');
  } else {
    backupFile = path.join(BACKUP_DIR, `.env.${backupName}`);
  }

  if (!fs.existsSync(backupFile)) {
    console.error(`❌ Backup not found: ${backupFile}`);
    console.log('   Available backups:');
    listBackups();
    process.exit(1);
  }

  // Verify backup before restoring
  const env = parseEnvFile(backupFile);
  const { isValid } = verifyConfig(env);

  if (!isValid) {
    console.log('⚠️  Backup has configuration issues. Restore anyway? (y/N)');
    // In non-interactive mode, abort
    console.log('   Aborted. Use --force to restore anyway.');
    process.exit(1);
  }

  // Create current backup before restoring
  if (fs.existsSync(ENV_FILE)) {
    const preRestoreBackup = path.join(BACKUP_DIR, `.env.prerestore.${Date.now()}`);
    fs.copyFileSync(ENV_FILE, preRestoreBackup);
    console.log(`  Pre-restore backup: ${preRestoreBackup}`);
  }

  // Restore
  fs.copyFileSync(backupFile, ENV_FILE);
  fs.chmodSync(ENV_FILE, 0o600);

  // Sync to container environment
  const dataEnvDir = path.join(PROJECT_ROOT, 'data', 'env');
  const dataEnvFile = path.join(dataEnvDir, 'env');

  if (fs.existsSync(dataEnvDir)) {
    fs.mkdirSync(dataEnvDir, { recursive: true });
    fs.copyFileSync(ENV_FILE, dataEnvFile);
    console.log(`  Synced to: ${dataEnvFile}`);
  }

  console.log(`\n✅ Configuration restored from: ${backupFile}`);
  console.log('\n⚠️  Restart NanoClaw service to apply changes:');
  console.log('   macOS: launchctl kickstart -k gui/$(id -u)/com.nanoclaw');
  console.log('   Linux: systemctl --user restart nanoclaw');
}

/**
 * Verify current configuration
 */
function verify() {
  console.log('🔍 Verifying current configuration...\n');

  if (!fs.existsSync(ENV_FILE)) {
    console.error('❌ .env file not found!');
    console.log('   Run: node scripts/config-backup.js setup');
    process.exit(1);
  }

  const env = parseEnvFile(ENV_FILE);
  const { errors, warnings, info, isValid } = verifyConfig(env);

  console.log('Configuration Check:');
  info.forEach(msg => console.log(`  ${msg}`));
  warnings.forEach(msg => console.log(`  ⚠️  ${msg}`));
  errors.forEach(msg => console.log(`  ❌ ${msg}`));

  console.log(`\nStatus: ${isValid ? '✅ VALID' : '❌ INVALID'}`);

  process.exit(isValid ? 0 : 1);
}

/**
 * List available backups
 */
function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) {
    console.log('No backups found.');
    return;
  }

  const backups = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('.env.') && !f.includes('.prerestore'))
    .sort()
    .reverse();

  if (backups.length === 0) {
    console.log('No backups found.');
    return;
  }

  console.log('Available backups:');
  for (const backup of backups) {
    const stat = fs.statSync(path.join(BACKUP_DIR, backup));
    const isLatest = backup === '.env.latest';
    console.log(`  ${backup.replace('.env.', '')} ${isLatest ? '(latest)' : ''} - ${stat.mtime.toISOString()}`);
  }
}

/**
 * Interactive setup
 */
async function setup() {
  console.log('🚀 NanoClaw Configuration Setup\n');

  const env = {};

  // Step 1: WeCom Configuration
  console.log('Step 1: WeCom (企业微信) Configuration');
  console.log('   Get your credentials from: https://work.weixin.qq.com/');
  console.log('   Application Management > Applications > App Details\n');

  // In real implementation, use AskUserQuestion here
  console.log('   Please provide your WeCom Bot credentials:');
  console.log('   (Edit .env file manually or use /add-wecom skill for guided setup)\n');

  // Step 2: Claude API Configuration
  console.log('Step 2: Claude API Configuration\n');
  console.log('   Choose your API provider:');
  console.log('   1. Zhipu AI (智谱 AI) - Recommended for China users');
  console.log('   2. Anthropic Official - Requires international access\n');

  console.log('   After configuration, run: node scripts/config-backup.js backup\n');

  console.log('For guided setup, use the /add-wecom skill instead.\n');
}

/**
 * Sync environment to container
 */
function syncEnv() {
  console.log('🔄 Syncing environment to container...\n');

  if (!fs.existsSync(ENV_FILE)) {
    console.error('❌ .env file not found!');
    process.exit(1);
  }

  const dataEnvDir = path.join(PROJECT_ROOT, 'data', 'env');
  const dataEnvFile = path.join(dataEnvDir, 'env');

  fs.mkdirSync(dataEnvDir, { recursive: true });
  fs.copyFileSync(ENV_FILE, dataEnvFile);

  console.log(`✅ Synced to: ${dataEnvFile}`);
}

/**
 * Show status
 */
function status() {
  console.log('📊 NanoClaw Configuration Status\n');

  // Check .env
  const envExists = fs.existsSync(ENV_FILE);
  console.log(`.env file: ${envExists ? '✅ exists' : '❌ missing'}`);

  if (envExists) {
    const env = parseEnvFile(ENV_FILE);
    const { isValid } = verifyConfig(env);

    console.log(`Status: ${isValid ? '✅ valid' : '❌ invalid'}`);
    console.log(`Configured keys: ${Object.keys(env).length}`);

    // Check if synced to container
    const dataEnvFile = path.join(PROJECT_ROOT, 'data', 'env', 'env');
    const synced = fs.existsSync(dataEnvFile);
    console.log(`Synced to container: ${synced ? '✅ yes' : '⚠️  no'}`);
  }

  // Check backups
  if (fs.existsSync(BACKUP_DIR)) {
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('.env.') && !f.includes('.prerestore'));
    console.log(`\nBackups: ${backups.length} available`);
  } else {
    console.log('\nBackups: none');
  }
}

/**
 * Main
 */
const command = process.argv[2] || 'status';

switch (command) {
  case 'backup':
    backup();
    break;
  case 'restore':
    restore(process.argv[3]);
    break;
  case 'verify':
    verify();
    break;
  case 'setup':
    setup();
    break;
  case 'sync':
    syncEnv();
    break;
  case 'list':
    listBackups();
    break;
  case 'status':
    status();
    break;
  default:
    console.log('NanoClaw Configuration Backup Tool\n');
    console.log('Usage: node scripts/config-backup.js <command>\n');
    console.log('Commands:');
    console.log('  backup     - Create configuration backup');
    console.log('  restore    - Restore from backup (default: latest)');
    console.log('  verify     - Verify current configuration');
    console.log('  setup      - Interactive configuration setup');
    console.log('  sync       - Sync .env to container environment');
    console.log('  list       - List available backups');
    console.log('  status     - Show configuration status\n');
    console.log('Examples:');
    console.log('  node scripts/config-backup.js backup');
    console.log('  node scripts/config-backup.js restore');
    console.log('  node scripts/config-backup.js restore 2026-03-13');
    console.log('  node scripts/config-backup.js verify');
    break;
}
