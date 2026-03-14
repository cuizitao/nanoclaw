#!/usr/bin/env node
/**
 * NanoClaw Health Check Tool
 *
 * Comprehensive health check for NanoClaw configuration and services.
 * Checks:
 * 1. .env file existence and validity
 * 2. Configuration integrity
 * 3. Service status
 * 4. Credential proxy connectivity
 * 5. Channel connections
 * 6. Container environment sync
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const ENV_FILE = path.join(PROJECT_ROOT, '.env');
const DATA_ENV_FILE = path.join(PROJECT_ROOT, 'data', 'env', 'env');
const SQLITE_DB = path.join(PROJECT_ROOT, 'store', 'messages.db');

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(type, message) {
  const prefix = {
    info: `${colors.blue}ℹ${colors.reset}`,
    success: `${colors.green}✓${colors.reset}`,
    error: `${colors.red}✗${colors.reset}`,
    warning: `${colors.yellow}⚠${colors.reset}`,
    header: `${colors.cyan}▶${colors.reset}`,
  }[type] || '';
  console.log(`${prefix} ${message}`);
}

function section(title) {
  console.log(`\n${colors.bright}${colors.cyan}${'='.repeat(50)}`);
  console.log(`${title}`);
  console.log(`${'='.repeat(50)}${colors.reset}\n`);
}

/**
 * Parse .env file
 */
function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const env = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      env[match[1].trim()] = match[2].trim();
    }
  }

  return env;
}

/**
 * Check .env file
 */
function checkEnvFile() {
  section('.env File Check');

  if (!fs.existsSync(ENV_FILE)) {
    log('error', '.env file not found');
    log('info', 'Run: npm run config:setup or /add-wecom skill');
    return false;
  }

  log('success', '.env file exists');

  // Check file permissions
  const stats = fs.statSync(ENV_FILE);
  const mode = (stats.mode & parseInt('777', 8)).toString(8);
  if (mode === '600') {
    log('success', `File permissions: ${mode} (secure)`);
  } else {
    log('warning', `File permissions: ${mode} (should be 600)`);
  }

  // Parse and validate
  const env = parseEnvFile(ENV_FILE);
  const keys = Object.keys(env);

  if (keys.length === 0) {
    log('error', '.env file is empty');
    return false;
  }

  log('success', `Configuration keys: ${keys.length}`);

  // Check required keys
  const requiredKeys = ['WECOM_BOT_ID', 'WECOM_SECRET', 'ANTHROPIC_API_KEY'];
  const missingKeys = requiredKeys.filter(k => !env[k]);

  if (missingKeys.length > 0) {
    log('error', `Missing required keys: ${missingKeys.join(', ')}`);
    return false;
  }

  log('success', 'All required keys present');

  // Check API configuration
  if (env.ANTHROPIC_BASE_URL) {
    if (env.ANTHROPIC_BASE_URL.includes('bigmodel.cn')) {
      log('info', 'Using Zhipu AI (智谱 AI)');
      if (!env.ANTHROPIC_BASE_URL.includes('/api/anthropic')) {
        log('warning', 'ANTHROPIC_BASE_URL should include /api/anthropic path');
      }
    } else {
      log('info', `Using custom API endpoint: ${env.ANTHROPIC_BASE_URL}`);
    }
  } else {
    log('info', 'Using Anthropic official API');
  }

  return true;
}

/**
 * Check container environment sync
 */
function checkContainerEnv() {
  section('Container Environment Sync');

  if (!fs.existsSync(ENV_FILE)) {
    log('error', '.env file not found, cannot sync');
    return false;
  }

  if (!fs.existsSync(DATA_ENV_FILE)) {
    log('warning', 'Container environment not synced');
    log('info', 'Run: npm run config:sync');
    return false;
  }

  // Compare files
  const envContent = fs.readFileSync(ENV_FILE, 'utf-8');
  const dataEnvContent = fs.readFileSync(DATA_ENV_FILE, 'utf-8');

  if (envContent === dataEnvContent) {
    log('success', 'Container environment is in sync');
    return true;
  }

  log('warning', 'Container environment is out of sync');
  log('info', 'Run: npm run config:sync');
  return false;
}

/**
 * Check service status
 */
function checkServiceStatus() {
  section('Service Status');

  try {
    const isMac = process.platform === 'darwin';
    const isLinux = process.platform === 'linux';

    if (isMac) {
      const result = execSync('launchctl list | grep nanoclaw', { encoding: 'utf-8' });
      if (result.trim()) {
        log('success', 'NanoClaw service is running (launchd)');
        return true;
      }
    } else if (isLinux) {
      try {
        execSync('systemctl --user is-active nanoclaw', { encoding: 'utf-8', stdio: 'pipe' });
        log('success', 'NanoClaw service is running (systemd)');
        return true;
      } catch {
        // Service not active
      }
    }

    log('warning', 'NanoClaw service is not running');
    log('info', 'Start with: npm run start (dev) or use launchd/systemd');
    return false;
  } catch (error) {
    log('warning', 'Could not determine service status');
    return false;
  }
}

