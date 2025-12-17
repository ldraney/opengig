#!/usr/bin/env node

/**
 * opengig - Free, open freelance marketplace
 *
 * This launcher:
 * 1. Ensures MCP server config exists
 * 2. Handles auth separately (needs browser)
 * 3. Launches Claude Code with opengig context
 */

import { spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Command } from 'commander';
import chalk from 'chalk';
import open from 'open';
import { createServer } from 'http';
import { URL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONFIG_DIR = join(homedir(), '.opengig');
const SESSION_FILE = join(CONFIG_DIR, 'session.json');

const program = new Command();

program
  .name('opengig')
  .description('Free, open freelance marketplace. Terminal-native. AI-assisted. No fees ever.')
  .version('0.1.0');

// Main command - launches Claude Code with opengig
program
  .command('start', { isDefault: true })
  .description('Start opengig (launches Claude Code with marketplace tools)')
  .action(async () => {
    // Check if authenticated
    if (!isAuthenticated()) {
      console.log(chalk.yellow('\n⚠️  Not logged in to opengig\n'));
      console.log('Run ' + chalk.cyan('npx opengig auth') + ' first to connect your LinkedIn account.\n');
      process.exit(1);
    }

    // Ensure MCP config exists
    await ensureMcpConfig();

    console.log(chalk.bold('\n🚀 Starting opengig...\n'));
    console.log(chalk.dim('Launching Claude Code with marketplace tools\n'));

    // Launch claude in the opengig directory (or current directory)
    const claudeProcess = spawn('claude', [], {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: {
        ...process.env,
      },
    });

    claudeProcess.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        console.log(chalk.red('\n❌ Claude Code not found\n'));
        console.log('Install it with: ' + chalk.cyan('npm install -g @anthropic-ai/claude-code'));
        console.log('Or see: https://claude.ai/claude-code\n');
      } else {
        console.error(chalk.red('Failed to start Claude Code:'), err.message);
      }
      process.exit(1);
    });

    claudeProcess.on('exit', (code) => {
      process.exit(code || 0);
    });
  });

// Auth command - handles LinkedIn OAuth
program
  .command('auth')
  .description('Authenticate with LinkedIn')
  .option('-l, --logout', 'Log out of current session')
  .option('--status', 'Check authentication status')
  .action(async (options) => {
    if (options.status) {
      if (isAuthenticated()) {
        const session = JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));
        console.log(chalk.green('\n✓ Logged in'));
        console.log(chalk.dim(`  User ID: ${session.user_id}`));
        console.log(chalk.dim(`  Expires: ${new Date(session.expires_at).toLocaleDateString()}\n`));
      } else {
        console.log(chalk.yellow('\n⚠️  Not logged in\n'));
      }
      return;
    }

    if (options.logout) {
      if (existsSync(SESSION_FILE)) {
        writeFileSync(SESSION_FILE, '{}');
      }
      console.log(chalk.green('\n✓ Logged out\n'));
      return;
    }

    // Check for required env vars
    const supabaseUrl = process.env.OPENGIG_SUPABASE_URL;
    const linkedinClientId = process.env.OPENGIG_LINKEDIN_CLIENT_ID;

    if (!supabaseUrl || !linkedinClientId) {
      console.log(chalk.red('\n❌ Missing configuration\n'));
      console.log('Set these environment variables:');
      console.log(chalk.dim('  OPENGIG_SUPABASE_URL=https://xxx.supabase.co'));
      console.log(chalk.dim('  OPENGIG_SUPABASE_ANON_KEY=your-anon-key'));
      console.log(chalk.dim('  OPENGIG_LINKEDIN_CLIENT_ID=your-client-id\n'));
      process.exit(1);
    }

    console.log(chalk.bold('\n🔗 opengig - LinkedIn Authentication\n'));
    console.log(chalk.dim('Opening browser for LinkedIn login...'));
    console.log(chalk.dim('(Your LinkedIn account must be at least 1 year old)\n'));

    try {
      await performLinkedInAuth(linkedinClientId);
    } catch (error) {
      console.log(chalk.red(`\n❌ Authentication failed: ${error}\n`));
      process.exit(1);
    }
  });

// Config command - show/set configuration
program
  .command('config')
  .description('View or set configuration')
  .option('--show', 'Show current configuration')
  .action((options) => {
    console.log(chalk.bold('\n⚙️  opengig configuration\n'));

    const vars = [
      ['OPENGIG_SUPABASE_URL', process.env.OPENGIG_SUPABASE_URL],
      ['OPENGIG_SUPABASE_ANON_KEY', process.env.OPENGIG_SUPABASE_ANON_KEY ? '***set***' : undefined],
      ['OPENGIG_LINKEDIN_CLIENT_ID', process.env.OPENGIG_LINKEDIN_CLIENT_ID],
      ['ANTHROPIC_API_KEY', process.env.ANTHROPIC_API_KEY ? '***set***' : undefined],
    ];

    vars.forEach(([name, value]) => {
      const status = value ? chalk.green('✓') : chalk.red('✗');
      console.log(`${status} ${name}: ${value || chalk.dim('not set')}`);
    });

    console.log(chalk.dim('\nSet these in your shell profile or .env file\n'));
  });

