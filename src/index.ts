import http from 'node:http';
import { parse as parseUrl } from 'node:url';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { initDb, insertConversation, getConversationById } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load env from project root: first .env, then .env.local to allow local overrides
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Validate required env vars for API server and LiveKit
function requireEnv(keys: string[]): void {
  const missing = keys.filter((k) => !process.env[k] || String(process.env[k]).trim() === '');
  if (missing.length > 0) {
    console.error('Missing required environment variables:', missing.join(', '));
    console.error('Create a .env file (you can copy from .env.example) and set these values.');
    process.exit(1);
  }
}

requireEnv(['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'DATABASE_URL']);

type ConversationRequest = {
  conversation_type?: string;
  prompt_name?: string;
  prompt_label?: string;
  agent_name?: string;
  agent_description?: string;
  webhook_link?: string;
  id?: string; // conversation id (uuid) optional
  company_name?: string;
  media_mode?: 'audio_only' | 'audio_video';
  prompt_variables?: Record<string, unknown>;
  ui_variables?: Record<string, unknown>;
  created_at?: string;
  prompt_text?: string;
  [key: string]: unknown;
};

type ConversationResponse = {
  id: string;
  url: string;
};

// in-memory cache removed; we do not reuse conversation IDs anymore

function buildConversationUrl(id: string): string {
  const base = String(process.env.FRONTEND_BASE_URL || 'https://livekit-agent-builder.vercel.app').replace(/\/$/, '');
  return `${base}/api/conversation/${encodeURIComponent(id)}`;
}

function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        const json = text ? JSON.parse(text) : {};
        resolve(json);
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = parseUrl(req.url || '/', true);

  // health check
  if (req.method === 'GET' && pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/conversations') {
    try {
      const body: ConversationRequest = await readJsonBody(req);

      // Enforce snake_case-only inputs
      const conversation_type = (body as any).conversation_type || '';
      const agent_name = (body as any).agent_name || '';
      const webhook_link = (body as any).webhook_link || '';
      const prompt_name = (body as any).prompt_name;
      const prompt_label = (body as any).prompt_label;
      const company_name = (body as any).company_name;
      const prompt_text = (body as any).prompt_text;
      const agent_description = (body as any).agent_description;
      let media_mode = (body as any).media_mode as 'audio_only' | 'audio_video' | undefined;
      const prompt_variables = (body as any).prompt_variables || {};
      const ui_variables = (body as any).ui_variables || {};
      const complete_screen = (ui_variables as any)?.complete_screen || {};

      if (!agent_name || !webhook_link || !conversation_type) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'Missing required snake_case fields: agent_name, webhook_link, conversation_type',
          }),
        );
        return;
      }

      // ensure DB is initialized
      await initDb();

      const id = body.id && body.id.trim() !== '' ? body.id : randomUUID();

      // normalize and validate media_mode
      media_mode = media_mode === 'audio_video' ? 'audio_video' : 'audio_only';

      // persist to database with new schema
      await insertConversation({
        id,
        conversation_type,
        prompt_name,
        prompt_label,
        agent_name,
        agent_description,
        webhook_link,
        company_name,
        prompt_text,
        media_mode,
        prompt_variables: (prompt_variables && typeof prompt_variables === 'object') ? prompt_variables as Record<string, unknown> : {},
        ui_variables: (ui_variables && typeof ui_variables === 'object') ? ui_variables as Record<string, unknown> : {},
        complete_screen: (complete_screen && typeof complete_screen === 'object') ? complete_screen as Record<string, unknown> : {},
      });

      const url = buildConversationUrl(id);

      const response: ConversationResponse = { id, url };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(response));
      return;
    } catch (err) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }
  }

  // GET /api/conversations/:id => return stored conversation row (including media_mode)
  if (req.method === 'GET' && pathname && pathname.startsWith('/api/conversations/')) {
    try {
      const parts = pathname.split('/');
      const id = parts[parts.length - 1];
      if (!id || id.trim() === '') {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing conversation id' }));
        return;
      }

      await initDb();
      const row = await getConversationById(id);
      if (!row) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Conversation not found' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(row));
      return;
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch conversation' }));
      return;
    }
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

const port = parseInt(process.env.PORT || '8081');
server.listen(port, () => {
  console.log(`API server listening on :${port}`);
  const agentPath = path.join(__dirname, 'agent.js');
  const child = spawn(process.execPath, [agentPath, 'start'], {
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', (code) => {
    console.log(`Agent process exited with code ${code}`);
  });
});


