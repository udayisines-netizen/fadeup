import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { List, MapPin, Plus } from 'lucide-react'
import { usePlatformPermissions } from '@/routes/require-platform-role'
import { useAuth } from '@/lib/auth-context'
import { getSupabaseClient } from '@/lib/supabase'
import { usePlatformZones, type PlatformZone } from '@/lib/queries/platform'
import { useCaptureFieldProspect, useProspects, type ProspectListRow } from '@/lib/queries/platform-plat2'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { BottomSheet, BottomSheetBody, BottomSheetContent, BottomSheetFooter, BottomSheetHeader, BottomSheetDescription, BottomSheetTitle } from '@/components/ui/bottom-sheet'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { PageHeader } from '@/components/ui/page-header'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { SelectField } from '@/components/ui/select-field'
import { Skeleton } from '@/components/ui/skeleton'
import { TextField } from '@/components/ui/text-field'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { getErrorMessage } from '@/lib/get-error-message'

/**
 * /platform/field — L'ÉCRAN DU STAGIAIRE, ET LE SEUL ÉCRAN INTERNE DESSINÉ
 * POUR LE TÉLÉPHONE.
 *
 * Il travaille dehors, debout, souvent d'une seule main. D'où l'exception
 * explicite de la spec PLAT-2 §7 : cet écran s'écarte de la densité des
 * autres surfaces /platform. Tout est dessiné à 390 px d'abord — pas de
 * tableau, cibles ≥ 44 px, action principale collée en bas dans la zone du
 * pouce, formulaire à un champ par ligne. Le bureau n'est que le même écran
 * élargi.
 *
 * CE QUE CET ÉCRAN NE FAIT PAS. Il ne publie RIEN sur la marketplace :
 * aucun bouton, et surtout aucun import du hook de publication — le test
 * unitaire relit CE FICHIER et échoue si le nom y réapparaît, parce qu'une
 * revue humaine peut laisser passer un import, pas un test. Il n'affiche ni
 * pipeline d'ensemble (la RPC de résumé commercial rend zéro ligne à un
 * stagiaire), ni campagne, ni modération, ni support, ni affiche QR — le
 * stagiaire attribue une affiche en la SCANNANT, donc par la page publique
 * `/a/<code>`.
 */
export function PlatformFieldPage() {
  const { t } = useTranslation()
  const { can } = usePlatformPermissions()

  // Conditionnement, pas autorisation : chaque table et chaque RPC derrière
  // cet écran repose la question côté serveur. Ce qui n'est pas permis n'est
  // pas rendu — ni bouton grisé, ni cadenas, une phrase honnête.
  if (!can('crm.zone_read') && !can('crm.field_capture')) {
    return (
      <Container size="lg" className="py-8">
        <PageHeader title={t('platform:fieldDesk.title')} />
        <div className="mt-6" data-testid="field-denied">
          <Card>
            <CardContent className="p-4 pt-4">
              <EmptyState
                className="border-none"
                title={t('platform:fieldDesk.noAccess')}
                description={t('platform:fieldDesk.noAccessHint')}
              />
            </CardContent>
          </Card>
        </div>
      </Container>
    )
  }

  return <FieldDesk canCapture={can('crm.field_capture')} seesEveryProspect={can('crm.read')} />
}

// ============================================================================
// Les zones du stagiaire
// ============================================================================

/**
 * MES zones. Aucun hook existant ne les rend pour l'utilisateur courant :
 * `usePlatformTeam` passe par `list_platform_team`, gardée par
 * `is_platform_admin()`, et un stagiaire en reçoit zéro ligne. Le hook vit
 * DANS ce fichier plutôt que dans `@/lib/queries/platform` parce que PLAT-2
 * ne touche pas aux modules de requêtes de PLAT-1 ; les conventions (clé de
 * cache préfixée `platform`, client partagé, ligne brute puis projection)
 * sont celles du module voisin, pas une deuxième architecture.
 *
 * La policy `platform_member_zones_select` ne rend que `user_id = auth.uid()`
 * — et tout, au fondateur. Le `.eq()` ci-dessous n'est donc PAS une garde :
 * il rend la question juste pour un fondateur, qui verrait sinon les zones
 * de toute l'équipe sous le titre « vos zones ».
 */