program.parse();

// ============================================
// Helper Functions
// ============================================

function isAuthenticated(): boolean {
  if (!existsSync(SESSION_FILE)) return false;
  try {
    const session = JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));
    if (!session.user_id || !session.expires_at) return false;
    return new Date(session.expires_at) > new Date();
  } catch {
    return false;
  }
}

async function ensureMcpConfig(): Promise<void> {
  // Claude Code looks for MCP config in ~/.claude/claude_mcp_config.json
  const claudeDir = join(homedir(), '.claude');
  const mcpConfigPath = join(claudeDir, 'claude_mcp_config.json');

  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
  }

  // Path to our MCP server
  const mcpServerPath = join(__dirname, 'mcp-server.js');

  // Read existing config or create new one
  let config: { mcpServers?: Record<string, unknown> } = {};
  if (existsSync(mcpConfigPath)) {
    try {
      config = JSON.parse(readFileSync(mcpConfigPath, 'utf-8'));
    } catch {
      config = {};
    }
  }

  // Add/update opengig server
  config.mcpServers = config.mcpServers || {};
  config.mcpServers['opengig'] = {
    command: 'node',
    args: [mcpServerPath],
    env: {
      OPENGIG_SUPABASE_URL: process.env.OPENGIG_SUPABASE_URL || '',
      OPENGIG_SUPABASE_ANON_KEY: process.env.OPENGIG_SUPABASE_ANON_KEY || '',
    },
  };

  writeFileSync(mcpConfigPath, JSON.stringify(config, null, 2));
}

async function performLinkedInAuth(clientId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const state = Math.random().toString(36).substring(2, 15);
    const redirectUri = 'http://localhost:3847/callback';

    const server = createServer(async (req, res) => {
      const url = new URL(req.url || '', 'http://localhost:3847');

      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        const returnedState = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(errorPage(error));
          server.close();
          reject(new Error(error));
          return;
        }

        if (returnedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(errorPage('Invalid state'));
          server.close();
          reject(new Error('Invalid state parameter'));
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(errorPage('No code received'));
          server.close();
          reject(new Error('No authorization code'));
          return;
        }

        try {
          // Exchange code via Supabase edge function
          const supabaseUrl = process.env.OPENGIG_SUPABASE_URL!;
          const supabaseKey = process.env.OPENGIG_SUPABASE_ANON_KEY!;

          const response = await fetch(`${supabaseUrl}/functions/v1/linkedin-auth`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({ code, redirectUri }),
          });

          if (!response.ok) {
            const errorData = (await response.json()) as { message?: string };
            throw new Error(errorData.message || 'Auth failed');
          }

          const data = (await response.json()) as {
            userId: string;
            accessToken: string;
            expiresAt: string;
            name: string;
          };

          // Save session
          if (!existsSync(CONFIG_DIR)) {
            mkdirSync(CONFIG_DIR, { recursive: true });
          }
          writeFileSync(
            SESSION_FILE,
            JSON.stringify({
              user_id: data.userId,
              access_token: data.accessToken,
              expires_at: data.expiresAt,
            })
          );

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(successPage(data.name));
          server.close();

          console.log(chalk.green(`\n✓ Welcome to opengig, ${data.name}!\n`));
          console.log('Run ' + chalk.cyan('npx opengig') + ' to start the marketplace.\n');
          resolve();
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(errorPage(String(err)));
          server.close();
          reject(err);
        }
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.listen(3847, () => {
      const authUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('scope', 'openid profile email');

      open(authUrl.toString());
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Authentication timed out'));
    }, 5 * 60 * 1000);
  });
}

function successPage(name: string): string {
  return `<!DOCTYPE html>
<html><head><title>opengig - Success</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#0a0a0a;color:#fff}
.container{text-align:center}h1{color:#22c55e}p{color:#888}
</style></head><body>
<div class="container"><h1>✓ Welcome to opengig, ${name}!</h1><p>You can close this window and return to your terminal.</p></div>
</body></html>`;
}

function errorPage(error: string): string {
  return `<!DOCTYPE html>
<html><head><title>opengig - Error</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#0a0a0a;color:#fff}
.container{text-align:center}h1{color:#ef4444}p{color:#888}
</style></head><body>
<div class="container"><h1>✗ Authentication Failed</h1><p>${error}</p></div>
</body></html>`;
}
