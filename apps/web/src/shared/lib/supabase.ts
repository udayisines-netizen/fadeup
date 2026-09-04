import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseClient } from '@/lib/supabase'
import type { Database } from '@/shared/lib/database.types'

export type TypedSupabaseClient = SupabaseClient<Database>

/**
 * The ONE browser Supabase client, typed on the generated `Database` schema.
 *
 * Deliberately the same runtime instance as the legacy `@/lib/supabase`
 * singleton that the retained /platform surface authenticates with: two
 * GoTrue clients over one storage key would race each other on token
 * refresh. This module is the single legacy bridge for it — everything V2
 * imports it from here, and ONLY the feature api layers (src/features/x/api)
 * plus the shared data infrastructure are allowed to, enforced by ESLint
 * (`no-restricted-imports`).
 */
export function getSupabase(): TypedSupabaseClient {
  const client = getSupabaseClient() as unknown as TypedSupabaseClient
  if (import.meta.env.DEV) {
    // Observabilité e2e uniquement : permet à Playwright de vérifier qu'aucun
    // canal realtime ne survit à une navigation. Absent du build de production.
    ;(window as { __fuSupabase?: TypedSupabaseClient }).__fuSupabase = client
  }
  return client
}
