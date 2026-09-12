/**
 * M1c-a — la couche data du push. Quatre contrats, rien de plus :
 *
 *   register_push_device              enregistre/rafraîchit un jeton
 *   revoke_push_device               retire un appareil
 *   get_my_notification_preferences  mes interrupteurs (défauts si aucune ligne)
 *   set_my_notification_preference   en change un
 *
 * Règle d'architecture (M1a §5) : seuls `features/x/api/**` et `shared/data/**`
 * importent le client Supabase. Ce fichier en est.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  getPushSupabase,
  type NotificationPreferences,
  type PushCategory,
  type PushPlatform,
} from '@/features/notifications/api/pushClient'

/** Les clés de requête du lot — préfixe propre, invalidation par préfixe. */
export const pushKeys = {
  all: ['push'] as const,
  preferences: () => [...pushKeys.all, 'preferences'] as const,
}

export interface RegisterDeviceInput {
  token: string
  platform: PushPlatform
  locale: string
  /** L'entrée de file suivie, pour le cas ANONYME (pas de session). */
  queueEntryId?: string | null
}

/**
 * Enregistre le jeton. Le serveur décide seul de ce qu'il accepte : sans
 * session ET sans entrée de file vivante, il refuse (42501) — l'appelant
 * remonte l'échec, il ne le contourne pas.
 */
export async function registerPushDevice(input: RegisterDeviceInput): Promise<string> {
  const { data, error } = await getPushSupabase().rpc('register_push_device', {
    p_token: input.token,
    p_platform: input.platform,
    p_locale: input.locale,
    p_queue_entry_id: input.queueEntryId ?? null,
  })
  if (error) throw error
  return data
}

export async function revokePushDevice(token: string): Promise<void> {
  const { error } = await getPushSupabase().rpc('revoke_push_device', { p_token: token })
  if (error) throw error
}

export async function fetchNotificationPreferences(): Promise<NotificationPreferences> {
  const { data, error } = await getPushSupabase().rpc('get_my_notification_preferences')
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : null
  // Aucune ligne = aucune session côté serveur. On rend les défauts du
  // contrat plutôt que d'inventer un état d'interrupteur.
  return row ?? { ...DEFAULT_NOTIFICATION_PREFERENCES }
}

/** Mes préférences. `enabled: false` tant qu'il n'y a pas de session. */
export function useNotificationPreferences(enabled: boolean): UseQueryResult<NotificationPreferences> {
  return useQuery({
    queryKey: pushKeys.preferences(),
    queryFn: fetchNotificationPreferences,
    enabled,
    staleTime: 60_000,
  })
}

export function useSetNotificationPreference() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { category: PushCategory; enabled: boolean }) => {
      const { error } = await getPushSupabase().rpc('set_my_notification_preference', {
        p_category: input.category,
        p_enabled: input.enabled,
      })
      if (error) throw error
      return input
    },
    // Optimiste : un interrupteur doit répondre au doigt. En cas d'échec, la
    // valeur du serveur reprend la main (onSettled invalide).
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: pushKeys.preferences() })
      const previous = queryClient.getQueryData<NotificationPreferences>(pushKeys.preferences())
      if (previous) {
        queryClient.setQueryData<NotificationPreferences>(pushKeys.preferences(), {
          ...previous,
          [input.category]: input.enabled,
        })
      }
      return { previous }
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(pushKeys.preferences(), context.previous)
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: pushKeys.preferences() })
    },
  })
}
