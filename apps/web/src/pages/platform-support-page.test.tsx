import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/ui/toast'
import { PlatformSupportPage } from '@/pages/platform-support-page'
import { usePlatformPermissions } from '@/routes/require-platform-role'
import { useAllOrganizations } from '@/lib/queries/platform'
import {
  useCompleteWithdrawal,
  useMarketplaceWithdrawals,
  useOpenSupportTicket,
  useSupportTickets,
} from '@/lib/queries/platform-plat2'
import type { PlatformPermission } from '@/lib/types'

/*
 * Les libellés passent par `t()`. Le mock rend la CLÉ, pas la traduction : les
 * assertions portent alors sur ce que l'écran décide de dire, pas sur le
 * fichier de langue — qui vit dans un autre lot et changerait ces tests pour
 * une raison qui n'a rien à voir avec le comportement.
 */
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'fr' } }),
  }
})

vi.mock('@/routes/require-platform-role', () => ({ usePlatformPermissions: vi.fn() }))

vi.mock('@/lib/queries/platform', () => ({
  useAllOrganizations: vi.fn(),
  usePlatformTeam: vi.fn(),
}))

vi.mock('@/lib/queries/platform-plat2', () => ({
  useSupportTickets: vi.fn(),
  useMarketplaceWithdrawals: vi.fn(),
  useOpenSupportTicket: vi.fn(),
  useCompleteWithdrawal: vi.fn(),
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
const mockTickets = vi.mocked(useSupportTickets)
const mockWithdrawals = vi.mocked(useMarketplaceWithdrawals)
const mockOrganizations = vi.mocked(useAllOrganizations)
const mockOpenTicket = vi.mocked(useOpenSupportTicket)
const mockComplete = vi.mocked(useCompleteWithdrawal)

/** Le jeu de droits d'un support : tickets, dossiers, retraits, et rien du CRM. */
const SUPPORT: PlatformPermission[] = [
  'support.tickets',
  'support.dossier',
  'queue.remove',
  'email.resend',
  'appointment.cancel',
  'marketplace.withdraw',
  'tenant.read',
] as unknown as PlatformPermission[]

/** Le jeu de droits d'un commercial. Aucun ne donne accès au support. */
const SALES: PlatformPermission[] = ['crm.read', 'crm.write', 'marketplace.publish', 'onboarding.review']

function grant(permissions: PlatformPermission[]) {
  mockPermissions.mockReturnValue({
    permissions,
    can: (permission: PlatformPermission) => permissions.includes(permission),
  })
}

function resolved(data: unknown) {
  return { data, isPending: false, isError: false, error: null, refetch: vi.fn() } as never
}

function idleMutation() {
  return { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, variables: undefined } as never
}

const OVERDUE_WITHDRAWAL = {
  id: 'w-1',
  professional_id: 'pro-1',
  professional_display_name: 'Studio Nord',
  professional_handle: 'studio-nord',
  is_still_public: true,
  requested_via: 'email_link',
  requested_at: '2026-09-05T09:00:00.000Z',
  deadline_at: '2026-09-08T09:00:00.000Z',
  // La base dit -7,5 heures. L'écran doit dire 7,5 — pas ce que l'horloge du
  // poste calculerait à partir de `deadline_at`.
  hours_remaining: -7.5,
  is_overdue: true,
  status: 'pending' as const,
  decided_at: null,
}

const TICKET = {
  id: 't-1',
  reference: 'T-00042',
  origin: 'phone' as const,
  subject: 'Rendez-vous introuvable',
  status: 'open' as const,
  assigned_to: null,
  assigned_to_email: null,
  due_at: null,
  hours_remaining: null,
  is_overdue: false,
  organization_id: null,
  organization_name: null,
  professional_id: null,
  professional_display_name: null,
  withdrawal_request_id: null,
  message_count: 2,
  created_at: '2026-09-11T08:00:00.000Z',
  updated_at: '2026-09-11T08:00:00.000Z',
}

/**
 * Les commentaires NOMMENT ce que l'écran refuse de faire — « les notes clients
 * privées ne sont rendues nulle part ». Les garder ferait échouer la recherche
 * sur la prose qui l'explique ; seul le CODE est interrogé.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <PlatformSupportPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('PlatformSupportPage — /platform/support', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    grant(SUPPORT)
    mockTickets.mockReturnValue(resolved([]))
    mockWithdrawals.mockReturnValue(resolved([]))
    mockOrganizations.mockReturnValue(resolved([]))
    mockOpenTicket.mockReturnValue(idleMutation())
    mockComplete.mockReturnValue(idleMutation())
  })

  it('refuses the screen to a commercial, and calls no support RPC at all', () => {
    grant(SALES)

    renderPage()

    expect(screen.getByText('platform:supportDesk.notForYourRole')).toBeInTheDocument()
    expect(screen.queryByText('platform:supportDesk.queue')).not.toBeInTheDocument()
    // La garde est un composant : rien n'est monté, donc rien n'est demandé.
    expect(mockTickets).not.toHaveBeenCalled()
    expect(mockWithdrawals).not.toHaveBeenCalled()
  })

  it('puts the 72-hour deadlines ABOVE the ticket queue', () => {
    mockWithdrawals.mockReturnValue(resolved([OVERDUE_WITHDRAWAL]))
    mockTickets.mockReturnValue(resolved([TICKET]))

    renderPage()

    const deadlines = screen.getByText('platform:supportDesk.deadlines')
    const queue = screen.getByText('platform:supportDesk.queue')
    expect(deadlines.compareDocumentPosition(queue) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows the deadline the DATABASE computed, never a client-side recount', () => {
    mockWithdrawals.mockReturnValue(resolved([OVERDUE_WITHDRAWAL]))

    renderPage()

    // `hours_remaining` = -7,5 et `is_overdue` = true viennent du serveur.
    expect(screen.getByText(/supportDesk\.overdueBy/)).toBeInTheDocument()
    expect(screen.getByText('platform:supportDesk.overdueCount')).toBeInTheDocument()
  })

  it('flags what is APPROACHING the deadline, not only what is already late', () => {
    mockWithdrawals.mockReturnValue(
      resolved([{ ...OVERDUE_WITHDRAWAL, hours_remaining: 6.2, is_overdue: false }]),
    )

    renderPage()

    expect(screen.getByText('platform:supportDesk.dueSoonCount')).toBeInTheDocument()
    expect(screen.queryByText('platform:supportDesk.overdueCount')).not.toBeInTheDocument()
  })

  it('does not fetch the withdrawal queue when the role cannot act on it', () => {
    grant(['support.tickets' as unknown as PlatformPermission])

    renderPage()

    expect(screen.getByText('platform:supportDesk.deadlinesNotVisible')).toBeInTheDocument()
    expect(mockWithdrawals).not.toHaveBeenCalled()
  })

  it('keeps the order the database sent, and never re-sorts it', () => {
    const late = { ...TICKET, id: 't-late', reference: 'T-00001', is_overdue: true, hours_remaining: -3 }
    const recent = { ...TICKET, id: 't-recent', reference: 'T-00099' }
    mockTickets.mockReturnValue(resolved([late, recent]))

    renderPage()

    const references = screen
      .getAllByRole('link')
      .map((link) => link.textContent)
      .filter((text) => text?.startsWith('T-'))
    expect(references).toEqual(['T-00001', 'T-00099'])
  })

  it('says why the queue is empty rather than showing a bare table', () => {
    renderPage()

    expect(screen.getByText('platform:supportDesk.queueEmpty')).toBeInTheDocument()
  })

  it('surfaces a load failure instead of implying the queue is clear', () => {
    mockTickets.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: { message: 'permission denied', details: 'fadeup_support_refusal=not_support' },
    } as never)

    renderPage()

    expect(screen.getByText('platform:supportDesk.queueError')).toBeInTheDocument()
    // Le motif nommé du refus serveur est rendu, pas avalé.
    expect(screen.getByText(/not_support/)).toBeInTheDocument()
    expect(screen.queryByText('platform:supportDesk.queueEmpty')).not.toBeInTheDocument()
  })

  it('says there is no customer lookup instead of pretending to offer one', () => {
    renderPage()

    expect(screen.getByText('platform:supportDesk.noCustomerSearch')).toBeInTheDocument()
    expect(screen.queryByLabelText(/phone|email/i)).not.toBeInTheDocument()
  })

  it('hides the shop-file opener from a role without support.dossier', () => {
    grant(['support.tickets', 'marketplace.withdraw'] as unknown as PlatformPermission[])

    renderPage()

    expect(screen.queryByText('platform:supportDesk.openShopDossier')).not.toBeInTheDocument()
  })

  it('renders the withdrawal deadlines table with its own empty state', () => {
    renderPage()

    const table = screen.getByRole('region', { name: 'platform:supportDesk.deadlines' })
    expect(within(table).getByText('platform:supportDesk.noWithdrawals')).toBeInTheDocument()
  })
})

/**
 * PAS DE CRM, PAS DE FACTURATION, PAS DE MODÉRATION — verrouillé sur la SOURCE.
 *
 * Un test de rendu ne peut prouver qu'une absence à l'écran ; il ne dit rien
 * d'un hook importé « pour plus tard » qu'un lot suivant brancherait sans que
 * personne s'en aperçoive. Relire le fichier le dit.
 */
describe('the support desk imports nothing it has no business with', () => {
  // `import.meta.url` est une URL http sous jsdom : le chemin part donc de la
  // racine du paquet, où vitest s'exécute.
  const source = withoutComments(
    readFileSync(join(process.cwd(), 'src/pages/platform-support-page.tsx'), 'utf8'),
  )

  it.each([
    ['le pipeline commercial', /useSalesPipeline|useProspect|useProspects/],
    ['la modération', /useModerat|useResolveReviewReport/],
    ['les plans et la facturation', /billing\.manage|useAssignPlan|commercial\.plan_assign/],
    ['les affiches QR', /usePoster|useGeneratePosterBatch/],
    ['les notes clients privées', /customers\.notes|customerNotes/],
  ])('never touches %s', (_label, pattern) => {
    expect(source).not.toMatch(pattern)
  })

  it('only ever opens a ticket with an origin the server actually accepts', () => {
    // `report` et `inbound_email` sont refusées côté serveur (origin_not_wired).
    expect(source).toMatch(/origin: 'phone'/)
    expect(source).toMatch(/origin: 'gdpr_withdrawal'/)
    expect(source).not.toMatch(/origin: 'report'/)
    expect(source).not.toMatch(/origin: 'inbound_email'/)
  })
})
