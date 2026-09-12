import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '@/components/ui/toast'
import i18n from 'i18next'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformSalesPage } from '@/pages/platform-sales-page'
import { usePlatformPermissions } from '@/routes/require-platform-role'
import {
  useApplicationQueue,
  useProspectOutreachState,
  useProspectStats,
  useProspects,
  usePublishExternalProfessional,
  useReviewApplication,
  useSalesPipeline,
} from '@/lib/queries/platform-plat2'
import type { PlatformPermission } from '@/lib/types'

vi.mock('@/routes/require-platform-role', () => ({ usePlatformPermissions: vi.fn() }))
vi.mock('@/lib/queries/platform-plat2', () => ({
  useSalesPipeline: vi.fn(),
  useProspects: vi.fn(),
  useProspectStats: vi.fn(),
  useProspectOutreachState: vi.fn(),
  usePublishExternalProfessional: vi.fn(),
  useApplicationQueue: vi.fn(),
  useReviewApplication: vi.fn(),
}))

const mockPermissions = vi.mocked(usePlatformPermissions)
const mockPipeline = vi.mocked(useSalesPipeline)
const mockProspects = vi.mocked(useProspects)
const mockStats = vi.mocked(useProspectStats)
const mockOutreach = vi.mocked(useProspectOutreachState)
const mockPublish = vi.mocked(usePublishExternalProfessional)
const mockQueue = vi.mocked(useApplicationQueue)
const mockReview = vi.mocked(useReviewApplication)

/**
 * Les clés de ce lot ne sont pas encore dans `src/locales/` — un autre agent
 * du même lot les y fusionne. Le test enregistre donc les chaînes anglaises
 * qu'il affirme, en écrasant : il dit la vérité avant comme après la fusion,
 * au lieu d'affirmer sur des identifiants bruts.
 */
const EN = {
  noAccess: "This desk isn't visible with your role",
  pipeline: 'Acquisition funnel',
  prospects: 'Prospects',
  originField: 'Field',
  originWorker: 'Worker V2',
  perOrigin: '{{published}} published · {{contacted}} contacted',
  observedOn: 'Seen on {{date}}',
  doNotContact: 'Do not contact',
  showInsight: 'Show the numbers',
  notPublished: "This record isn't published: there is nothing to measure yet",
  viewsAllTime: 'Profile views, all time',
  followers: 'Followers',
  pendingRequests: 'Requests waiting for an answer',
  pendingCallout:
    'Interest requests waiting: {{count}}. A real customer is waiting for an answer — make this call first.',
  blocked: 'Next follow-up blocked — {{reason}}',
  blockSuppressedProspect: 'prospect suppressed',
  touchesSent: '{{sent}} of 3 follow-ups sent',
  loggedContacts: 'Contacts logged by hand',
  publish: 'Publish on the marketplace',
  publishBody:
    'Publishing emails the professional the GDPR article 14 notice, makes the record public and puts the legal responsibility on FadeUp. The action is logged.',
  publishConfirm: 'Publish',
  onboarding: 'Onboardings to review',
  reject: 'Reject',
  rejectConfirm: 'Reject',
}

beforeAll(() => {
  i18n.addResourceBundle('en', 'platform', { salesDesk: EN }, true, true)
})

function query(data: unknown, extra: Record<string, unknown> = {}) {
  return { data, isPending: false, isError: false, isSuccess: true, error: null, ...extra } as never
}

function grant(...permissions: PlatformPermission[]) {
  mockPermissions.mockReturnValue({
    permissions,
    can: (permission: PlatformPermission) => permissions.includes(permission),
  })
}

const FIELD_PROSPECT = {
  id: 'p-field',
  canonical_name: 'Salon Bellecour',
  type: 'barbershop',
  status: 'qualified',
  origin: 'field' as const,
  country: 'FR',
  phone_e164: '+33612345678',
  email: 'contact@bellecour.fr',
  do_not_contact: false,
  field_observation: 'Trois fauteuils, file dehors le samedi.',
  field_captured_at: '2026-09-02T10:00:00.000Z',
  current_score: 72,
  city: 'Lyon',
  postal_code: '69002',
  address_line: '4 rue de la Barre',
  latitude: null,
  longitude: null,
}

const WORKER_PROSPECT = {
  ...FIELD_PROSPECT,
  id: 'p-worker',
  canonical_name: 'Fade Factory',
  origin: 'worker' as const,
  field_observation: null,
  field_captured_at: null,
  do_not_contact: true,
}

const PUBLISHED_STATS = {
  prospect_id: 'p-field',
  window_days: 90,
  since: '2026-06-13T00:00:00.000Z',
  is_published: true,
  professional_id: 'pro-1',
  claim_state: 'unclaimed' as const,
  profile_views: 41,
  profile_views_all_time: 118,
  last_profile_view_at: '2026-09-09T08:00:00.000Z',
  booking_started: 7,
  interest_requests: 3,
  interest_requests_pending: 2,
  followers: 12,
  search_result_views: 260,
}

