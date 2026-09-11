import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { ToastProvider } from '@/components/ui/toast'
import { PlatformFieldPage } from '@/pages/platform-field-page'
import { usePlatformPermissions } from '@/routes/require-platform-role'
import { usePlatformZones } from '@/lib/queries/platform'
import { useCaptureFieldProspect, useProspects } from '@/lib/queries/platform-plat2'
import type { PlatformPermission } from '@/lib/types'

/*
 * Les zones de l'utilisateur courant sont lues directement sur
 * `platform_member_zones` par un hook local à la page (aucun hook partagé ne
 * les rend). Le client est donc doublé ici, et `zoneRows` pilote le cas
 * « aucune zone affectée ».
 */
const stub = vi.hoisted(() => ({ zoneRows: [] as { zone_id: string }[] }))

vi.mock('@/lib/supabase', () => ({
  getSupabaseClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: stub.zoneRows, error: null }),
      }),
    }),
  }),
}))

// maplibre veut un contexte WebGL ; jsdom n'en a pas. Le montage réel est
// couvert par la QA navigateur, pas par un test unitaire.
vi.mock('maplibre-gl', () => {
  class FakeMap {
    addControl() {}
    remove() {}
    fitBounds() {}
  }
  class FakeMarker {
    setLngLat() {
      return this
    }
    setPopup() {
      return this
    }
    addTo() {
      return this
    }
    remove() {}
  }
  class FakePopup {
    setDOMContent() {
      return this
    }
  }
  class FakeNavigationControl {}
  class FakeLngLatBounds {
    extend() {}
  }
  return {
    Map: FakeMap,
    Marker: FakeMarker,
    Popup: FakePopup,
    NavigationControl: FakeNavigationControl,
    LngLatBounds: FakeLngLatBounds,
  }
})

vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'intern-1' }, session: {}, loading: false }) }))
vi.mock('@/routes/require-platform-role', () => ({ usePlatformPermissions: vi.fn() }))
vi.mock('@/lib/queries/platform', () => ({ usePlatformZones: vi.fn() }))
vi.mock('@/lib/queries/platform-plat2', () => ({ useProspects: vi.fn(), useCaptureFieldProspect: vi.fn() }))

const mockPermissions = vi.mocked(usePlatformPermissions)
const mockZones = vi.mocked(usePlatformZones)
const mockProspects = vi.mocked(useProspects)
const mockCapture = vi.mocked(useCaptureFieldProspect)

/**
 * Les clés `fieldDesk` sont livrées séparément dans `src/locales/**` par le
 * lot qui rassemble les traductions de PLAT-2. Le bundle est enregistré ici
 * pour que les assertions portent sur du TEXTE stable, que les clés soient
 * déjà fusionnées ou non.
 */
const FIELD_DESK_EN = {
  title: 'Field',
  noAccess: "This screen isn't visible with your role.",
  noAccessHint: 'Working the field needs a zone right or a field-capture right.',
  noZones: 'No zone is assigned to you',
  noZonesHint: 'The founder assigns them.',
  map: 'Map',
  list: 'List',
  viewLabel: 'Map or list',
  searchLabel: 'Search a shop',
  unplaced_one: "{{count}} shop has no coordinates and can't be placed.",
  unplaced_other: "{{count}} shops have no coordinates and can't be placed.",
  unplacedAction: 'Open the list',
  shown_one: '{{count}} shop',
  shown_other: '{{count}} shops',
  loadFailed: "Couldn't load the shops",
  capture: 'Record a shop',
  originFieldBadge: 'Field',
  originWorkerBadge: 'Worker V2',
  doNotContact: 'Do not contact',
  observedLabel: 'Observed',
  noAddress: 'No address recorded',
  setupTitle: 'Set a shop up',
  setupBody: 'Setup creates the shop of the signed-in account.',
  setupAction: 'Open setup',
  observationLabel: 'What you observed',
  observationHint: 'Required.',
  nameLabel: 'Shop name',
  cityLabel: 'City',
  countryLabel: 'Country (ISO-2)',
  addressLabel: 'Address (optional)',
  postalLabel: 'Postal code (optional)',
  typeBarbershop: 'Barbershop',
  typeIndependent: 'Independent barber',
  submit: 'Record',
  captureIntro: 'What you saw with your own eyes.',
  nothingHere: 'No shop yet',
  nothingHereHint: 'Record the first one you walk past.',
  noResults: 'No shop matches this search',
  mapNothingToPlace: 'Nothing to place on the map',
}

const INTERN_PERMISSIONS: PlatformPermission[] = ['crm.zone_read', 'crm.field_capture']
const SUPPORT_PERMISSIONS: PlatformPermission[] = ['tenant.read', 'appointment.cancel', 'support_view.enter']