function useMyZoneIds(userId: string | undefined) {
  return useQuery({
    queryKey: ['platform', 'my-zones', userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<string[]> => {
      if (!userId) return []
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.from('platform_member_zones').select('zone_id').eq('user_id', userId)
      if (error) throw error
      return ((data ?? []) as { zone_id: string }[]).map((row) => row.zone_id)
    },
  })
}

// ============================================================================
// Les refus nommés de capture_field_prospect
// ============================================================================

/**
 * `capture_field_prospect` NE FUSIONNE JAMAIS. Un doublon est refusé en le
 * nommant, et l'humain tranche. Les motifs arrivent par
 * `DETAIL: fadeup_field_capture_refusal=<code>` — lu sur le CODE, jamais sur
 * le texte du message (même motif que `shared/lib/bookingRefusals.ts`).
 * PostgREST met le DETAIL dans `error.details` ; certains clients le
 * recopient dans `error.message`, donc les deux sont inspectés.
 */
const FIELD_CAPTURE_REFUSALS = [
  'not_authorized',
  'name_required',
  'country_required',
  'city_required',
  'observation_required',
  'outside_my_zones',
  'prospect_already_known',
] as const

type FieldCaptureRefusal = (typeof FIELD_CAPTURE_REFUSALS)[number]

const REFUSAL_PATTERN = /fadeup_field_capture_refusal=([a-z_]+)/

const REFUSAL_MESSAGE_KEY: Record<FieldCaptureRefusal, string> = {
  not_authorized: 'platform:fieldDesk.refusalNotAuthorized',
  name_required: 'platform:fieldDesk.refusalName',
  country_required: 'platform:fieldDesk.refusalCountry',
  city_required: 'platform:fieldDesk.refusalCity',
  observation_required: 'platform:fieldDesk.refusalObservation',
  outside_my_zones: 'platform:fieldDesk.refusalOutsideZones',
  prospect_already_known: 'platform:fieldDesk.refusalAlreadyKnown',
}

function parseFieldCaptureRefusal(raw: unknown): FieldCaptureRefusal | null {
  if (typeof raw !== 'object' || raw === null) return null
  const candidates = [(raw as { details?: unknown }).details, (raw as { message?: unknown }).message]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const match = REFUSAL_PATTERN.exec(candidate)
    const code = match?.[1]
    if (code && (FIELD_CAPTURE_REFUSALS as readonly string[]).includes(code)) {
      return code as FieldCaptureRefusal
    }
  }
  return null
}

// ============================================================================
// L'écran
// ============================================================================

type FieldView = 'map' | 'list'