const UNPUBLISHED_STATS = {
  ...PUBLISHED_STATS,
  is_published: false,
  professional_id: null,
  claim_state: null,
  profile_views: 0,
  profile_views_all_time: 0,
  last_profile_view_at: null,
  booking_started: 0,
  interest_requests: 0,
  interest_requests_pending: 0,
  followers: 0,
  search_result_views: 0,
}

const EMPTY_OUTREACH = {
  prospect_id: 'p-field',
  do_not_contact: false,
  has_email: true,
  suppressed: false,
  block_reason: null,
  requests: [],
  logged_contacts: [],
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <PlatformSalesPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('PlatformSalesPage — /platform/sales', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    grant('crm.read')
    mockPipeline.mockReturnValue(query([]))
    mockProspects.mockReturnValue(query([]))
    mockStats.mockReturnValue(query(undefined))
    mockOutreach.mockReturnValue(query(undefined))
    mockPublish.mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
    mockQueue.mockReturnValue(query([]))
    mockReview.mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
  })

  it('refuses a role without crm.read with an honest sentence, and asks the CRM nothing', () => {
    // Le support porte `support_view.enter`, pas `crm.read` : il ne doit pas
    // voir la liste, et la requête ne doit même pas partir.
    grant('support_view.enter', 'appointment.cancel')

    renderPage()

    expect(screen.getByText(EN.noAccess)).toBeInTheDocument()
    expect(screen.queryByText('Prospects')).not.toBeInTheDocument()
    expect(mockProspects).not.toHaveBeenCalled()
    expect(mockPipeline).not.toHaveBeenCalled()
  })

  it('separates the two origins in the funnel without a click', () => {
    mockPipeline.mockReturnValue(
      query([
        { status: 'qualified', origin: 'field', prospect_count: 4, published_count: 1, contacted_count: 2 },
        { status: 'qualified', origin: 'worker', prospect_count: 31, published_count: 9, contacted_count: 5 },
      ]),
    )

    renderPage()

    const funnel = screen.getByRole('region', { name: EN.pipeline })
    expect(funnel).toHaveTextContent('Field')
    expect(funnel).toHaveTextContent('Worker V2')
    expect(funnel).toHaveTextContent('4')
    expect(funnel).toHaveTextContent('31')
    expect(funnel).toHaveTextContent('1 published · 2 contacted')
    expect(funnel).toHaveTextContent('9 published · 5 contacted')
  })

  it('flags each prospect with its origin, its field observation and do-not-contact', () => {
    mockProspects.mockReturnValue(query([FIELD_PROSPECT, WORKER_PROSPECT]))

    renderPage()

    const list = screen.getByRole('region', { name: EN.prospects })
    expect(list).toHaveTextContent('Trois fauteuils, file dehors le samedi.')
    expect(list).toHaveTextContent('Seen on')
    expect(list).toHaveTextContent('Do not contact')
    expect(list).toHaveTextContent('Field')
    expect(list).toHaveTextContent('Worker V2')
  })

  it('says an unpublished record has nothing to measure instead of showing a table of zeros', async () => {
    mockProspects.mockReturnValue(query([FIELD_PROSPECT]))
    mockStats.mockReturnValue(query(UNPUBLISHED_STATS))
    mockOutreach.mockReturnValue(query(EMPTY_OUTREACH))

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Salon Bellecour' }))

    expect(screen.getByText(EN.notPublished)).toBeInTheDocument()
    expect(screen.queryByText(EN.viewsAllTime)).not.toBeInTheDocument()
    expect(screen.queryByText(EN.followers)).not.toBeInTheDocument()
  })

  it('shows the real numbers and treats a pending interest request as the strongest argument', async () => {
    mockProspects.mockReturnValue(query([FIELD_PROSPECT]))
    mockStats.mockReturnValue(query(PUBLISHED_STATS))
    mockOutreach.mockReturnValue(query(EMPTY_OUTREACH))

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Salon Bellecour' }))

    expect(screen.getByText(EN.viewsAllTime)).toBeInTheDocument()
    expect(screen.getByText('118')).toBeInTheDocument()
    expect(screen.getByText(EN.pendingRequests)).toBeInTheDocument()
    expect(
      screen.getByText(/Interest requests waiting: 2\. A real customer is waiting for an answer/),
    ).toBeInTheDocument()
  })

  it('names why the next automatic follow-up is blocked, and offers no manual re-send', async () => {
    mockProspects.mockReturnValue(query([FIELD_PROSPECT]))
    mockStats.mockReturnValue(query(PUBLISHED_STATS))
    mockOutreach.mockReturnValue(
      query({
        ...EMPTY_OUTREACH,
        suppressed: true,
        block_reason: 'suppressed_prospect',
        requests: [
          {
            request_id: 'r-1',
            status: 'pending',
            service_label: 'Fade + barbe',
            preferred_starts_at: '2026-09-14T09:00:00.000Z',
            expires_at: '2026-09-13T09:00:00.000Z',
            touches_sent: 2,
            touches: [
              {
                touch: '1',
                template: 'interest_touch_1',
                status: 'sent',
                created_at: '2026-09-10T09:00:00.000Z',
                sent_at: '2026-09-10T09:01:00.000Z',
                delivered_at: '2026-09-10T09:02:00.000Z',
                opened_at: null,
                bounced_at: null,
              },
            ],
          },
        ],
        logged_contacts: [
          {
            id: 'c-1',
            channel: 'phone',
            direction: 'outbound',
            summary: 'Rappelé, patron absent.',
            occurred_at: '2026-09-08T15:00:00.000Z',
          },
        ],
      }),
    )

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Salon Bellecour' }))

    expect(screen.getByText('Next follow-up blocked — prospect suppressed')).toBeInTheDocument()
    expect(screen.getByText('2 of 3 follow-ups sent')).toBeInTheDocument()
    // Les échanges saisis à la main restent à part des relances automatiques.
    expect(screen.getByText(EN.loggedContacts)).toBeInTheDocument()
    expect(screen.getByText('Rappelé, patron absent.')).toBeInTheDocument()
    // B2 tient la cadence : aucun bouton d'envoi, sous aucun libellé.
    for (const button of screen.getAllByRole('button')) {
      expect(button.textContent ?? '').not.toMatch(/follow.?up|relanc|send|resend/i)
    }
  })

  it('never offers publication to a role without marketplace.publish', async () => {
    mockProspects.mockReturnValue(query([FIELD_PROSPECT]))
    mockStats.mockReturnValue(query(UNPUBLISHED_STATS))
    mockOutreach.mockReturnValue(query(EMPTY_OUTREACH))

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Salon Bellecour' }))

    expect(screen.queryByRole('button', { name: EN.publish })).not.toBeInTheDocument()
  })

  it('warns about the GDPR article 14 notice before publishing, and never publishes on a bare click', async () => {
    const mutate = vi.fn()
    mockPublish.mockReturnValue({ mutate, isPending: false } as never)
    grant('crm.read', 'marketplace.publish')
    mockProspects.mockReturnValue(query([FIELD_PROSPECT]))
    mockStats.mockReturnValue(query(UNPUBLISHED_STATS))
    mockOutreach.mockReturnValue(query(EMPTY_OUTREACH))

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Salon Bellecour' }))
    await userEvent.click(screen.getByRole('button', { name: EN.publish }))

    expect(mutate).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/GDPR article 14 notice/)).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: EN.publishConfirm }))
    expect(mutate).toHaveBeenCalledWith('p-field', expect.anything())
  })

  it('hides the onboarding queue from a role without onboarding.review', () => {
    renderPage()

    expect(screen.queryByText(EN.onboarding)).not.toBeInTheDocument()
    expect(mockQueue).not.toHaveBeenCalled()
  })

  it('requires a reason before rejecting an onboarding, and never shows the internal note', async () => {
    const mutate = vi.fn()
    mockReview.mockReturnValue({ mutate, isPending: false } as never)
    grant('crm.read', 'onboarding.review')
    mockQueue.mockReturnValue(
      query([
        {
          id: 'app-1',
          status: 'pending_review',
          first_name: 'Karim',
          last_name: 'Benali',
          email: 'karim@fadecity.fr',
          phone: null,
          business_name: 'Fade City',
          professional_type: 'barbershop',
          city: 'Lyon',
          postal_code: null,
          country: 'FR',
          staff_count: 3,
          website: null,
          instagram: null,
          business_identifier: null,
          submitted_at: '2026-09-10T09:00:00.000Z',
          reviewed_at: null,
          reviewed_by_email: null,
          rejection_reason: null,
          internal_note: 'note interne a ne pas afficher',
          organization_id: null,
        },
      ]),
    )

    renderPage()

    expect(mockQueue).toHaveBeenCalledWith('pending_review')
    expect(screen.getByText('Fade City')).toBeInTheDocument()
    expect(screen.queryByText('note interne a ne pas afficher')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: EN.reject }))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: EN.rejectConfirm }))

    // Sans motif, rien ne part.
    expect(mutate).not.toHaveBeenCalled()
  })

  it('reads nothing from the private customer-note model, nor from moderation, support or billing', () => {
    // OS-2 pose `customers` / `customer_notes` en parallèle, avec un droit
    // `customer_notes.read` que le commercial n'a PAS. La base le refuse déjà
    // (F8) ; ceci verrouille le côté écran, où une simple importation
    // suffirait à faire apparaître ce qu'aucun commercial ne doit lire.
    const source = readFileSync(resolve(process.cwd(), 'src/pages/platform-sales-page.tsx'), 'utf8')

    expect(source).not.toMatch(/customer_notes|customerNotes|CustomerNote/)
    expect(source).not.toMatch(/useCustomers|usePlatformDossier|queries\/customers/)
    expect(source).not.toMatch(/useModeration|useSupportTicket|useMarketplaceWithdrawals|useBilling/)
    expect(source).not.toMatch(/\binternal_note\b/)
  })
})
