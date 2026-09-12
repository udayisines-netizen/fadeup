/**
 * M1c-a — le client typé des contrats push, et POURQUOI il existe.
 *
 * `src/shared/lib/database.types.ts` est une COPIE VERBATIM du fichier du web
 * (garde anti-dérive, M1a §2). Le régénérer pour le mobile seul rendrait
 * `check:drift` rouge ; le régénérer des deux côtés toucherait `apps/web`, que
 * ce lot n'a pas le droit de modifier (OS-3 et PLAT-3 y travaillent peut-être).
 *
 * D'où ce module : UNE déclaration locale des quatre RPC de M1c-a, UN cast, et
 * des appels entièrement typés partout ailleurs. Le jour où un lot propriétaire
 * d'`apps/web` régénère les types, ce fichier disparaît sans que rien d'autre
 * ne change — la dette est déclarée au rapport, pas cachée.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/shared/lib/database.types'
import { getSupabase } from '@/shared/lib/supabase'

export type PushPlatform = 'ios' | 'android'

/** Les quatre catégories de `public.push_category`, dans l'ordre du contrat. */
export const PUSH_CATEGORIES = [
  'queue_call',
  'booking_response',
  'appointment_reminder',
  'social_post',
] as const
export type PushCategory = (typeof PUSH_CATEGORIES)[number]

export type NotificationPreferences = Record<PushCategory, boolean>

/** Les défauts du contrat (migration 20260912100100) — repris à l'identique. */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  queue_call: true,
  booking_response: true,
  appointment_reminder: true,
  social_post: false,
}

/**
 * `type` et NON `interface` : TypeScript n'accorde une signature d'index
 * IMPLICITE qu'aux alias de type. Déclaré en `interface`, ce bloc ne satisfait
 * pas `Record<string, GenericFunction>`, donc le schéma ne satisfait pas
 * `GenericSchema`, donc supabase-js résout `Schema` à `never` et `Args` à
 * `never` — mesuré : « not assignable to parameter of type 'undefined' » sur
 * chaque appel. Une heure de piège, une ligne de correctif.
 */
type PushFunctions = {
  register_push_device: {
    Args: {
      p_token: string
      p_platform: PushPlatform
      p_locale?: string
      p_queue_entry_id?: string | null
    }
    Returns: string
  }
  revoke_push_device: {
    Args: { p_token: string }
    Returns: undefined
  }
  get_my_notification_preferences: {
    Args: Record<string, never>
    Returns: NotificationPreferences[]
  }
  set_my_notification_preference: {
    Args: { p_category: PushCategory; p_enabled: boolean }
    Returns: undefined
  }
}

/**
 * Le schéma élargi. Écrit CHAMP PAR CHAMP et non en `Omit & { … }` : une
 * intersection ne satisfait pas la contrainte `GenericSchema` de supabase-js,
 * et le client retombe alors sur un schéma par défaut où `Args` vaut `never`
 * — mesuré, `tsc` refusait chaque appel avec « not assignable to parameter of
 * type 'undefined' ».
 */
type DatabaseWithPush = {
  public: {
    Tables: Database['public']['Tables']
    Views: Database['public']['Views']
    Functions: Database['public']['Functions'] & PushFunctions
    Enums: Database['public']['Enums']
    CompositeTypes: Database['public']['CompositeTypes']
  }
}

/**
 * Le MÊME client GoTrue que partout ailleurs (singleton) — seul son type est
 * élargi. Aucun second client : deux instances se disputeraient le
 * rafraîchissement du jeton de session.
 */
export function getPushSupabase(): SupabaseClient<DatabaseWithPush> {
  return getSupabase() as unknown as SupabaseClient<DatabaseWithPush>
}
