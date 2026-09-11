import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'
import { proKeys } from '@/shared/data/keys'

/**
 * OS-2 — la couche de données du catalogue de services.
 *
 * Lecture : `list_organization_services` (RPC, SECURITY DEFINER, tout membre
 * de l'organisation) — état réel du service, affectations barber, durée
 * OBSERVÉE contre durée déclarée, et présence d'un historique. Les
 * catégories se lisent en direct sous RLS.
 *
 * Écritures : toutes par RPC. Chacune porte sa garde de rôle côté serveur et
 * refuse avec un motif nommé (`fadeup_service_refusal=…`) — le module lève
 * l'erreur BRUTE, la page la traduit (lib/refusals.ts puis `errorMessageKey`).
 *
 * Le prix est le point sensible : un barber ne doit JAMAIS envoyer la clé
 * `p_price_cents`, même à null — la garde SQL refuse sur la PRÉSENCE du
 * champ. Toutes les constructions d'arguments ci-dessous omettent donc la
 * clé plutôt que de l'annuler.
 */

export type CatalogStatus = 'active' | 'draft' | 'inactive' | 'archived'

export interface CatalogServiceRow {
  id: string
  name: string
  description: string | null
  category_id: string | null
  category_name: string | null
  duration_minutes: number
  price_cents: number
  /** Vrai = service créé sans prix (brouillon) : `price_cents` n'est PAS un prix. */
  price_pending: boolean
  is_active: boolean
  archived_at: string | null
  status: CatalogStatus
  barber_count: number
  assigned_barber_ids: string[]
  /** Moyenne mesurée, ou null quand FadeUp n'a encore rien mesuré. Jamais zéro. */
  observed_minutes: number | null
  sample_count: number
  declared_weight_percent: number
  /** Rendez-vous, passage de file, mesure ou publication rattaché : interdit de supprimer. */
  has_history: boolean
  created_at: string
}

export interface ServiceCategoryRow {
  id: string
  name: string
  display_order: number
}

export function useCatalog(organizationId: string | null, includeArchived: boolean) {
  return useQuery({
    queryKey: proKeys.catalog(organizationId ?? '', includeArchived),
    queryFn: async (): Promise<CatalogServiceRow[]> => {
      const { data, error } = await getSupabase().rpc('list_organization_services', {
        p_organization_id: organizationId ?? '',
        p_include_archived: includeArchived,
      })
      if (error) throw error
      // Les types générés déclarent les colonnes nullables comme non nulles
      // (limite du générateur sur les `returns table`). La forme réelle est
      // celle de `CatalogServiceRow`.
      const rows = (data ?? []) as unknown as CatalogServiceRow[]
      // `observed_minutes` est un `numeric` : selon la version de PostgREST il
      // arrive en nombre ou en chaîne. On le normalise ICI pour que la null-ité
      // (« rien de mesuré ») reste la seule ambiguïté possible en aval.
      return rows.map((row) => ({
        ...row,
        observed_minutes: row.observed_minutes === null ? null : Number(row.observed_minutes),
      }))
    },
    enabled: Boolean(organizationId),
    staleTime: 30_000,
  })
}

export function useServiceCategories(organizationId: string | null) {
  return useQuery({
    queryKey: proKeys.serviceCategories(organizationId ?? ''),
    queryFn: async (): Promise<ServiceCategoryRow[]> => {
      const { data, error } = await getSupabase()
        .from('service_categories')
        .select('id, name, display_order')
        .eq('organization_id', organizationId ?? '')
        .order('display_order')
        .order('name')
      if (error) throw error
      return (data ?? []) as ServiceCategoryRow[]
    },
    enabled: Boolean(organizationId),
    staleTime: 300_000,
  })
}

/**
 * Ce que la feuille d'édition envoie. `priceCents` à `undefined` signifie
 * « ce rôle n'a pas le champ prix » : aucune clé n'est envoyée à la base.
 */
export interface ServiceDraft {
  /** null = création. */
  serviceId: string | null
  name: string
  durationMinutes: number
  /** null efface la description (la RPC applique tel quel). */
  description: string | null
  /** null efface la catégorie. */
  categoryId: string | null
  /** Catégorie à créer AVANT l'enregistrement (owner/manager seulement). */
  newCategoryName: string | null
  /** `undefined` = le rôle ne peut pas tarifer ; la clé n'est pas envoyée. */
  priceCents: number | undefined
  /** Le service est-il encore un brouillon (price_pending) ? */
  isDraft: boolean
  /** Le prix courant en base — pour n'appeler `set_service_price` qu'utilement. */
  currentPriceCents: number | null
}

