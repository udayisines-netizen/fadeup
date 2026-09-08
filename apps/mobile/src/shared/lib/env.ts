/**
 * Configuration d'exécution du mobile — miroir de shared/lib/env.ts côté web,
 * sans zod (le mobile ne l'embarque pas pour deux chaînes) : la validation
 * est un contrôle explicite qui échoue TÔT et clairement.
 *
 * Les variables `EXPO_PUBLIC_*` sont inlinées par Metro (l'équivalent des
 * `VITE_*`). La clé anon est publique par construction (elle vit dans chaque
 * bundle livré) ; l'URL par défaut est l'API de production, la seule
 * atteignable depuis un iPhone en Expo Go.
 */

export interface MobileEnv {
  supabaseUrl: string
  supabaseAnonKey: string
}

let cached: MobileEnv | null = null

export function getEnv(): MobileEnv {
  if (!cached) {
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseUrl || !/^https?:\/\//.test(supabaseUrl)) {
      throw new Error(
        'EXPO_PUBLIC_SUPABASE_URL manquante ou invalide — copier .env.example vers .env.local et la renseigner.',
      )
    }
    if (!supabaseAnonKey) {
      throw new Error(
        'EXPO_PUBLIC_SUPABASE_ANON_KEY manquante — la clé anon publique vit dans infra/supabase/.env (ANON_KEY).',
      )
    }
    cached = { supabaseUrl, supabaseAnonKey }
  }
  return cached
}