/**
 * Check credential proxy
 */
function checkCredentialProxy() {
  section('Credential Proxy Check');

  try {
    const testPayload = JSON.stringify({
      model: 'glm-4.7',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'test' }]
    });

    const result = execSync(
      `curl -s -X POST http://127.0.0.1:3001/v1/messages \\
        -H "x-api-key: test" \\
        -H "anthropic-version: 2023-06-01" \\
        -H "content-type: application/json" \\
        -d '${testPayload}'`,
      { encoding: 'utf-8', stdio: 'pipe', timeout: 5000 }
    );

    if (result && result.length > 0) {
      try {
        const response = JSON.parse(result);
        if (response.type === 'message' || response.content) {
          log('success', 'Credential proxy is responding');
          return true;
        }
      } catch {
        // Response might be HTML error page
      }
    }

    log('error', 'Credential proxy not responding correctly');
    log('info', 'Make sure NanoClaw service is running');
    return false;
  } catch (error) {
    log('error', 'Credential proxy is not reachable');
    log('info', 'Start NanoClaw service first');
    return false;
  }
}

/**
 * Check channel connections
 */
function checkChannelConnections() {
  section('Channel Connections');

  if (!fs.existsSync(SQLITE_DB)) {
    log('warning', 'Database not found');
    return false;
  }

  try {
    // Get all registered groups
    const result = execSync(
      `sqlite3 ${SQLITE_DB} "SELECT * FROM registered_groups;"`,
      { encoding: 'utf-8', stdio: 'pipe' }
    );

    if (result.trim()) {
      const groups = result.trim().split('\n');
      log('success', `Registered groups: ${groups.length}`);

      // Count by channel (extracted from JID)
      const channelCount = {};
      for (const line of groups) {
        const [jid] = line.split('|');
        const channel = jid.split(':')[0];
        channelCount[channel] = (channelCount[channel] || 0) + 1;
      }

      for (const [channel, count] of Object.entries(channelCount)) {
        log('info', `  - ${channel}: ${count} group(s)`);
      }
      return true;
    }

    log('warning', 'No channels registered');
    return false;
  } catch (error) {
    log('warning', 'Could not check channel registrations');
    return false;
  }
}

/**
 * Check recent logs
 */
function checkRecentLogs() {
  section('Recent Log Analysis');

  const logFile = path.join(PROJECT_ROOT, 'logs', 'nanoclaw.log');

  if (!fs.existsSync(logFile)) {
    log('info', 'No log file found');
    return;
  }

  try {
    // Get last 50 lines
    const result = execSync(`tail -50 ${logFile}`, { encoding: 'utf-8', stdio: 'pipe' });

    // Check for errors
    const hasErrors = result.includes('ERROR') || result.includes('FATAL');
    const hasAuthSuccess = result.includes('企业微信认证成功');
    const hasProxy = result.includes('Credential proxy started');

    if (hasErrors) {
      log('warning', 'Recent logs contain errors');
      log('info', 'Check: tail -100 logs/nanoclaw.log');
    } else {
      log('success', 'No recent errors in logs');
    }

    if (hasAuthSuccess) {
      log('success', 'WeCom authentication successful');
    }

    if (hasProxy) {
      const match = result.match(/authMode: "([^"]+)"/);
      if (match) {
        const authMode = match[1];
        if (authMode === 'api-key') {
          log('success', `Auth mode: ${authMode} ✓`);
        } else {
          log('warning', `Auth mode: ${authMode} (should be api-key)`);
        }
      }
    }
  } catch (error) {
    log('warning', 'Could not analyze logs');
  }
}

/**
 * Main health check
 */
function main() {
  console.log(`${colors.bright}${colors.cyan}`);
  console.log('  ╔═══════════════════════════════════════════════════════╗');
  console.log(' ║        NanoClaw Health Check                          ║');
  console.log('  ╚═══════════════════════════════════════════════════════╝');
  console.log(`${colors.reset}`);

  const results = {
    envFile: checkEnvFile(),
    containerEnv: checkContainerEnv(),
    service: checkServiceStatus(),
    proxy: false, // Only check if service is running
    channels: checkChannelConnections(),
  };

  // Only check proxy if service is running
  if (results.service) {
    results.proxy = checkCredentialProxy();
  }

  checkRecentLogs();

  // Summary
  section('Health Summary');

  const total = Object.keys(results).length;
  const passed = Object.values(results).filter(v => v).length;
  const score = Math.round((passed / total) * 100);

  console.log(`Overall Score: ${score}%`);

  if (score === 100) {
    log('success', 'All checks passed! NanoClaw is healthy.\n');
    process.exit(0);
  } else if (score >= 70) {
    log('warning', 'Some checks failed. Review warnings above.\n');
    process.exit(1);
  } else {
    log('error', 'Multiple checks failed. NanoClaw needs attention.\n');
    process.exit(1);
  }
}

// Run health check
main();