function permissions(list: PlatformPermission[]) {
  return { permissions: list, can: (permission: PlatformPermission) => list.includes(permission) }
}

function prospect(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    canonical_name: 'Fade City',
    type: 'barbershop',
    status: 'new',
    origin: 'field' as const,
    country: 'FR',
    phone_e164: null,
    email: null,
    do_not_contact: false,
    field_observation: 'Trois fauteuils, deux barbiers, caisse sur papier.',
    field_captured_at: '2026-09-10T09:00:00.000Z',
    current_score: null,
    city: 'Lyon',
    postal_code: '69003',
    address_line: '12 rue de la Part-Dieu',
    latitude: 45.76,
    longitude: 4.85,
    ...overrides,
  }
}

/** `import.meta.url` est une URL http sous jsdom — le chemin se résout depuis la racine vitest. */
function pageSourcePath(): string {
  const candidates = [
    resolve(process.cwd(), 'src/pages/platform-field-page.tsx'),
    resolve(process.cwd(), 'apps/web/src/pages/platform-field-page.tsx'),
  ]
  const found = candidates.find((candidate) => existsSync(candidate))
  if (!found) throw new Error('platform-field-page.tsx introuvable depuis ' + process.cwd())
  return found
}

function resolved(data: unknown) {
  return { data, isPending: false, isError: false, error: null } as never
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <PlatformFieldPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('PlatformFieldPage — /platform/field', () => {
  beforeAll(() => {
    for (const lng of new Set([i18n.language, i18n.resolvedLanguage ?? 'en', 'en'])) {
      i18n.addResourceBundle(lng, 'platform', { fieldDesk: FIELD_DESK_EN }, true, true)
    }
  })

  beforeEach(() => {
    stub.zoneRows = [{ zone_id: 'z-1' }]
    mockPermissions.mockReturnValue(permissions(INTERN_PERMISSIONS))
    mockZones.mockReturnValue(resolved([{ id: 'z-1', country: 'FR', city: 'Lyon', label: 'Lyon', postalCodeHint: null, isActive: true }]))
    mockProspects.mockReturnValue(resolved([prospect()]))
    mockCapture.mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)
  })

  it('rend une phrase honnête, pas un écran vide, à un rôle sans droit terrain', async () => {
    // Le support lit les dossiers et annule un rendez-vous : ni crm.zone_read ni crm.field_capture.
    mockPermissions.mockReturnValue(permissions(SUPPORT_PERMISSIONS))

    renderPage()

    expect(await screen.findByTestId('field-denied')).toBeInTheDocument()
    expect(screen.getByText("This screen isn't visible with your role.")).toBeInTheDocument()
    // Et rien du métier terrain n'est rendu — ni la carte, ni la liste, ni la saisie.
    expect(screen.queryByTestId('field-results')).not.toBeInTheDocument()
    expect(screen.queryByTestId('field-map')).not.toBeInTheDocument()
    expect(screen.queryByTestId('field-capture-open')).not.toBeInTheDocument()
    expect(screen.queryByTestId('field-setup')).not.toBeInTheDocument()
  })

  it("s'ouvre sur la CARTE, la liste en second", async () => {
    renderPage()

    expect(await screen.findByTestId('field-map')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Map/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /List/ })).not.toBeChecked()
    expect(screen.queryByTestId('field-prospect-p-1')).not.toBeInTheDocument()
  })

  it('ne rend AUCUNE action de publication marketplace au stagiaire', async () => {
    renderPage()
    await screen.findByTestId('field-map')

    const controls = [...screen.getAllByRole('button'), ...screen.getAllByRole('link')]
    for (const control of controls) {
      expect(control.textContent ?? '').not.toMatch(/publish|publier/i)
    }

    // La garde qui compte : la page n'importe même pas le contrat de
    // publication. Une revue humaine peut oublier ce détail, pas ce test.
    const source = readFileSync(pageSourcePath(), 'utf8')
    expect(source).not.toMatch(/usePublishExternalProfessional/)
    expect(source).not.toMatch(/publish_external_professional/)
    // Ni les affiches QR : le stagiaire attribue en SCANNANT, par /a/<code>.
    expect(source).not.toMatch(/Poster/)
    // Ni le pipeline d'ensemble, qui rend zéro ligne à un stagiaire.
    expect(source).not.toMatch(/useSalesPipeline/)
  })

  it('dit combien de fiches la carte ne peut pas placer, et la liste les garde toutes', async () => {
    mockProspects.mockReturnValue(
      resolved([
        prospect(),
        prospect({ id: 'p-2', canonical_name: 'Barbier du Coin', latitude: null, longitude: null, address_line: null, postal_code: null }),
      ]),
    )

    renderPage()

    expect(await screen.findByText(/1 shop has no coordinates/)).toBeInTheDocument()

    await userEvent.click(screen.getByTestId('field-unplaced-to-list'))

    expect(screen.getByTestId('field-prospect-p-1')).toBeInTheDocument()
    expect(screen.getByTestId('field-prospect-p-2')).toBeInTheDocument()
    expect(screen.queryByTestId('field-map')).not.toBeInTheDocument()
  })

  it("ne prétend pas que la zone est vide quand la carte ne peut rien placer", async () => {
    mockProspects.mockReturnValue(
      resolved([prospect({ latitude: null, longitude: null }), prospect({ id: 'p-2', latitude: null, longitude: null })]),
    )

    renderPage()

    expect(await screen.findByText('Nothing to place on the map')).toBeInTheDocument()
    expect(screen.getByText(/2 shops have no coordinates/)).toBeInTheDocument()
    expect(screen.queryByText('No shop yet')).not.toBeInTheDocument()

    await userEvent.click(screen.getByTestId('field-unplaced-to-list'))
    expect(screen.getByTestId('field-prospect-p-1')).toBeInTheDocument()
    expect(screen.getByTestId('field-prospect-p-2')).toBeInTheDocument()
  })

  it("nomme l'origine et l'observation d'une fiche terrain, et signale do_not_contact", async () => {
    mockProspects.mockReturnValue(
      resolved([prospect({ do_not_contact: true }), prospect({ id: 'p-2', canonical_name: 'Salon Scrapé', origin: 'worker', field_observation: null })]),
    )

    renderPage()
    await userEvent.click(screen.getByRole('radio', { name: /List/ }))

    const fieldCard = screen.getByTestId('field-prospect-p-1')
    expect(within(fieldCard).getByText('Field')).toBeInTheDocument()
    expect(within(fieldCard).getByText(/Trois fauteuils/)).toBeInTheDocument()
    expect(within(fieldCard).getByText('Do not contact')).toBeInTheDocument()

    const workerCard = screen.getByTestId('field-prospect-p-2')
    expect(within(workerCard).getByText('Worker V2')).toBeInTheDocument()
    expect(within(workerCard).queryByText(/Observed/)).not.toBeInTheDocument()
  })

  it("dit clairement qu'aucune zone n'est affectée, plutôt que d'afficher une liste muette", async () => {
    stub.zoneRows = []

    renderPage()

    expect(await screen.findByTestId('field-no-zones')).toBeInTheDocument()
    expect(screen.getByText('No zone is assigned to you')).toBeInTheDocument()
    // L'écran reste utilisable : ses propres saisies lui restent visibles.
    expect(screen.getByTestId('field-map')).toBeInTheDocument()
  })

  it("n'offre pas la saisie terrain sans crm.field_capture", async () => {
    mockPermissions.mockReturnValue(permissions(['crm.zone_read']))

    renderPage()

    expect(await screen.findByTestId('field-map')).toBeInTheDocument()
    expect(screen.queryByTestId('field-capture-open')).not.toBeInTheDocument()
  })

  it("ouvre le formulaire de saisie en feuille, avec l'observation obligatoire", async () => {
    renderPage()
    await userEvent.click(await screen.findByTestId('field-capture-open'))

    const sheet = await screen.findByTestId('field-capture-sheet')
    expect(within(sheet).getByLabelText('Shop name')).toBeInTheDocument()
    expect(within(sheet).getByLabelText('City')).toBeInTheDocument()
    expect(within(sheet).getByLabelText('Country (ISO-2)')).toBeInTheDocument()
    expect(within(sheet).getByLabelText('What you observed')).toBeInTheDocument()
    expect(within(sheet).getByTestId('field-capture-submit')).toBeInTheDocument()
  })

  it("dit la vérité sur l'installation : elle crée le salon du compte connecté", async () => {
    renderPage()

    const link = await screen.findByTestId('field-setup-link')
    expect(link).toHaveAttribute('href', '/setup')
    expect(screen.getByText(/Setup creates the shop of the signed-in account/)).toBeInTheDocument()
  })

  it('remonte un échec de chargement au lieu de laisser croire que la zone est vide', async () => {
    mockProspects.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error('permission denied for table prospects'),
    } as never)

    renderPage()

    expect(await screen.findByText("Couldn't load the shops")).toBeInTheDocument()
    expect(screen.queryByText('No shop yet')).not.toBeInTheDocument()
  })
})
