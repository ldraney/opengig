#!/usr/bin/env node

/**
 * opengig - Free, open freelance marketplace
 *
 * This launcher:
 * 1. Ensures MCP server config exists
 * 2. Handles auth via Supabase LinkedIn OIDC
 * 3. Launches Claude Code with opengig context
 */

import 'dotenv/config';
import { spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Command } from 'commander';
import chalk from 'chalk';
import open from 'open';
import { createServer } from 'http';
import { URL } from 'url';
import {
  getSupabase,
  getSupabaseUrl,
  saveSupabaseSession,
  clearSupabaseSession,
  isAuthenticated,
  getSession,
  getCurrentUser,
} from './lib/supabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const program = new Command();

program
  .name('opengig')
  .description('Free, open freelance marketplace. Terminal-native. AI-assisted. No fees ever.')
  .version('0.2.0');

// Main command - launches Claude Code with opengig
program
  .command('start', { isDefault: true })
  .description('Start opengig (launches Claude Code with marketplace tools)')
  .action(async () => {
    // Check if authenticated
    const authenticated = await isAuthenticated();
    if (!authenticated) {
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

// Auth command - handles LinkedIn OAuth via Supabase
program
  .command('auth')
  .description('Authenticate with LinkedIn')
  .option('-l, --logout', 'Log out of current session')
  .option('--status', 'Check authentication status')
  .action(async (options) => {
    if (options.status) {
      const authenticated = await isAuthenticated();
      if (authenticated) {
        const session = await getSession();
        const user = await getCurrentUser();
        console.log(chalk.green('\n✓ Logged in'));
        if (user) {
          console.log(chalk.dim(`  Name: ${user.name}`));
          console.log(chalk.dim(`  Email: ${user.email || 'not set'}`));
        }
        if (session) {
          console.log(chalk.dim(`  Expires: ${new Date(session.expires_at! * 1000).toLocaleDateString()}`));
        }
        console.log();
      } else {
        console.log(chalk.yellow('\n⚠️  Not logged in\n'));
      }
      return;
    }

    if (options.logout) {
      const db = getSupabase();
      await db.auth.signOut();
      clearSupabaseSession();
      console.log(chalk.green('\n✓ Logged out\n'));
      return;
    }

    console.log(chalk.bold('\n🔗 opengig - LinkedIn Authentication\n'));
    console.log(chalk.dim('Opening browser for LinkedIn login...'));
    console.log(chalk.dim('(LinkedIn email must be verified)\n'));

    try {
      await performSupabaseAuth();
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

    // Show current config (defaults are built-in)
    console.log(chalk.green('✓') + ' Supabase: ' + chalk.dim('configured (built-in)'));
    console.log(chalk.green('✓') + ' LinkedIn OAuth: ' + chalk.dim('configured (built-in)'));

    console.log(chalk.dim('\nAll required settings have defaults. Just run `opengig auth` to get started!\n'));
  });

program.parse();

// ============================================
// Helper Functions
// ============================================

async function ensureMcpConfig(): Promise<void> {
  // Claude Code looks for MCP config in ~/.claude/claude_mcp_config.json
  const claudeDir = join(homedir(), '.claude');
  const mcpConfigPath = join(claudeDir, 'claude_mcp_config.json');
  const { readFileSync } = await import('fs');

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

async function performSupabaseAuth(): Promise<void> {
  return new Promise((resolve, reject) => {
    const PORT = 3847;
    const redirectTo = `http://localhost:${PORT}/callback`;

    const server = createServer(async (req, res) => {
      const url = new URL(req.url || '', `http://localhost:${PORT}`);

      if (url.pathname === '/callback') {
        // Supabase redirects with tokens in the URL fragment (#access_token=...)
        // We need to serve a page that extracts them and sends them to us
        if (url.hash || !url.searchParams.has('access_token')) {
          // Serve a page that extracts hash params and posts them back
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(extractTokenPage(PORT));
          return;
        }

        // Handle the token extraction callback
        const accessToken = url.searchParams.get('access_token');
        const refreshToken = url.searchParams.get('refresh_token');
        const expiresIn = url.searchParams.get('expires_in');
        const error = url.searchParams.get('error');
        const errorDescription = url.searchParams.get('error_description');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(errorPage(errorDescription || error));
          server.close();
          reject(new Error(errorDescription || error));
          return;
        }

        if (!accessToken) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(errorPage('No access token received'));
          server.close();
          reject(new Error('No access token'));
          return;
        }

        try {
          const db = getSupabase();

          // Set the session in Supabase client
          const { data, error: sessionError } = await db.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken || '',
          });

          if (sessionError) throw sessionError;
          if (!data.session) throw new Error('No session returned');

          // Save session to file for persistence
          saveSupabaseSession(data.session);

          // Get user info
          const userName = data.session.user.user_metadata?.full_name ||
                          data.session.user.user_metadata?.name ||
                          data.session.user.email ||
                          'User';

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(successPage(userName));
          server.close();

          console.log(chalk.green(`\n✓ Welcome to opengig, ${userName}!\n`));
          console.log('Run ' + chalk.cyan('npx opengig') + ' to start the marketplace.\n');
          resolve();
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(errorPage(String(err)));
          server.close();
          reject(err);
        }
      } else if (url.pathname === '/token') {
        // POST endpoint to receive tokens from the extraction page
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          try {
            const params = new URLSearchParams(body);
            const accessToken = params.get('access_token');
            const refreshToken = params.get('refresh_token');
            const error = params.get('error');
            const errorDescription = params.get('error_description');

            if (error) {
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end(errorPage(errorDescription || error));
              server.close();
              reject(new Error(errorDescription || error));
              return;
            }

            if (!accessToken) {
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end(errorPage('No access token received'));
              server.close();
              reject(new Error('No access token'));
              return;
            }

            const db = getSupabase();

            // Set the session in Supabase client
            const { data, error: sessionError } = await db.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken || '',
            });

            if (sessionError) throw sessionError;
            if (!data.session) throw new Error('No session returned');

            // Save session to file for persistence
            saveSupabaseSession(data.session);

            // Get user info
            const userName = data.session.user.user_metadata?.full_name ||
                            data.session.user.user_metadata?.name ||
                            data.session.user.email ||
                            'User';

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(successPage(userName));
            server.close();

            console.log(chalk.green(`\n✓ Welcome to opengig, ${userName}!\n`));
            console.log('Run ' + chalk.cyan('npx opengig') + ' to start the marketplace.\n');
            resolve();
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end(errorPage(String(err)));
            server.close();
            reject(err);
          }
        });
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.listen(PORT, async () => {
      const db = getSupabase();

      // Use Supabase's built-in LinkedIn OIDC provider
      const { data, error } = await db.auth.signInWithOAuth({
        provider: 'linkedin_oidc',
        options: {
          redirectTo,
          skipBrowserRedirect: true,
        },
      });

      if (error) {
        server.close();
        reject(error);
        return;
      }

      if (data.url) {
        open(data.url);
      }
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Authentication timed out'));
    }, 5 * 60 * 1000);
  });
}

// Page to extract tokens from URL hash (Supabase uses implicit grant)
function extractTokenPage(port: number): string {
  return `<!DOCTYPE html>
<html><head><title>opengig - Authenticating...</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#0a0a0a;color:#fff}
.container{text-align:center}h1{color:#3b82f6}p{color:#888}
</style></head><body>
<div class="container"><h1>🔄 Authenticating...</h1><p>Please wait while we complete your login.</p></div>
<script>
  // Extract tokens from URL hash
  const hash = window.location.hash.substring(1);
  if (hash) {
    // POST tokens to our local server
    fetch('http://localhost:${port}/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: hash
    }).then(r => r.text()).then(html => {
      document.body.innerHTML = html;
    }).catch(e => {
      document.body.innerHTML = '<div class="container"><h1 style="color:#ef4444">✗ Error</h1><p>' + e + '</p></div>';
    });
  } else {
    document.body.innerHTML = '<div class="container"><h1 style="color:#ef4444">✗ Error</h1><p>No authentication data received</p></div>';
  }
</script>
</body></html>`;
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
