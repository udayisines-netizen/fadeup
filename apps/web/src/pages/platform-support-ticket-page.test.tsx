import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/ui/toast'
import { PlatformSupportTicketPage } from '@/pages/platform-support-ticket-page'
import { usePlatformPermissions } from '@/routes/require-platform-role'
import { usePlatformTeam } from '@/lib/queries/platform'
import {
  useAddSupportTicketMessage,
  useAssignSupportTicket,
  useCancelAppointmentAsPlatform,
  usePlatformDossier,
  useRemoveQueueEntryAsPlatform,
  useResendPlatformEmail,
  useSetSupportTicketStatus,
  useSupportTicket,
} from '@/lib/queries/platform-plat2'
import type { PlatformPermission } from '@/lib/types'

/* Le mock rend la CLÉ : les assertions portent sur ce que l'écran dit, pas sur
   un fichier de langue livré par un autre lot. */
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'fr' } }),
  }
})

vi.mock('@/routes/require-platform-role', () => ({ usePlatformPermissions: vi.fn() }))
vi.mock('@/lib/queries/platform', () => ({ usePlatformTeam: vi.fn(), useAllOrganizations: vi.fn() }))
vi.mock('@/lib/queries/platform-plat2', () => ({
  useSupportTicket: vi.fn(),
  usePlatformDossier: vi.fn(),
  useAddSupportTicketMessage: vi.fn(),
  useAssignSupportTicket: vi.fn(),
  useSetSupportTicketStatus: vi.fn(),
  useCancelAppointmentAsPlatform: vi.fn(),
  useRemoveQueueEntryAsPlatform: vi.fn(),
  useResendPlatformEmail: vi.fn(),
}))

const mockPermissions = vi.mocked(usePlatformPermissions)
const mockTicket = vi.mocked(useSupportTicket)
const mockDossier = vi.mocked(usePlatformDossier)
const mockTeam = vi.mocked(usePlatformTeam)
const mockSetStatus = vi.mocked(useSetSupportTicketStatus)

const SUPPORT = [
  'support.tickets',
  'support.dossier',
  'queue.remove',
  'email.resend',
  'appointment.cancel',
  'marketplace.withdraw',
  'tenant.read',
] as unknown as PlatformPermission[]

const SALES: PlatformPermission[] = ['crm.read', 'crm.write', 'marketplace.publish']

function grant(permissions: PlatformPermission[]) {
  mockPermissions.mockReturnValue({
    permissions,
    can: (permission: PlatformPermission) => permissions.includes(permission),
  })
}

const ticketRefetch = vi.fn()

function resolved(data: unknown) {
  return { data, isPending: false, isError: false, error: null, refetch: ticketRefetch } as never
}

function idleMutation(overrides: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, ...overrides } as never
}

