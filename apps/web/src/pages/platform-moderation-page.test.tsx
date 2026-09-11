import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformModerationPage } from '@/pages/platform-moderation-page'
import { usePlatformPermissions } from '@/routes/require-platform-role'
import { useSupportView } from '@/routes/platform-support-view-context'
import {
  useApplicationQueue,
  useClaimQueue,
  useModeratePost,
  useModerateReview,
  useModerationPosts,
  useModerationReports,
  useModerationReviews,
  useResolveReviewReport,
  useReviewApplication,
  useReviewClaim,
} from '@/lib/queries/platform-plat2'
import { useToast } from '@/components/ui/toast'

vi.mock('@/routes/require-platform-role', () => ({ usePlatformPermissions: vi.fn() }))
vi.mock('@/routes/platform-support-view-context', () => ({ useSupportView: vi.fn() }))
vi.mock('@/components/ui/toast', () => ({ useToast: vi.fn() }))
vi.mock('@/lib/queries/platform-plat2', () => ({
  MODERATION_REASONS: ['fraud', 'abusive_content', 'personal_data', 'hate_speech', 'conflict_of_interest'],
  useModerationReviews: vi.fn(),
  useModerationPosts: vi.fn(),
  useModerationReports: vi.fn(),
  useModerateReview: vi.fn(),
  useModeratePost: vi.fn(),
  useResolveReviewReport: vi.fn(),
  useApplicationQueue: vi.fn(),
  useReviewApplication: vi.fn(),
  useClaimQueue: vi.fn(),
  useReviewClaim: vi.fn(),
}))

/*
 * Les libellés sont lus PAR i18next, pas recopiés. Les clés de ce lot vivent
 * encore dans un fichier de transfert (`scratchpad/plat2-i18n`) et seront
 * fusionnées dans `src/locales/` par le lot parent : un test qui codait en dur
 * « Moderate » passerait aujourd'hui et casserait le jour de la fusion, sans
 * qu'aucun comportement n'ait changé.
 */
const T = (key: string) => i18n.t(key)

const SALES = ['crm.read', 'crm.write', 'marketplace.publish', 'onboarding.review']
const MODERATOR = ['moderation.content', 'onboarding.review', 'support_view.enter']
const ADMIN = [...MODERATOR, 'moderation.revert']
const SUPPORT = ['appointment.cancel', 'tenant.read']

function resolved(data: unknown) {
  return { data, isPending: false, isError: false, error: null, refetch: vi.fn() } as never
}

function idleMutation(mutate: ReturnType<typeof vi.fn> = vi.fn()) {
  return { mutate, mutateAsync: vi.fn(), isPending: false, variables: undefined } as never
}

function withRole(permissions: string[]) {
  vi.mocked(usePlatformPermissions).mockReturnValue({
    permissions: permissions as never,
    can: (permission) => permissions.includes(permission),
  })
}

const REMOVED_REVIEW = {
  id: 'rev-1',
  rating: 1,
  comment: 'Coupe ratée',
  reviewer_display_name: 'Sonia',
  status: 'removed' as const,
  moderation_reason: 'abusive_content',
  moderated_at: '2026-09-10T10:00:00.000Z',
  moderated_by_email: 'mod@fadeup.com',
  professional_id: 'pro-1',
  professional_display_name: 'Karim',
  professional_handle: 'karim',
  organization_id: 'org-1',
  organization_name: 'Fade City',
  open_report_count: 3,
  created_at: '2026-09-01T10:00:00.000Z',
}

const PUBLISHED_REVIEW = { ...REMOVED_REVIEW, id: 'rev-2', status: 'published' as const, moderation_reason: null, moderated_at: null, moderated_by_email: null }

