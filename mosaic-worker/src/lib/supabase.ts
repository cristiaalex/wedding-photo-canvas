import { createClient, SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';
import { config } from '../config';

/**
 * Service-role Supabase client. Bypasses RLS — use ONLY inside this worker.
 * Singleton so we don't open a new connection per request.
 */
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: { 'x-client-info': 'mosaic-worker' },
      },
      realtime: {
        // Node.js < 22 has no native WebSocket; provide ws as transport.
        transport: ws as any,
      },
    });
  }
  return client;
}
