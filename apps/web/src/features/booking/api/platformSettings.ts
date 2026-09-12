import { useQuery } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'
import { BOOKING_WINDOW_DAYS } from '@/features/booking/lib/slots'
import { FREE_CANCEL_HOURS } from '@/shared/lib/deadline'

/**
 * PLAT-3 — les deux défauts plateforme que le CLIENT doit connaître.
 *
 * Avant ce lot, la fenêtre de réservation (90 jours) et la fenêtre
 * d'annulation libre (12 h) vivaient en dur dans le bundle : un réglage de la
 * console interne n'atteignait jamais le navigateur. Depuis que
 * `book_public_appointment` REFUSE au-delà de la fenêtre
 * (`fadeup_booking_refusal=beyond_booking_window`), un écart entre les deux
 * produirait des dates proposées puis refusées — le pire échec possible, au
 * milieu d'une réservation.
 *
 * `get_public_platform_settings()` est la seule RPC que PLAT-3 ajoute au
 * contrat de surface anonyme (45 → 46). Elle rend DEUX ENTIERS, rien d'autre.
 *
 * LES CONSTANTES RESTENT LE REPLI. Une panne de lecture ne doit pas casser une
 * réservation : tant que la réponse n'est pas là — ou si elle échoue — on garde
 * exactement le comportement d'avant PLAT-3.
 */
export interface PublicPlatformSettings {
  bookingWindowDays: number
  freeCancelHours: number
}

export const PUBLIC_PLATFORM_SETTINGS_FALLBACK: PublicPlatformSettings = {
  bookingWindowDays: BOOKING_WINDOW_DAYS,
  freeCancelHours: FREE_CANCEL_HOURS,
}

interface PublicPlatformSettingsRow {
  booking_window_days: number | null
  booking_free_cancel_hours: number | null
}

export const publicPlatformSettingsKey = ['public', 'platform-settings'] as const

export function usePublicPlatformSettings(): PublicPlatformSettings {
  const query = useQuery({
    queryKey: publicPlatformSettingsKey,
    // Ces valeurs changent quelques fois par an, et la lecture est sur le
    // chemin d'une réservation : une heure de fraîcheur suffit largement.
    staleTime: 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 1,
    queryFn: async (): Promise<PublicPlatformSettings> => {
      const { data, error } = await getSupabase().rpc('get_public_platform_settings')
      if (error) throw error
      const row = (data as PublicPlatformSettingsRow[] | null)?.[0]
      return {
        bookingWindowDays: row?.booking_window_days ?? PUBLIC_PLATFORM_SETTINGS_FALLBACK.bookingWindowDays,
        freeCancelHours: row?.booking_free_cancel_hours ?? PUBLIC_PLATFORM_SETTINGS_FALLBACK.freeCancelHours,
      }
    },
  })

  return query.data ?? PUBLIC_PLATFORM_SETTINGS_FALLBACK
}
