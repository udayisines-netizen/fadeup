import { useQuery } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'
import { proKeys } from '@/shared/data/keys'
import { useSession } from '@/shared/hooks/useSession'
import type { ProMembershipRole } from '@/shared/data/organization'

/**
 * OS-1 — les fauteuils d'une organisation, côté pro. Vit dans shared/data :
 * l'accueil (P1PRO) et l'agenda (OS-1) en dépendent, et `features/X`
 * n'importe jamais `features/Y`. Lecture RLS directe (membre de
 * l'organisation), y compris les barbers non publics — le comptoir travaille
 * avec qui travaille vraiment.
 */

export interface OrganizationBarber {
  id: string
  display_name: string
  is_bookable: boolean
  is_active: boolean
  location_id: string | null
  /** Le compte rattaché au fauteuil, s'il existe (staff_profiles.user_id). */
  user_id: string | null
  /** La ligne de membership du compte rattaché — cible du réglage de revenu. */
  membership_id: string | null
  membership_role: ProMembershipRole | null
  /** memberships.can_view_revenue du compte rattaché (défaut false). */
  can_view_revenue: boolean
}

export function useOrganizationBarbers(organizationId: string | null) {
  return useQuery({
    queryKey: proKeys.barbers(organizationId ?? ''),
    queryFn: async (): Promise<OrganizationBarber[]> => {
      const supabase = getSupabase()
      const [{ data: barbers, error }, { data: memberships, error: membershipsError }] = await Promise.all([
        supabase
          .from('barbers')
          .select('id, is_bookable, staff_profiles!inner(display_name, user_id, is_active, location_id)')
          .eq('organization_id', organizationId ?? ''),
        supabase
          .from('memberships')
          .select('id, user_id, role, can_view_revenue')
          .eq('organization_id', organizationId ?? ''),
      ])
      if (error) throw error
      if (membershipsError) throw membershipsError
      const byUser = new Map((memberships ?? []).map((m) => [m.user_id, m]))
      return (barbers ?? [])
        .map((row) => {
          const profile = row.staff_profiles as unknown as {
            display_name: string
            user_id: string | null
            is_active: boolean
            location_id: string | null
          }
          const membership = profile.user_id ? byUser.get(profile.user_id) : undefined
          return {
            id: row.id,
            display_name: profile.display_name,
            is_bookable: row.is_bookable,
            is_active: profile.is_active,
            location_id: profile.location_id,
            user_id: profile.user_id,
            membership_id: membership?.id ?? null,
            membership_role: (membership?.role as ProMembershipRole | undefined) ?? null,
            can_view_revenue: membership?.can_view_revenue === true,
          }
        })
        .filter((barber) => barber.is_active)
        .sort((a, b) => a.display_name.localeCompare(b.display_name))
    },
    enabled: Boolean(organizationId),
    staleTime: 60_000,
  })
}

/**
 * L'identité barber du compte CONNECTÉ dans cette organisation — pour que
 * l'agenda et l'accueil d'un barber salarié parlent de SA journée. `null` =
 * ce compte n'a pas de fauteuil (owner non coiffeur, réceptionniste).
 */
export function useMyBarberId(organizationId: string | null) {
  const { session } = useSession()
  const userId = session?.user.id ?? null
  return useQuery({
    queryKey: proKeys.myBarber(organizationId ?? '', userId ?? ''),
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await getSupabase()
        .from('barbers')
        .select('id, staff_profiles!inner(user_id)')
        .eq('organization_id', organizationId ?? '')
        .eq('staff_profiles.user_id', userId ?? '')
        .limit(1)
      if (error) throw error
      return data?.[0]?.id ?? null
    },
    enabled: Boolean(organizationId && userId),
    staleTime: 300_000,
  })
}