function claim(id: string, email: string, competing: number) {
  return {
    id,
    professional_id: 'pro-1',
    professional_display_name: 'Karim',
    professional_handle: 'karim',
    professional_claim_state: 'unclaimed' as const,
    claimant_user_id: `u-${id}`,
    claimant_email: email,
    state: 'pending' as const,
    evidence: `Preuve ${id}`,
    submitted_at: '2026-09-01T10:00:00.000Z',
    decided_at: null,
    decided_by_email: null,
    decision_note: null,
    competing_pending: competing,
  }
}

describe('PlatformModerationPage — /platform/moderation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useToast).mockReturnValue({ toast: vi.fn() } as never)
    vi.mocked(useSupportView).mockReturnValue({
      activeSession: null,
      isLoading: false,
      enterSupportView: vi.fn(),
      exitSupportView: vi.fn(),
      isEntering: false,
      isExiting: false,
    })
    vi.mocked(useModerationReviews).mockReturnValue(resolved([]))
    vi.mocked(useModerationPosts).mockReturnValue(resolved([]))
    vi.mocked(useModerationReports).mockReturnValue(resolved([]))
    vi.mocked(useApplicationQueue).mockReturnValue(resolved([]))
    vi.mocked(useClaimQueue).mockReturnValue(resolved([]))
    vi.mocked(useModerateReview).mockReturnValue(idleMutation())
    vi.mocked(useModeratePost).mockReturnValue(idleMutation())
    vi.mocked(useResolveReviewReport).mockReturnValue(idleMutation())
    vi.mocked(useReviewApplication).mockReturnValue(idleMutation())
    vi.mocked(useReviewClaim).mockReturnValue(idleMutation())
    withRole(MODERATOR)
  })

  it('ne rend au commercial que les deux files partagées — ni avis, ni posts, ni signalements', () => {
    withRole(SALES)

    render(<PlatformModerationPage />)

    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent)
    expect(tabs).toEqual([T('platform:moderationDesk.tabApplications'), T('platform:moderationDesk.tabClaims')])
    expect(screen.queryByRole('tab', { name: T('platform:moderationDesk.tabReviews') })).toBeNull()
    expect(screen.queryByRole('tab', { name: T('platform:moderationDesk.tabPosts') })).toBeNull()
    expect(screen.queryByRole('tab', { name: T('platform:moderationDesk.tabReports') })).toBeNull()

    // Non rendu veut dire non demandé : une file de contenu ne doit même pas
    // être interrogée pour un rôle qui n'a pas moderation.content.
    expect(useModerationReviews).not.toHaveBeenCalled()
    expect(useModerationPosts).not.toHaveBeenCalled()
    expect(useModerationReports).not.toHaveBeenCalled()
    expect(useApplicationQueue).toHaveBeenCalled()
  })

  it('ne touche à AUCUN hook de CRM — pas de prospect, pas de pipeline, pas de campagne', () => {
    // La garde est statique parce que le défaut le serait : un import de CRM
    // ajouté ici passerait tous les tests de rendu ci-dessus.
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'platform-moderation-page.tsx'),
      'utf8',
    )
    for (const forbidden of [
      'useSalesPipeline',
      'useProspects',
      'useProspectStats',
      'useProspectOutreachState',
      'useCaptureFieldProspect',
      'usePublishExternalProfessional',
    ]) {
      expect(source).not.toContain(forbidden)
    }
  })

  it('rend les cinq onglets au modérateur', () => {
    render(<PlatformModerationPage />)

    expect(screen.getAllByRole('tab')).toHaveLength(5)
    expect(screen.getByRole('tab', { name: T('platform:moderationDesk.tabReviews') })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('dit honnêtement à un rôle sans aucun des deux droits que ce n’est pas pour lui', () => {
    withRole(SUPPORT)

    render(<PlatformModerationPage />)

    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(screen.getByText(T('platform:moderationDesk.notForYourRole'))).toBeInTheDocument()
    expect(useModerationReviews).not.toHaveBeenCalled()
    expect(useApplicationQueue).not.toHaveBeenCalled()
  })

  /*
   * Deux rendus, deux tests. Un seul test qui démonte puis remonte laissait
   * cohabiter deux portails Radix le temps d'un battement, et `getByRole`
   * trouvait alors deux boutons « Modérer » — un échec qui n'apparaissait
   * qu'en campagne chargée, c'est-à-dire là où on ne le cherche pas.
   */
  async function openDecisionOptions() {
    const user = userEvent.setup()
    vi.mocked(useModerationReviews).mockReturnValue(resolved([REMOVED_REVIEW]))

    render(<PlatformModerationPage />)
    await user.click(screen.getByRole('button', { name: T('platform:moderationDesk.moderate') }))

    const select = screen.getByLabelText(T('platform:moderationDesk.decisionLabel')) as HTMLSelectElement
    return [...select.options].map((option) => option.value)
  }

  it('n’offre PAS la remise en ligne au modérateur : le modérateur masque, il ne défait pas', async () => {
    expect(await openDecisionOptions()).toEqual(['under_review'])
  })

  it('offre la remise en ligne à l’admin, qui porte moderation.revert', async () => {
    withRole(ADMIN)

    expect(await openDecisionOptions()).toEqual(['under_review', 'published'])
  })

  it('refuse de masquer sans motif, puis appelle le serveur avec le motif choisi', async () => {
    const user = userEvent.setup()
    const mutate = vi.fn()
    vi.mocked(useModerationReviews).mockReturnValue(resolved([PUBLISHED_REVIEW]))
    vi.mocked(useModerateReview).mockReturnValue(idleMutation(mutate))

    render(<PlatformModerationPage />)
    await user.click(screen.getByRole('button', { name: T('platform:moderationDesk.moderate') }))
    await user.click(screen.getByRole('button', { name: T('platform:moderationDesk.confirm') }))

    expect(mutate).not.toHaveBeenCalled()
    expect(screen.getByText(T('platform:moderationDesk.reasonRequired'))).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText(T('common:field.reason')), 'personal_data')
    await user.click(screen.getByRole('button', { name: T('platform:moderationDesk.confirm') }))

    expect(mutate).toHaveBeenCalledWith(
      { reviewId: 'rev-2', status: 'removed', reason: 'personal_data' },
      expect.anything(),
    )
  })

  it('distingue un post masqué par la modération d’un post masqué par son auteur', async () => {
    const user = userEvent.setup()
    vi.mocked(useModerationPosts).mockReturnValue(
      resolved([
        {
          id: 'post-1',
          author_kind: 'professional',
          author_label: 'Karim',
          author_handle: 'karim',
          caption: 'Avant / après',
          visibility: 'hidden',
          hidden_at: '2026-09-10T10:00:00.000Z',
          hidden_by_email: 'mod@fadeup.com',
          hidden_reason: 'personal_data',
          media_count: 2,
          like_count: 8,
          created_at: '2026-09-01T10:00:00.000Z',
        },
        {
          id: 'post-2',
          author_kind: 'organization',
          author_label: 'Fade City',
          author_handle: null,
          caption: null,
          visibility: 'hidden',
          hidden_at: null,
          hidden_by_email: null,
          hidden_reason: null,
          media_count: 0,
          like_count: 0,
          created_at: '2026-09-02T10:00:00.000Z',
        },
      ]),
    )

    render(<PlatformModerationPage />)
    // Radix ne monte que le panneau actif : il faut vraiment aller sur l'onglet.
    await user.click(screen.getByRole('tab', { name: T('platform:moderationDesk.tabPosts') }))

    expect(screen.getByText('mod@fadeup.com')).toBeInTheDocument()
    expect(screen.getByText(T('platform:moderationDesk.reason_personal_data'))).toBeInTheDocument()
    expect(screen.getByText(T('platform:moderationDesk.hiddenByAuthor'))).toBeInTheDocument()
  })

  it('crie quand deux demandes vivantes visent le même profil, et les montre ensemble', async () => {
    const user = userEvent.setup()
    withRole(SALES)
    vi.mocked(useClaimQueue).mockReturnValue(
      resolved([claim('claim-1', 'un@exemple.fr', 1), claim('claim-2', 'deux@exemple.fr', 1)]),
    )

    render(<PlatformModerationPage />)
    await user.click(screen.getByRole('tab', { name: T('platform:moderationDesk.tabClaims') }))

    expect(screen.getByText(T('platform:moderationDesk.contestedBadge'))).toBeInTheDocument()
    expect(
      screen.getByText(i18n.t('platform:moderationDesk.contestedWarning', { total: 2 })),
    ).toBeInTheDocument()

    // Les deux rivales sont dans le MÊME groupe : arbitrer, c'est comparer.
    const group = screen.getByText('un@exemple.fr').closest('table')
    expect(group).not.toBeNull()
    expect(within(group!).getByText('deux@exemple.fr')).toBeInTheDocument()
    expect(within(group!).getByText('Preuve claim-1')).toBeInTheDocument()
    expect(within(group!).getByText('Preuve claim-2')).toBeInTheDocument()
  })

  it('prévient que l’approbation ferme les rivales AVANT le clic', async () => {
    const user = userEvent.setup()
    withRole(SALES)
    vi.mocked(useClaimQueue).mockReturnValue(
      resolved([claim('claim-1', 'un@exemple.fr', 1), claim('claim-2', 'deux@exemple.fr', 1)]),
    )

    render(<PlatformModerationPage />)
    await user.click(screen.getByRole('tab', { name: T('platform:moderationDesk.tabClaims') }))
    await user.click(screen.getAllByRole('button', { name: T('platform:moderationDesk.approve') })[0]!)

    expect(
      screen.getByText(i18n.t('platform:moderationDesk.approveClosesRivals', { total: 1 })),
    ).toBeInTheDocument()
  })

  it('exige le motif de refus d’une candidature, que le serveur, lui, accepte vide', async () => {
    const user = userEvent.setup()
    const mutate = vi.fn()
    withRole(SALES)
    vi.mocked(useReviewApplication).mockReturnValue(idleMutation(mutate))
    vi.mocked(useApplicationQueue).mockReturnValue(
      resolved([
        {
          id: 'app-1',
          status: 'pending_review',
          first_name: 'Karim',
          last_name: 'Benali',
          email: 'karim@fadecity.fr',
          phone: '+33612345678',
          business_name: 'Fade City',
          professional_type: 'barbershop',
          city: 'Lyon',
          postal_code: null,
          country: 'FR',
          staff_count: 3,
          website: null,
          instagram: null,
          business_identifier: null,
          submitted_at: '2026-09-01T10:00:00.000Z',
          reviewed_at: null,
          reviewed_by_email: null,
          rejection_reason: null,
          internal_note: null,
          organization_id: null,
        },
      ]),
    )

    render(<PlatformModerationPage />)
    await user.click(screen.getByRole('button', { name: T('platform:moderationDesk.reject') }))
    await user.click(screen.getAllByRole('button', { name: T('platform:moderationDesk.reject') }).at(-1)!)

    expect(mutate).not.toHaveBeenCalled()
    expect(screen.getByText(T('platform:moderationDesk.rejectionReasonRequired'))).toBeInTheDocument()
  })

  it('dit qu’un chargement a échoué plutôt que de laisser croire à une file vide', () => {
    vi.mocked(useModerationReviews).mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error('permission denied for function list_moderation_reviews'),
    } as never)

    render(<PlatformModerationPage />)

    expect(screen.getByText(T('platform:moderationDesk.reviewsLoadFailed'))).toBeInTheDocument()
    expect(screen.queryByText(T('platform:moderationDesk.reviewsEmpty'))).toBeNull()
  })
})
