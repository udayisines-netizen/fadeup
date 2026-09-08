import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getEnv } from '@/shared/lib/env'
import type { Database } from '@/shared/lib/database.types'

export type TypedSupabaseClient = SupabaseClient<Database>

let client: TypedSupabaseClient | null = null

/**
 * LE client Supabase du mobile, typé sur le schéma généré — un singleton,
 * comme le web (deux clients GoTrue sur le même stockage se disputeraient le
 * rafraîchissement de jeton).
 *
 * Règle d'architecture (M1a §5, identique au web) : seuls
 * `features/x/api/**` et `shared/data/**` l'importent.
 *
 * M1a est entièrement anonyme (la connexion arrive en M1b) — la session est
 * néanmoins configurée proprement dès maintenant : stockage AsyncStorage,
 * pas de détection d'URL (pas de redirections OAuth web).
 */
export function getSupabase(): TypedSupabaseClient {
  if (!client) {
    const env = getEnv()
    client = createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  }
  return client
}