function FieldDesk({ canCapture, seesEveryProspect }: { canCapture: boolean; seesEveryProspect: boolean }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [view, setView] = useState<FieldView>('map')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search, 300)
  const [captureOpen, setCaptureOpen] = useState(false)

  /*
   * AUCUN FILTRE DE ZONE CÔTÉ CLIENT, ET C'EST VOLONTAIRE. Ce qui borne un
   * stagiaire à ses zones (plus ses propres saisies) est
   * `private.platform_prospect_visible()`, posée par les policies de PLAT-1 :
   * la RLS rend déjà exactement les lignes permises. Un `.filter()` ici
   * n'aurait été qu'une garde d'interface — c'est-à-dire rien — tout en
   * laissant croire qu'une protection existe.
   */
  const prospectsQuery = useProspects({ search: debouncedSearch })
  const prospects = useMemo(() => prospectsQuery.data ?? [], [prospectsQuery.data])

  const placed = useMemo(() => prospects.filter(hasCoordinates), [prospects])
  const unplacedCount = prospects.length - placed.length

  return (
    <Container size="lg" className={canCapture ? 'pb-32 pt-6' : 'pb-10 pt-6'}>
      <PageHeader title={t('platform:fieldDesk.title')} subtitle={t('platform:fieldDesk.subtitle')} />

      <ZoneBanner userId={user?.id} seesEveryProspect={seesEveryProspect} />

      <div className="mt-5 flex flex-col gap-3">
        <SegmentedControl<FieldView>
          ariaLabel={t('platform:fieldDesk.viewLabel')}
          value={view}
          onChange={setView}
          options={[
            { value: 'map', label: t('platform:fieldDesk.map'), icon: <MapPin className="h-4 w-4" /> },
            { value: 'list', label: t('platform:fieldDesk.list'), icon: <List className="h-4 w-4" /> },
          ]}
          className="sm:max-w-xs"
        />

        <TextField
          label={t('platform:fieldDesk.searchLabel')}
          type="search"
          inputMode="search"
          autoComplete="off"
          spellCheck={false}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          data-testid="field-search"
        />
      </div>

      <div className="mt-4" data-testid="field-results">
        {prospectsQuery.isPending ? (
          <Skeleton className="h-[60svh] min-h-72 w-full" />
        ) : prospectsQuery.isError ? (
          <ErrorState
            title={t('platform:fieldDesk.loadFailed')}
            description={getErrorMessage(prospectsQuery.error)}
          />
        ) : prospects.length === 0 ? (
          <EmptyState
            title={debouncedSearch ? t('platform:fieldDesk.noResults') : t('platform:fieldDesk.nothingHere')}
            description={debouncedSearch ? undefined : t('platform:fieldDesk.nothingHereHint')}
          />
        ) : view === 'map' ? (
          /* Beaucoup de fiches n'ont PAS de coordonnées : `locations.latitude`
             est saisie à la main. La carte DIT combien elle ne peut pas
             placer, au lieu de les faire disparaître en silence — et elles
             restent atteignables par la liste. Quand elle ne peut en placer
             AUCUNE, elle le dit ainsi : « rien à placer », jamais « aucun
             salon », qui serait faux puisque la liste, elle, en a. */
          placed.length === 0 ? (
            <EmptyState
              icon={MapPin}
              title={t('platform:fieldDesk.mapNothingToPlace')}
              description={t('platform:fieldDesk.unplaced', { count: unplacedCount })}
              action={
                <Button variant="secondary" onClick={() => setView('list')} data-testid="field-unplaced-to-list">
                  {t('platform:fieldDesk.unplacedAction')}
                </Button>
              }
            />
          ) : (
            <div className="flex flex-col gap-3">
              {unplacedCount > 0 ? (
                <Alert variant="info">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span>{t('platform:fieldDesk.unplaced', { count: unplacedCount })}</span>
                    <Button variant="secondary" onClick={() => setView('list')} data-testid="field-unplaced-to-list">
                      {t('platform:fieldDesk.unplacedAction')}
                    </Button>
                  </div>
                </Alert>
              ) : null}

              <ProspectMap points={placed} />
            </div>
          )
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-xs font-medium uppercase tracking-wider text-ink-500">
              {t('platform:fieldDesk.shown', { count: prospects.length })}
            </p>
            <ul className="flex flex-col gap-2">
              {prospects.map((prospect) => (
                <li key={prospect.id}>
                  <ProspectCard prospect={prospect} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <SetupCard />

      {/* L'action principale vit dans la zone du pouce, pas en haut de page.
          `env(safe-area-inset-bottom)` garde le bouton au-dessus de la barre
          d'accueil iOS. */}
      {canCapture ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-paper-0 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <div className="mx-auto w-full max-w-5xl">
            <Button
              size="lg"
              className="w-full sm:w-72"
              leftIcon={<Plus className="h-5 w-5" />}
              onClick={() => setCaptureOpen(true)}
              data-testid="field-capture-open"
            >
              {t('platform:fieldDesk.capture')}
            </Button>
          </div>
        </div>
      ) : null}

      {canCapture && captureOpen ? <CaptureSheet onClose={() => setCaptureOpen(false)} /> : null}
    </Container>
  )
}

function hasCoordinates(
  prospect: ProspectListRow,
): prospect is ProspectListRow & { latitude: number; longitude: number } {
  return prospect.latitude != null && prospect.longitude != null
}

/** Une valeur qui ne suit le clavier qu'après une pause — une requête par frappe, dehors, en 4G, coûte cher. */
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}

// ============================================================================
// La zone — dite à l'écran, jamais supposée
// ============================================================================

function ZoneBanner({ userId, seesEveryProspect }: { userId: string | undefined; seesEveryProspect: boolean }) {
  const { t } = useTranslation()
  const zoneIdsQuery = useMyZoneIds(userId)
  const zonesQuery = usePlatformZones()

  // Un commercial, un admin ou le fondateur portent `crm.field_capture` sans
  // être bornés à une zone : leur dire « aucune zone ne vous est affectée »
  // serait faux. La RLS leur rend tout, l'écran le dit.
  if (seesEveryProspect) {
    return (
      <div className="mt-5" data-testid="field-zone-banner">
        <Alert variant="info">{t('platform:fieldDesk.zonesUnbounded')}</Alert>
      </div>
    )
  }

  if (zoneIdsQuery.isPending || zonesQuery.isPending) {
    return <Skeleton className="mt-5 h-14 w-full" />
  }

  if (zoneIdsQuery.isError) {
    return (
      <div className="mt-5" data-testid="field-zone-banner">
        <Alert variant="error">
          {t('platform:fieldDesk.zonesFailed')}
          {getErrorMessage(zoneIdsQuery.error) ? ` — ${getErrorMessage(zoneIdsQuery.error)}` : ''}
        </Alert>
      </div>
    )
  }

  const zoneIds = zoneIdsQuery.data ?? []

  if (zoneIds.length === 0) {
    return (
      <div className="mt-5" data-testid="field-no-zones">
        <Alert variant="warning">
          <p className="font-medium">{t('platform:fieldDesk.noZones')}</p>
          <p className="mt-0.5">{t('platform:fieldDesk.noZonesHint')}</p>
        </Alert>
      </div>
    )
  }

  const zones: PlatformZone[] = (zonesQuery.data ?? []).filter((zone) => zoneIds.includes(zone.id))

  return (
    <div className="mt-5" data-testid="field-zone-banner">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-4 pt-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-500">
            {t('platform:fieldDesk.yourZones')}
          </span>
          {zones.map((zone) => (
            <Badge key={zone.id} variant="accent">
              {zone.country} · {zone.label}
            </Badge>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

// ============================================================================
// La carte
// ============================================================================

/**
 * Le montage maplibre est celui de `platform-acquisition-map-page.tsx` :
 * tuiles raster OpenStreetMap (aucun jeton payant), attribution exigée par la
 * politique d'usage OSM, un marqueur par fiche géolocalisée. Repris tel quel
 * plutôt que réinventé — une deuxième façon de monter une carte dans le même
 * dépôt serait une architecture parallèle.
 *
 * Deux écarts, tous deux pour le téléphone : le marqueur est un élément DOM
 * porteur des JETONS du dépôt (le marqueur par défaut de maplibre veut une
 * couleur en dur, ce que le contrat de style interdit), et il mesure 32 px
 * pour rester touchable.
 */
const DEFAULT_CENTER: [number, number] = [2.3522, 48.8566]

function ProspectMap({ points }: { points: (ProspectListRow & { latitude: number; longitude: number })[] }) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: DEFAULT_CENTER,
      zoom: 5,
    })
    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    for (const marker of markersRef.current) marker.remove()
    markersRef.current = []

    for (const point of points) {
      const element = document.createElement('button')
      element.type = 'button'
      element.className =
        'flex h-8 w-8 items-center justify-center rounded-full border border-paper-0 bg-paper-0/70 shadow-sm'
      element.setAttribute('aria-label', point.canonical_name)
      const dot = document.createElement('span')
      dot.className = `block h-4 w-4 rounded-full border-2 border-paper-0 ${
        point.origin === 'field' ? 'bg-accent-600' : 'bg-info-600'
      }`
      element.appendChild(dot)

      const popupNode = document.createElement('div')
      popupNode.className = 'flex flex-col gap-1'

      const nameEl = document.createElement('p')
      nameEl.className = 'text-sm font-semibold text-ink-950'
      nameEl.textContent = point.canonical_name
      popupNode.appendChild(nameEl)

      const placeEl = document.createElement('p')
      placeEl.className = 'text-xs text-ink-500'
      placeEl.textContent = formatPlace(point) ?? t('platform:fieldDesk.noAddress')
      popupNode.appendChild(placeEl)

      // L'origine est écrite en toutes lettres : la couleur du marqueur ne
      // porte jamais l'information seule.
      const originEl = document.createElement('p')
      originEl.className = 'text-xs font-medium text-ink-700'
      originEl.textContent =
        point.origin === 'field'
          ? t('platform:fieldDesk.originFieldBadge')
          : t('platform:fieldDesk.originWorkerBadge')
      popupNode.appendChild(originEl)

      const marker = new maplibregl.Marker({ element })
        .setLngLat([point.longitude, point.latitude])
        .setPopup(new maplibregl.Popup({ offset: 20 }).setDOMContent(popupNode))
        .addTo(map)

      markersRef.current.push(marker)
    }

    if (points.length > 0) {
      const bounds = new maplibregl.LngLatBounds()
      for (const point of points) bounds.extend([point.longitude, point.latitude])
      map.fitBounds(bounds, { padding: 48, maxZoom: 14, duration: 0 })
    }
  }, [points, t])

  return (
    <div
      role="region"
      aria-label={t('platform:fieldDesk.mapLabel')}
      className="h-[60svh] min-h-72 w-full overflow-hidden rounded-lg border border-border sm:h-[32rem]"
      data-testid="field-map"
    >
      <div ref={containerRef} className="h-full w-full" />
    </div>
  )
}

// ============================================================================
// La liste — des cartes tactiles, jamais un tableau
// ============================================================================

function formatPlace(prospect: ProspectListRow): string | null {
  const town = [prospect.postal_code, prospect.city].filter(Boolean).join(' ')
  const parts = [prospect.address_line, town].filter((part) => Boolean(part && part.trim()))
  return parts.length > 0 ? parts.join(' · ') : null
}

function ProspectCard({ prospect }: { prospect: ProspectListRow }) {
  const { t } = useTranslation()
  const place = formatPlace(prospect)

  return (
    <Card data-testid={`field-prospect-${prospect.id}`}>
      <CardContent className="flex flex-col gap-2 p-4 pt-4">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 break-words text-base font-semibold text-ink-950">{prospect.canonical_name}</p>
          <Badge variant={prospect.origin === 'field' ? 'accent' : 'neutral'} className="shrink-0">
            {prospect.origin === 'field'
              ? t('platform:fieldDesk.originFieldBadge')
              : t('platform:fieldDesk.originWorkerBadge')}
          </Badge>
        </div>

        <p className="text-sm text-ink-500">{place ?? t('platform:fieldDesk.noAddress')}</p>

        {prospect.origin === 'field' && prospect.field_observation ? (
          <p className="rounded-md bg-paper-50 px-3 py-2 text-sm text-ink-700">
            <span className="font-medium text-ink-950">{t('platform:fieldDesk.observedLabel')} : </span>
            {prospect.field_observation}
          </p>
        ) : null}

        {prospect.do_not_contact ? (
          <Badge variant="danger" className="self-start">
            {t('platform:fieldDesk.doNotContact')}
          </Badge>
        ) : null}
      </CardContent>
    </Card>
  )
}

// ============================================================================
// Installer un salon — et la limite, écrite honnêtement
// ============================================================================

/**
 * LA LIMITE, DITE PLUTÔT QUE MASQUÉE. Le parcours `/setup` existe depuis F1,
 * mais `private.assert_organization_creation_authorized()` n'autorise la
 * création que par `create_organization()` — qui fait de L'APPELANT le
 * propriétaire — ou par l'approbation d'une candidature. Aucun contrat
 * « installer au nom de » n'existe. Si le stagiaire ouvrait /setup avec son
 * compte, il créerait un salon qui lui appartient, ce qui serait faux. Le
 * lien reste, accompagné de la vérité.
 */
function SetupCard() {
  const { t } = useTranslation()

  return (
    <Card className="mt-6" data-testid="field-setup">
      <CardContent className="flex flex-col gap-2 p-4 pt-4">
        <h2 className="text-sm font-semibold text-ink-950">{t('platform:fieldDesk.setupTitle')}</h2>
        <p className="text-sm text-ink-500">{t('platform:fieldDesk.setupBody')}</p>
        <Link
          to="/setup"
          className={buttonVariants({ variant: 'secondary' }, 'mt-1 self-start')}
          data-testid="field-setup-link"
        >
          {t('platform:fieldDesk.setupAction')}
        </Link>
      </CardContent>
    </Card>
  )
}

// ============================================================================
// Enregistrer un prospect sur le terrain
// ============================================================================

const captureSchema = z.object({
  type: z.enum(['barbershop', 'independent_barber']),
  canonicalName: z.string().trim().min(1),
  country: z.string().trim().length(2),
  city: z.string().trim().min(1),
  observation: z.string().trim().min(1),
  addressLine: z.string(),
  postalCode: z.string(),
  phone: z.string(),
  email: z.string(),
})

type CaptureFormValues = z.infer<typeof captureSchema>

function CaptureSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const capture = useCaptureFieldProspect()

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CaptureFormValues>({
    resolver: zodResolver(captureSchema),
    defaultValues: {
      type: 'barbershop',
      canonicalName: '',
      country: 'FR',
      city: '',
      observation: '',
      addressLine: '',
      postalCode: '',
      phone: '',
      email: '',
    },
  })

  async function onSubmit(values: CaptureFormValues) {
    try {
      await capture.mutateAsync({
        type: values.type,
        canonicalName: values.canonicalName.trim(),
        country: values.country.trim().toUpperCase(),
        city: values.city.trim(),
        observation: values.observation.trim(),
        addressLine: values.addressLine.trim() || null,
        postalCode: values.postalCode.trim() || null,
        phone: values.phone.trim() || null,
        email: values.email.trim() || null,
      })
      toast({ title: t('platform:fieldDesk.saved'), variant: 'success' })
      onClose()
    } catch (error) {
      const refusal = parseFieldCaptureRefusal(error)
      toast({
        title: t('platform:fieldDesk.refusalTitle'),
        description: refusal ? t(REFUSAL_MESSAGE_KEY[refusal]) : getErrorMessage(error),
        variant: 'error',
      })
    }
  }

  return (
    <BottomSheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <BottomSheetContent data-testid="field-capture-sheet">
        {/* Un champ par ligne, de gros libellés, le bouton d'envoi collé en
            bas : le stagiaire remplit ça debout, d'une seule main. */}
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-1 flex-col">
          <BottomSheetHeader>
            <BottomSheetTitle>{t('platform:fieldDesk.capture')}</BottomSheetTitle>
            <BottomSheetDescription>{t('platform:fieldDesk.captureIntro')}</BottomSheetDescription>
          </BottomSheetHeader>

          <BottomSheetBody className="flex flex-col gap-4 py-4">
            <SelectField
              label={t('common:field.type')}
              options={[
                { value: 'barbershop', label: t('platform:fieldDesk.typeBarbershop') },
                { value: 'independent_barber', label: t('platform:fieldDesk.typeIndependent') },
              ]}
              {...register('type')}
            />

            <TextField
              label={t('platform:fieldDesk.nameLabel')}
              autoComplete="off"
              autoCapitalize="words"
              error={errors.canonicalName ? t('platform:fieldDesk.required') : undefined}
              {...register('canonicalName')}
            />

            <TextField
              label={t('platform:fieldDesk.cityLabel')}
              autoComplete="off"
              autoCapitalize="words"
              error={errors.city ? t('platform:fieldDesk.required') : undefined}
              {...register('city')}
            />

            <TextField
              label={t('platform:fieldDesk.countryLabel')}
              maxLength={2}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="uppercase"
              error={errors.country ? t('platform:fieldDesk.countryFormat') : undefined}
              {...register('country')}
            />

            {/* OBLIGATOIRE, et c'est la raison d'être de la fiche : sans
                observation elle ne vaut pas mieux qu'une ligne scrapée. Le
                serveur refuse sans (`observation_required`). */}
            <Textarea
              label={t('platform:fieldDesk.observationLabel')}
              rows={4}
              hint={t('platform:fieldDesk.observationHint')}
              error={errors.observation ? t('platform:fieldDesk.required') : undefined}
              {...register('observation')}
            />

            <TextField label={t('platform:fieldDesk.addressLabel')} autoComplete="off" {...register('addressLine')} />
            <TextField
              label={t('platform:fieldDesk.postalLabel')}
              autoComplete="off"
              inputMode="numeric"
              {...register('postalCode')}
            />
            <TextField
              label={t('common:field.phoneOptional')}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              {...register('phone')}
            />
            <TextField
              label={t('common:field.emailOptional')}
              type="email"
              inputMode="email"
              autoComplete="off"
              spellCheck={false}
              {...register('email')}
            />
          </BottomSheetBody>

          <BottomSheetFooter>
            <Button
              type="submit"
              size="lg"
              className="w-full"
              isLoading={isSubmitting || capture.isPending}
              data-testid="field-capture-submit"
            >
              {t('platform:fieldDesk.submit')}
            </Button>
            <Button type="button" variant="ghost" size="lg" className="w-full" onClick={onClose}>
              {t('common:action.cancel')}
            </Button>
          </BottomSheetFooter>
        </form>
      </BottomSheetContent>
    </BottomSheet>
  )
}
