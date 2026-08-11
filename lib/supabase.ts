/**
 * Server-side Supabase client, using the service-role key.
 *
 * Never import this from a client component. It deliberately does not use the
 * `server-only` guard package, because the ingest and query CLIs import this
 * module through lib/retrieve.ts and that package throws outside Next's
 * react-server condition. The key itself cannot leak regardless: Next only
 * exposes env vars prefixed NEXT_PUBLIC_ to the browser bundle, and this reads an
 * unprefixed one.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    }
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}