const TICKET_DETAIL = {
  ticket: {
    id: 't-1',
    reference: 'T-00042',
    origin: 'gdpr_withdrawal' as const,
    subject: 'Retrait marketplace — Studio Nord',
    body: 'Le professionnel demande son retrait.',
    status: 'open' as const,
    assigned_to: null,
    assigned_to_email: null,
    opened_by_email: 'support@fadeup.test',
    due_at: '2026-09-14T09:00:00.000Z',
    hours_remaining: 11.4,
    is_overdue: false,
    organization_id: null,
    organization_name: null,
    organization_slug: null,
    professional_id: null,
    professional_display_name: null,
    professional_handle: null,
    subject_user_id: null,
    subject_user_email: null,
    appointment_id: null,
    queue_entry_id: null,
    withdrawal_request_id: 'w-1',
    resolution: null,
    resolved_at: null,
    message_count: 2,
    created_at: '2026-09-11T09:00:00.000Z',
    updated_at: '2026-09-11T09:00:00.000Z',
  },
  messages: [
    {
      id: 'm-1',
      kind: 'note' as const,
      body: 'Ouverture du dossier.',
      author_email: 'support@fadeup.test',
      metadata: {},
      created_at: '2026-09-11T09:00:00.000Z',
    },
    {
      id: 'm-2',
      kind: 'assignment' as const,
      body: 'support@fadeup.test',
      author_email: 'support@fadeup.test',
      metadata: {},
      created_at: '2026-09-11T09:05:00.000Z',
    },
  ],
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/platform/support/t-1']}>
      <ToastProvider>
        <Routes>
          <Route path="/platform/support/:ticketId" element={<PlatformSupportTicketPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('PlatformSupportTicketPage — /platform/support/:ticketId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    grant(SUPPORT)
    mockTicket.mockReturnValue(resolved(TICKET_DETAIL))
    mockDossier.mockReturnValue(resolved(undefined))
    mockTeam.mockReturnValue(resolved([]))
    vi.mocked(useAssignSupportTicket).mockReturnValue(idleMutation())
    mockSetStatus.mockReturnValue(idleMutation())
    vi.mocked(useAddSupportTicketMessage).mockReturnValue(idleMutation())
    vi.mocked(useCancelAppointmentAsPlatform).mockReturnValue(idleMutation())
    vi.mocked(useRemoveQueueEntryAsPlatform).mockReturnValue(idleMutation())
    vi.mocked(useResendPlatformEmail).mockReturnValue(idleMutation())
  })

  it('refuses the ticket to a commercial, and never fires the audited read', () => {
    grant(SALES)

    renderPage()

    expect(screen.getByText('platform:supportDesk.notForYourRole')).toBeInTheDocument()
    /*
     * `get_support_ticket` ÉCRIT une ligne d'audit à chaque appel. Un rôle qui
     * n'a rien à faire ici ne doit donc pas seulement voir un écran vide : il
     * ne doit pas laisser de trace de consultation. La garde est un composant
     * pour cette raison.
     */
    expect(mockTicket).not.toHaveBeenCalled()
    expect(mockDossier).not.toHaveBeenCalled()
  })

  it('never refetches the audited read on its own', () => {
    renderPage()

    // Ni refetch manuel, ni intervalle : un onglet ouvert n'écrit pas une
    // ligne d'audit par minute.
    expect(ticketRefetch).not.toHaveBeenCalled()
  })

  it('puts the running deadline in the header', () => {
    renderPage()

    expect(screen.getByText(/platform:supportDesk\.hoursLeft/)).toBeInTheDocument()
  })

  it('shows the whole thread, system entries included, with no way to edit or erase', () => {
    renderPage()

    const thread = screen.getByRole('list', { name: 'platform:supportDesk.thread' })
    expect(within(thread).getByText('Ouverture du dossier.')).toBeInTheDocument()
    expect(within(thread).getByText('platform:supportDesk.kindNote')).toBeInTheDocument()
    expect(within(thread).getByText('platform:supportDesk.kindAssignment')).toBeInTheDocument()
    // L'historique est en AJOUT SEUL : aucun bouton dans le fil.
    expect(within(thread).queryAllByRole('button')).toHaveLength(0)
  })

  it('says the team is not visible rather than rendering an empty assignment menu', () => {
    renderPage()

    // `list_platform_team()` rend zéro ligne sans `internal_team.read`.
    expect(screen.getByText('platform:supportDesk.teamNotVisible')).toBeInTheDocument()
    expect(screen.queryByLabelText('platform:supportDesk.assignTo')).not.toBeInTheDocument()
  })

  it('offers the assignment menu when the roster is readable, and only to handling roles', () => {
    mockTeam.mockReturnValue(
      resolved([
        { userId: 'u-1', email: 'support@fadeup.test', fullName: null, role: 'platform_support', note: null, createdAt: '2026-09-01T00:00:00.000Z', zones: [] },
        { userId: 'u-2', email: 'stagiaire@fadeup.test', fullName: null, role: 'platform_intern', note: null, createdAt: '2026-09-01T00:00:00.000Z', zones: [] },
      ]),
    )

    renderPage()

    const select = screen.getByLabelText('platform:supportDesk.assignTo')
    const options = within(select).getAllByRole('option').map((option) => option.textContent)
    // Le serveur refuse les autres rôles (`assignee_not_support`) : ne les propose pas.
    expect(options).toContain('support@fadeup.test')
    expect(options).not.toContain('stagiaire@fadeup.test')
  })

  it('refuses to resolve without a word, before the server has to', () => {
    const mutateAsync = vi.fn()
    mockSetStatus.mockReturnValue(idleMutation({ mutateAsync }))

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'platform:supportDesk.resolve' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.submit(within(dialog).getByRole('button', { name: 'platform:supportDesk.resolve' }).closest('form')!)

    return vi.waitFor(() => {
      expect(mutateAsync).not.toHaveBeenCalled()
      expect(within(dialog).getByText('platform:supportDesk.reasonRequired')).toBeInTheDocument()
    })
  })

  it('opens no file when the ticket references nobody', () => {
    renderPage()

    expect(mockDossier).not.toHaveBeenCalled()
    expect(screen.queryByText('platform:supportDesk.dossierHeading')).not.toBeInTheDocument()
  })

  it('opens the referenced files, and each one is traced', () => {
    mockTicket.mockReturnValue(
      resolved({
        ...TICKET_DETAIL,
        ticket: { ...TICKET_DETAIL.ticket, organization_id: 'org-1', organization_name: 'Studio Nord' },
      }),
    )

    renderPage()

    expect(mockDossier).toHaveBeenCalledWith('organization', 'org-1')
    expect(screen.getByText('platform:supportDesk.dossierTraced')).toBeInTheDocument()
  })

  it('opens no file at all without support.dossier — and says so', () => {
    grant(['support.tickets'] as unknown as PlatformPermission[])
    mockTicket.mockReturnValue(
      resolved({
        ...TICKET_DETAIL,
        ticket: { ...TICKET_DETAIL.ticket, organization_id: 'org-1', organization_name: 'Studio Nord' },
      }),
    )

    renderPage()

    expect(mockDossier).not.toHaveBeenCalled()
    expect(screen.getByText('platform:supportDesk.dossierNotForYourRole')).toBeInTheDocument()
  })

  it('renders the shop subscription as reading only, and says that is deliberate', () => {
    mockTicket.mockReturnValue(
      resolved({
        ...TICKET_DETAIL,
        ticket: { ...TICKET_DETAIL.ticket, organization_id: 'org-1', organization_name: 'Studio Nord' },
      }),
    )
    mockDossier.mockReturnValue(
      resolved({
        identity: {
          id: 'org-1',
          name: 'Studio Nord',
          slug: 'studio-nord',
          business_type: 'barbershop',
          country_code: 'FR',
          marketplace_visible: true,
          onboarding_completed_at: null,
          created_at: '2026-01-01T00:00:00.000Z',
        },
        locations: [],
        subscription: { plan_key: 'shop_starter', status: 'active', entitlement_source: 'stripe', provider: 'stripe', assigned_at: null },
        trial: null,
        team: [],
        upcoming_appointments: [],
        queue: [],
        support_sessions: [],
      }),
    )

    renderPage()

    expect(screen.getByText('platform:supportDesk.subscriptionReadOnly')).toBeInTheDocument()
    expect(screen.getByText('shop_starter')).toBeInTheDocument()
    for (const button of screen.getAllByRole('button')) {
      expect(button.textContent ?? '').not.toMatch(/pay|billing|facturation|paiement/i)
    }
  })

  it('surfaces the named server refusal instead of a bare failure', () => {
    mockTicket.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: { message: 'ticket introuvable', details: 'fadeup_support_refusal=not_support' },
    } as never)

    renderPage()

    expect(screen.getByText('platform:supportDesk.loadTicketFailed')).toBeInTheDocument()
    expect(screen.getByText(/not_support/)).toBeInTheDocument()
  })
})

/**
 * NI CRM, NI FACTURATION, NI MODÉRATION — verrouillé sur la source, parce
 * qu'un test de rendu ne peut rien dire d'un hook importé « pour plus tard ».
 */
describe('the ticket screen imports nothing it has no business with', () => {
  const source = readFileSync(join(process.cwd(), 'src/pages/platform-support-ticket-page.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

  it.each([
    ['le CRM', /useSalesPipeline|useProspect|useProspects|useCaptureFieldProspect/],
    ['la modération', /useModerat|useResolveReviewReport/],
    ['la facturation', /billing\.manage|useAssignPlan/],
    ['les notes clients privées', /customers\.notes|customerNotes|\bnotes\b/],
  ])('never touches %s', (_label, pattern) => {
    expect(source).not.toMatch(pattern)
  })

  it('never forces a refresh of an audited read', () => {
    expect(source).not.toMatch(/refetchInterval|\.refetch\(/)
    expect(source).not.toMatch(/invalidateQueries/)
  })

  it('never offers a system message kind the server reserves for itself', () => {
    expect(source).toMatch(/\['note', 'inbound', 'outbound'\]/)
    expect(source).not.toMatch(/kind: 'status_change'|kind: 'assignment'|kind: 'action'/)
  })
})
