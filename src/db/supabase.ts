import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger';

// Polyfill WebSocket for Node.js < 22 (required by @supabase/realtime-js)
import WebSocket from 'ws';
if (!(globalThis as any).WebSocket) {
  (globalThis as any).WebSocket = WebSocket;
}

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }

  _client = createClient(url, key, {
    auth: { persistSession: false },
  });

  logger.info('Supabase client initialized');
  return _client;
}
