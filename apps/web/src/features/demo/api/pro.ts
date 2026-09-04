import { useQuery } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'
import { demoKeys } from '@/shared/data/keys'
import { useSession } from '@/shared/hooks/useSession'

/**
 * Étude C — les données opérationnelles RÉELLES du pro connecté :
 * `get_calendar_appointments` (agenda du jour), `queue_entries` (RLS org),
 * `get_service_mode_state`. Sans session professionnelle, chaque requête est
 * désactivée et la composition rend ses états vides — honnêtes, comme
 * l'exige P1c §5C. Rien n'est fabriqué pour remplir l'écran.
 */

export interface DemoProContext {
  organizationId: string
  organizationName: string
  locationId: string | null
  timezone: string
}

export function useDemoProContext() {
  const { session } = useSession()
  const query = useQuery({
    queryKey: demoKeys.proContext(),
    queryFn: async (): Promise<DemoProContext | null> => {
      const supabase = getSupabase()
      const { data: memberships, error } = await supabase
        .from('memberships')
        .select('organization_id, organizations(id, name)')
      if (error) throw error
      const membership = memberships?.[0]
      if (!membership?.organizations) return null
      const { data: locations } = await supabase
        .from('locations')
        .select('id, timezone')
        .eq('organization_id', membership.organization_id)
        .limit(1)
      const location = locations?.[0]
      return {
        organizationId: membership.organization_id,
        organizationName: membership.organizations.name,
        locationId: location?.id ?? null,
        timezone: location?.timezone ?? 'Europe/Paris',
      }
    },
    enabled: Boolean(session),
    staleTime: 60_000,
  })
  return { context: query.data ?? null, loading: Boolean(session) && query.isPending, hasSession: Boolean(session) }
}

export function useDemoProAgenda(context: DemoProContext | null) {
  const day = new Date().toISOString().slice(0, 10)
  return useQuery({
    queryKey: demoKeys.proAgenda(context?.organizationId ?? '', day),
    queryFn: async () => {
      const from = new Date()
      from.setHours(0, 0, 0, 0)
      const to = new Date(from)
      to.setDate(to.getDate() + 1)
      const { data, error } = await getSupabase().rpc('get_calendar_appointments', {
        p_organization_id: context?.organizationId ?? '',
        p_from: from.toISOString(),
        p_to: to.toISOString(),
      })
      if (error) throw error
      return data ?? []
    },
    enabled: Boolean(context),
    staleTime: 30_000,
  })
}

export function useDemoProQueue(context: DemoProContext | null) {
  return useQuery({
    queryKey: demoKeys.proQueue(context?.organizationId ?? ''),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('queue_entries')
        .select('id, status, customer_name, created_at')
        .eq('organization_id', context?.organizationId ?? '')
        .in('status', ['waiting', 'called', 'in_service'])
        .order('created_at', { ascending: true })
      if (error) throw error
      return data ?? []
    },
    enabled: Boolean(context),
    staleTime: 15_000,
  })
}

export function useDemoProModes(context: DemoProContext | null) {
  return useQuery({
    queryKey: demoKeys.proModes(context?.locationId ?? ''),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_service_mode_state', {
        p_location_id: context?.locationId ?? '',
      })
      if (error) throw error
      return data ?? []
    },
    enabled: Boolean(context?.locationId),
    staleTime: 30_000,
  })
}
