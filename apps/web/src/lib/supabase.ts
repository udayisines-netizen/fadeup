import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getEnv } from '@/lib/env'

let client: SupabaseClient | null = null

/**
 * Lazily-created browser Supabase client, scoped to the anon/publishable
 * key only. All tenant authorization is enforced by RLS, not this client.
 */
export function getSupabaseClient(): SupabaseClient {
  if (!client) {
    const env = getEnv()
    client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
  }
  return client
}
