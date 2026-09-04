import { useQuery } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'
import { demoKeys } from '@/shared/data/keys'

/**
 * Étude B — le profil barber réel, par les RPC publiques du contrat de
 * données : `get_public_organization`, `get_public_barber`,
 * `list_public_barber_services`, `get_public_service_state`, et
 * `get_public_professional` quand une identité revendiquée existe.
 *
 * `get_public_professional_by_handle` (prescrite par P1c §5B) est appelée en
 * SONDE documentée : le schéma ne la laisse servir que les identités
 * revendiquées ET publiques (contrainte `professionals_publication_eligibility`),
 * donc elle est structurellement vide pour tout profil non revendiqué —
 * constat remonté dans le rapport P1c.
 */

export function usePublicOrganization(slug: string | null) {
  return useQuery({
    queryKey: demoKeys.organization(slug ?? ''),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_public_organization', { p_slug: slug ?? '' })
      if (error) throw error
      return data?.[0] ?? null
    },
    enabled: Boolean(slug),
    staleTime: 60_000,
  })
}

export function useOrganizationBarbers(slug: string | null) {
  return useQuery({
    queryKey: [...demoKeys.organization(slug ?? ''), 'barbers'],
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('list_public_organization_barbers', {
        p_organization_slug: slug ?? '',
      })
      if (error) throw error
      return data ?? []
    },
    enabled: Boolean(slug),
    staleTime: 60_000,
  })
}

export function usePublicLocations(slug: string | null) {
  return useQuery({
    queryKey: [...demoKeys.organization(slug ?? ''), 'locations'],
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('list_public_locations', {
        p_organization_slug: slug ?? '',
      })
      if (error) throw error
      return data ?? []
    },
    enabled: Boolean(slug),
    staleTime: 60_000,
  })
}

export function usePublicBarber(slug: string | null, barberId: string | null) {
  return useQuery({
    queryKey: demoKeys.barber(slug ?? '', barberId ?? ''),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_public_barber', {
        p_organization_slug: slug ?? '',
        p_barber_id: barberId ?? '',
      })
      if (error) throw error
      return data?.[0] ?? null
    },
    enabled: Boolean(slug && barberId),
    staleTime: 60_000,
  })
}

export function usePublicBarberServices(slug: string | null, barberId: string | null) {
  return useQuery({
    queryKey: demoKeys.barberServices(slug ?? '', barberId ?? ''),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('list_public_barber_services', {
        p_organization_slug: slug ?? '',
        p_barber_id: barberId ?? '',
      })
      if (error) throw error
      return data ?? []
    },
    enabled: Boolean(slug && barberId),
    staleTime: 60_000,
  })
}

export function usePublicServiceState(slug: string | null, locationId: string | null, barberId?: string | null) {
  return useQuery({
    queryKey: demoKeys.serviceState(slug ?? '', locationId ?? '', barberId ?? undefined),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_public_service_state', {
        p_organization_slug: slug ?? '',
        p_location_id: locationId ?? '',
        p_barber_id: barberId ?? undefined,
      })
      if (error) throw error
      return data?.[0] ?? null
    },
    enabled: Boolean(slug && locationId),
    staleTime: 30_000,
  })
}

/** Couche sociale — n'existe que pour une identité revendiquée. */
export function usePublicProfessional(professionalId: string | null) {
  return useQuery({
    queryKey: demoKeys.professional(professionalId ?? ''),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_public_professional', {
        p_professional_id: professionalId ?? '',
      })
      if (error) throw error
      return data?.[0] ?? null
    },
    enabled: Boolean(professionalId),
    staleTime: 60_000,
  })
}

/** Sonde by-handle prescrite par P1c §5B — voir l'en-tête du fichier. */
export function useHandleProbe(handle: string | null) {
  return useQuery({
    queryKey: demoKeys.handleProbe(handle ?? ''),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_public_professional_by_handle', {
        p_handle: handle ?? '',
      })
      if (error) throw error
      return data?.[0] ?? null
    },
    enabled: Boolean(handle),
    staleTime: 60_000,
  })
}