/**
 * Créer ou modifier un service, catégorie neuve et prix compris.
 *
 * `update_service` n'est JAMAIS appelée avec `p_price_cents` : le prix passe
 * par `set_service_price`, la seule RPC qui sait aussi ACTIVER un brouillon
 * qu'on vient de tarifer. Un seul chemin pour le prix, donc une seule garde
 * à raisonner.
 */
export function useSaveService(organizationId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (draft: ServiceDraft): Promise<void> => {
      const supabase = getSupabase()
      let categoryId = draft.categoryId

      if (draft.newCategoryName !== null) {
        const { data, error } = await supabase.rpc('create_service_category', {
          p_organization_id: organizationId ?? '',
          p_name: draft.newCategoryName,
        })
        if (error) throw error
        // Idempotente sur le nom : réutiliser une catégorie existante n'est
        // pas une erreur, c'est le comportement attendu.
        categoryId = data?.id ?? null
      }

      const description = draft.description
      // `p_description` / `p_category_id` absents valent null côté SQL et
      // EFFACENT le champ : omettre est donc bien « mettre à null ».
      const optional = {
        ...(description !== null ? { p_description: description } : {}),
        ...(categoryId !== null ? { p_category_id: categoryId } : {}),
      }

      if (draft.serviceId === null) {
        const { error } = await supabase.rpc('create_service', {
          p_organization_id: organizationId ?? '',
          p_name: draft.name,
          p_duration_minutes: draft.durationMinutes,
          ...optional,
          ...(draft.priceCents !== undefined ? { p_price_cents: draft.priceCents } : {}),
        })
        if (error) throw error
        return
      }

      const { error } = await supabase.rpc('update_service', {
        p_service_id: draft.serviceId,
        p_name: draft.name,
        p_duration_minutes: draft.durationMinutes,
        ...optional,
      })
      if (error) throw error

      const priceChanged =
        draft.priceCents !== undefined && (draft.isDraft || draft.priceCents !== draft.currentPriceCents)
      if (priceChanged) {
        const { error: priceError } = await supabase.rpc('set_service_price', {
          p_service_id: draft.serviceId,
          p_price_cents: draft.priceCents as number,
        })
        if (priceError) throw priceError
      }
    },
    onSuccess: () => {
      if (!organizationId) return
      void queryClient.invalidateQueries({ queryKey: proKeys.catalogs(organizationId) })
      void queryClient.invalidateQueries({ queryKey: proKeys.serviceCategories(organizationId) })
    },
  })
}

function useServiceAction<TInput>(
  organizationId: string | null,
  run: (input: TInput) => Promise<void>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      if (organizationId) void queryClient.invalidateQueries({ queryKey: proKeys.catalogs(organizationId) })
    },
  })
}

export function useArchiveService(organizationId: string | null) {
  return useServiceAction<string>(organizationId, async (serviceId) => {
    const { error } = await getSupabase().rpc('archive_service', { p_service_id: serviceId })
    if (error) throw error
  })
}

export function useRestoreService(organizationId: string | null) {
  return useServiceAction<string>(organizationId, async (serviceId) => {
    const { error } = await getSupabase().rpc('restore_service', { p_service_id: serviceId })
    if (error) throw error
  })
}

export function useDeleteService(organizationId: string | null) {
  return useServiceAction<string>(organizationId, async (serviceId) => {
    const { error } = await getSupabase().rpc('delete_service', { p_service_id: serviceId })
    if (error) throw error
  })
}

export interface AssignInput {
  serviceId: string
  /** Liste COMPLÈTE : la RPC remplace. Vide = toute l'équipe réalise le service. */
  barberIds: string[]
}

export function useSetServiceBarbers(organizationId: string | null) {
  return useServiceAction<AssignInput>(organizationId, async ({ serviceId, barberIds }) => {
    const { error } = await getSupabase().rpc('set_service_barbers', {
      p_service_id: serviceId,
      p_barber_ids: barberIds,
    })
    if (error) throw error
  })
}
