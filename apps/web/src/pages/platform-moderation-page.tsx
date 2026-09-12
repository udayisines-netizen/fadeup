import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePlatformPermissions } from '@/routes/require-platform-role'
import { useSupportView } from '@/routes/platform-support-view-context'
import {
  MODERATION_REASONS,
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
  type ApplicationQueueRow,
  type ClaimQueueRow,
  type ModerationPostRow,
  type ModerationReportRow,
  type ModerationReason,
  type ModerationReviewRow,
} from '@/lib/queries/platform-plat2'
import { Alert } from '@/components/ui/alert'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { SelectField } from '@/components/ui/select-field'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableStateRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { getErrorMessage } from '@/lib/get-error-message'
import type { PlatformPermission } from '@/lib/types'

/**
 * /platform/moderation — les cinq files de modération, une par onglet.
 *
 * DEUX PUBLICS, PAS UN. Les trois premiers onglets (avis, posts,
 * signalements) appartiennent au modérateur ; les deux derniers
 * (onboardings, revendications) sont PARTAGÉS avec le commercial — décision
 * du fondateur, portée par `onboarding.review` que quatre rôles détiennent.
 * Un commercial qui arrive ici voit deux onglets, pas cinq, et ce qu'il ne
 * peut pas faire n'est pas rendu du tout : ni onglet vide, ni bouton grisé.
 *
 * CECI CONDITIONNE, CELA N'AUTORISE PAS. Chaque RPC repose la question côté
 * serveur : `list_moderation_*` rend zéro ligne sans `moderation.content`,
 * `moderate_review` refuse un masquage sans motif (`reason_required`) ou hors
 * vocabulaire (`reason_not_allowed`), et refuse une remise en ligne à qui n'a
 * pas `moderation.revert` (`revert_requires_admin`). L'interface dit la même
 * chose, plus tôt et plus lisiblement ; elle ne la décide pas.
 */

/*
 * `moderation.revert` est en base depuis la migration
 * 20260911200100_plat2_moderation (fondateur et admin seulement) mais pas
 * encore dans l'union `PlatformPermission` de `src/lib/types.ts`, qui n'est
 * pas un fichier de ce lot et qu'un autre agent édite en parallèle. Le
 * transtypage est donc LOCAL et documenté plutôt que partagé : la valeur est
 * exacte, seule la liste est en retard. À replier dans l'union quand PLAT-2
 * consolidera ses droits.
 */
const MODERATION_REVERT = 'moderation.revert' as PlatformPermission

/** Le vocabulaire des signalements : celui de la modération, plus `other`. */
const KNOWN_REASONS = new Set<string>([...MODERATION_REASONS, 'other'])

type ReviewFilter = 'all' | 'published' | 'under_review' | 'removed'
type PostFilter = 'all' | 'public' | 'followers' | 'hidden'
type ApplicationFilter = 'all' | 'pending_review' | 'approved' | 'rejected'

const REVIEW_STATUS_VARIANT: Record<string, BadgeVariant> = {
  published: 'success',
  under_review: 'warning',
  removed: 'danger',
}
const VISIBILITY_VARIANT: Record<string, BadgeVariant> = {
  public: 'success',
  followers: 'info',
  hidden: 'danger',
}
const REPORT_STATUS_VARIANT: Record<string, BadgeVariant> = {
  open: 'warning',
  reviewed: 'info',
  dismissed: 'neutral',
  actioned: 'danger',
}
const APPLICATION_STATUS_VARIANT: Record<string, BadgeVariant> = {
  pending_review: 'warning',
  approved: 'success',
  rejected: 'danger',
}
const CLAIM_STATE_VARIANT: Record<string, BadgeVariant> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  withdrawn: 'neutral',
}

export function PlatformModerationPage() {
  const { t } = useTranslation()
  const { can } = usePlatformPermissions()

  const canContent = can('moderation.content')
  const canOnboarding = can('onboarding.review')
  const canRevert = can(MODERATION_REVERT)
  const canSupportView = can('support_view.enter')

  const tabs = [
    ...(canContent ? ['reviews', 'posts', 'reports'] : []),
    ...(canOnboarding ? ['applications', 'claims'] : []),
  ]

  if (tabs.length === 0) {
    return (
      <Container size="lg" className="py-8">
        <h1 className="text-xl font-semibold text-ink-950">{t('platform:moderationDesk.title')}</h1>
        <EmptyState
          className="mt-6"
          title={t('platform:moderationDesk.notForYourRole')}
          description={t('platform:moderationDesk.notForYourRoleHint')}
        />
      </Container>
    )
  }

  return (
    <Container size="lg" className="py-8">
      <h1 className="text-xl font-semibold text-ink-950">{t('platform:moderationDesk.title')}</h1>
      <p className="mt-1 text-sm text-ink-500">{t('platform:moderationDesk.subtitle')}</p>

      <Tabs defaultValue={tabs[0]} className="mt-6">
        {/* Cinq onglets ne tiennent pas sur une ligne à 390 px : ils passent
            à la ligne au lieu de déborder. */}
        <TabsList className="flex w-full flex-wrap">
          {canContent ? (
            <>
              <TabsTrigger value="reviews">{t('platform:moderationDesk.tabReviews')}</TabsTrigger>
              <TabsTrigger value="posts">{t('platform:moderationDesk.tabPosts')}</TabsTrigger>
              <TabsTrigger value="reports">{t('platform:moderationDesk.tabReports')}</TabsTrigger>
            </>
          ) : null}
          {canOnboarding ? (
            <>
              <TabsTrigger value="applications">{t('platform:moderationDesk.tabApplications')}</TabsTrigger>
              <TabsTrigger value="claims">{t('platform:moderationDesk.tabClaims')}</TabsTrigger>
            </>
          ) : null}
        </TabsList>

        {canContent ? (
          <>
            <TabsContent value="reviews">
              <ReviewsTab canRevert={canRevert} canSupportView={canSupportView} />
            </TabsContent>
            <TabsContent value="posts">
              <PostsTab canRevert={canRevert} />
            </TabsContent>
            <TabsContent value="reports">
              <ReportsTab />
            </TabsContent>
          </>
        ) : null}

        {canOnboarding ? (
          <>
            <TabsContent value="applications">
              <ApplicationsTab />
            </TabsContent>
            <TabsContent value="claims">
              <ClaimsTab />
            </TabsContent>
          </>
        ) : null}
      </Tabs>
    </Container>
  )
}

// ============================================================================
// Onglet 1 — les avis
// ============================================================================

function ReviewsTab({ canRevert, canSupportView }: { canRevert: boolean; canSupportView: boolean }) {
  const { t } = useTranslation()
  const stamp = useStamp()
  const label = useVocabulary()
  const notify = useRefusalToast()

  const [filter, setFilter] = useState<ReviewFilter>('all')
  const query = useModerationReviews(filter === 'all' ? undefined : filter)
  const moderate = useModerateReview()
  const [target, setTarget] = useState<ModerationReviewRow | null>(null)
  const [supportTarget, setSupportTarget] = useState<ModerationReviewRow | null>(null)

  const options = decisionOptions(t, canRevert, [
    { value: 'removed', labelKey: 'decisionHide', requiresReason: true, isRevert: false },
    { value: 'under_review', labelKey: 'decisionUnderReview', requiresReason: true, isRevert: false },
    { value: 'published', labelKey: 'decisionRepublish', requiresReason: false, isRevert: true },
  ])

  return (
    <section>
      <Alert variant="info" className="mb-4">
        {t('platform:moderationDesk.ruleReason')}
      </Alert>

      <SegmentedControl<ReviewFilter>
        className="mb-4 sm:max-w-lg"
        ariaLabel={t('platform:moderationDesk.filterStatus')}
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: t('platform:moderationDesk.filterAll') },
          { value: 'published', label: t('platform:moderationDesk.reviewStatus_published') },
          { value: 'under_review', label: t('platform:moderationDesk.reviewStatus_under_review') },
          { value: 'removed', label: t('platform:moderationDesk.reviewStatus_removed') },
        ]}
      />

      {query.isPending ? (
        <QueueSkeleton />
      ) : query.isError ? (
        <ErrorState
          title={t('platform:moderationDesk.reviewsLoadFailed')}
          description={getErrorMessage(query.error)}
        />
      ) : (
        <Table label={t('platform:moderationDesk.tabReviews')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('platform:moderationDesk.colOpenReports')}</TableHead>
              <TableHead>{t('platform:moderationDesk.colReview')}</TableHead>
              <TableHead>{t('platform:moderationDesk.colAuthor')}</TableHead>
              <TableHead>{t('platform:moderationDesk.colTarget')}</TableHead>
              <TableHead>{t('common:field.status')}</TableHead>
              <TableHead>{t('platform:moderationDesk.colModeratedBy')}</TableHead>
              <TableHead>
                <span className="sr-only">{t('common:action.actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(query.data ?? []).length === 0 ? (
              <TableStateRow colSpan={7}>
                <EmptyState
                  className="border-none"
                  title={
                    filter === 'all'
                      ? t('platform:moderationDesk.reviewsEmpty')
                      : t('platform:moderationDesk.reviewsEmptyFiltered')
                  }
                />
              </TableStateRow>
            ) : (
              (query.data ?? []).map((row) => (
                <TableRow key={row.id}>
                  {/* La file arrive DÉJÀ triée par signalements décroissants
                      (list_moderation_reviews) : on ne la retrie pas. */}
                  <TableCell>
                    {row.open_report_count > 0 ? (
                      <Badge variant="danger">{String(row.open_report_count)}</Badge>
                    ) : (
                      <span className="text-ink-500">—</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[20rem]">
                    <span className="block font-medium text-ink-950">{`${row.rating}/5`}</span>
                    <span className="block truncate text-xs text-ink-500" title={row.comment ?? undefined}>
                      {row.comment ?? t('platform:moderationDesk.noComment')}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[12rem] truncate text-ink-700">{row.reviewer_display_name}</TableCell>
                  <TableCell className="max-w-[14rem]">
                    <span className="block truncate text-ink-950">{row.professional_display_name}</span>
                    <span className="block truncate text-xs text-ink-500">{row.organization_name}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={REVIEW_STATUS_VARIANT[row.status] ?? 'neutral'}>
                      {t(`platform:moderationDesk.reviewStatus_${row.status}`)}
                    </Badge>
                    {row.moderation_reason ? (
                      <span className="mt-1 block text-xs text-ink-500">{label.reason(row.moderation_reason)}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="max-w-[14rem] text-xs text-ink-500">
                    {row.moderated_at ? (
                      <>
                        <span className="block truncate">
                          {row.moderated_by_email ?? t('platform:moderationDesk.unknownActor')}
                        </span>
                        <span className="block whitespace-nowrap">{stamp.dateTime(row.moderated_at)}</span>
                      </>
                    ) : (
                      <span>—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-end">
                    <div className="flex flex-wrap justify-end gap-2">
                      {options.filter((option) => option.value !== row.status).length > 0 ? (
                        <Button variant="secondary" size="sm" onClick={() => setTarget(row)}>
                          {t('platform:moderationDesk.moderate')}
                        </Button>
                      ) : null}
                      {canSupportView ? (
                        <Button variant="ghost" size="sm" onClick={() => setSupportTarget(row)}>
                          {t('platform:moderationDesk.supportViewEnter')}
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}

      {target ? (
        <DecisionDialog
          title={t('platform:moderationDesk.moderateReviewTitle')}
          description={t('platform:moderationDesk.moderateReviewDescription', {
            target: target.professional_display_name,
          })}
          options={options.filter((option) => option.value !== target.status)}
          isPending={moderate.isPending}
          onClose={() => setTarget(null)}
          onConfirm={(decision, reason) =>
            moderate.mutate(
              { reviewId: target.id, status: decision as ModerationReviewRow['status'], reason },
              {
                onSuccess: () => {
                  notify.ok(t('platform:moderationDesk.reviewModerated'))
                  setTarget(null)
                },
                onError: (error) => notify.fail(t('platform:moderationDesk.moderationRefused'), error),
              },
            )
          }
        />
      ) : null}

      {supportTarget ? (
        <SupportViewDialog
          organizationId={supportTarget.organization_id}
          organizationName={supportTarget.organization_name}
          onClose={() => setSupportTarget(null)}
        />
      ) : null}
    </section>
  )
}

// ============================================================================
// Onglet 2 — les posts
// ============================================================================

function PostsTab({ canRevert }: { canRevert: boolean }) {
  const { t } = useTranslation()
  const stamp = useStamp()
  const label = useVocabulary()
  const notify = useRefusalToast()

  const [filter, setFilter] = useState<PostFilter>('all')
  const query = useModerationPosts(filter === 'all' ? undefined : filter)
  const moderate = useModeratePost()
  const [target, setTarget] = useState<ModerationPostRow | null>(null)

  const options = decisionOptions(t, canRevert, [
    { value: 'hidden', labelKey: 'decisionHide', requiresReason: true, isRevert: false },
    { value: 'public', labelKey: 'decisionPublic', requiresReason: false, isRevert: true },
    { value: 'followers', labelKey: 'decisionFollowers', requiresReason: false, isRevert: true },
  ])

  return (
    <section>
      <Alert variant="info" className="mb-4">
        {t('platform:moderationDesk.ruleReason')}
      </Alert>

      <SegmentedControl<PostFilter>
        className="mb-4 sm:max-w-lg"
        ariaLabel={t('platform:moderationDesk.filterVisibility')}
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: t('platform:moderationDesk.filterAll') },
          { value: 'public', label: t('platform:moderationDesk.visibility_public') },
          { value: 'followers', label: t('platform:moderationDesk.visibility_followers') },
          { value: 'hidden', label: t('platform:moderationDesk.visibility_hidden') },
        ]}
      />

      {query.isPending ? (
        <QueueSkeleton />
      ) : query.isError ? (
        <ErrorState
          title={t('platform:moderationDesk.postsLoadFailed')}
          description={getErrorMessage(query.error)}
        />
      ) : (
        <Table label={t('platform:moderationDesk.tabPosts')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('platform:moderationDesk.colAuthor')}</TableHead>
              <TableHead>{t('platform:moderationDesk.colCaption')}</TableHead>
              <TableHead>{t('platform:moderationDesk.colMedia')}</TableHead>
              <TableHead>{t('platform:moderationDesk.colVisibility')}</TableHead>
              <TableHead>{t('platform:moderationDesk.colHiddenBy')}</TableHead>
              <TableHead>
                <span className="sr-only">{t('common:action.actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(query.data ?? []).length === 0 ? (
              <TableStateRow colSpan={6}>
                <EmptyState
                  className="border-none"
                  title={
                    filter === 'all'
                      ? t('platform:moderationDesk.postsEmpty')
                      : t('platform:moderationDesk.postsEmptyFiltered')
                  }
                />
              </TableStateRow>
            ) : (
              (query.data ?? []).map((row) => {
                const available = options.filter((option) => option.value !== row.visibility)
                return (
                  <TableRow key={row.id}>
                    <TableCell className="max-w-[14rem]">
                      <span className="block truncate text-ink-950">
                        {row.author_label ?? t('platform:moderationDesk.unknownAuthor')}
                      </span>
                      <span className="block truncate text-xs text-ink-500">
                        {row.author_handle ? `@${row.author_handle}` : t(`platform:moderationDesk.author_${row.author_kind}`)}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[20rem]">
                      <span className="block truncate text-ink-700" title={row.caption ?? undefined}>
                        {row.caption ?? t('platform:moderationDesk.noCaption')}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-ink-500">
                      {`${row.media_count} · ♥ ${row.like_count}`}
                    </TableCell>
                    <TableCell>
                      <Badge variant={VISIBILITY_VARIANT[row.visibility] ?? 'neutral'}>
                        {t(`platform:moderationDesk.visibility_${row.visibility}`)}
                      </Badge>
                    </TableCell>
                    {/*
                      QUI, QUAND, POURQUOI — les trois colonnes que ce lot a
                      créées. Sans elles, un post masqué par la modération
                      était indiscernable d'un post que son auteur avait
                      lui-même rendu privé : c'est exactement ce que dit la
                      branche ci-dessous, et le tampon absent est une
                      information, pas un trou.
                    */}
                    <TableCell className="max-w-[16rem] text-xs text-ink-500">
                      {row.hidden_at ? (
                        <>
                          <span className="block truncate">
                            {row.hidden_by_email ?? t('platform:moderationDesk.unknownActor')}
                          </span>
                          <span className="block whitespace-nowrap">{stamp.dateTime(row.hidden_at)}</span>
                          <span className="block truncate">{label.reason(row.hidden_reason)}</span>
                        </>
                      ) : row.visibility === 'hidden' ? (
                        <span>{t('platform:moderationDesk.hiddenByAuthor')}</span>
                      ) : (
                        <span>—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-end">
                      {available.length > 0 ? (
                        <Button variant="secondary" size="sm" onClick={() => setTarget(row)}>
                          {t('platform:moderationDesk.moderate')}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      )}

      {target ? (
        <DecisionDialog
          title={t('platform:moderationDesk.moderatePostTitle')}
          description={t('platform:moderationDesk.moderatePostDescription', {
            target: target.author_label ?? t('platform:moderationDesk.unknownAuthor'),
          })}
          options={options.filter((option) => option.value !== target.visibility)}
          isPending={moderate.isPending}
          onClose={() => setTarget(null)}
          onConfirm={(decision, reason) =>
            moderate.mutate(
              { postId: target.id, visibility: decision as ModerationPostRow['visibility'], reason },
              {
                onSuccess: () => {
                  notify.ok(t('platform:moderationDesk.postModerated'))
                  setTarget(null)
                },
                onError: (error) => notify.fail(t('platform:moderationDesk.moderationRefused'), error),
              },
            )
          }
        />
      ) : null}
    </section>
  )
}

// ============================================================================
// Onglet 3 — les signalements
// ============================================================================

function ReportsTab() {
  const { t } = useTranslation()
  const stamp = useStamp()
  const label = useVocabulary()
  const notify = useRefusalToast()

  const [scope, setScope] = useState<'open' | 'all'>('open')
  const query = useModerationReports(scope === 'all')
  const resolve = useResolveReviewReport()

  function decide(row: ModerationReportRow, status: 'reviewed' | 'dismissed' | 'actioned') {
    resolve.mutate(
      { reportId: row.id, status },
      {
        onSuccess: () => notify.ok(t('platform:moderationDesk.reportResolved')),
        onError: (error) => notify.fail(t('platform:moderationDesk.resolveRefused'), error),
      },
    )
  }

  return (
    <section>
      <SegmentedControl<'open' | 'all'>
        className="mb-4 sm:max-w-xs"
        ariaLabel={t('platform:moderationDesk.filterScope')}
        value={scope}
        onChange={setScope}
        options={[
          { value: 'open', label: t('platform:moderationDesk.scopeOpen') },
          { value: 'all', label: t('platform:moderationDesk.scopeAll') },
        ]}
      />

      {query.isPending ? (
        <QueueSkeleton />
      ) : query.isError ? (
        <ErrorState
          title={t('platform:moderationDesk.reportsLoadFailed')}
          description={getErrorMessage(query.error)}
        />
      ) : (
        <Table label={t('platform:moderationDesk.tabReports')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('common:field.reason')}</TableHead>
              <TableHead>{t('platform:moderationDesk.colReportedReview')}</TableHead>
              <TableHead>{t('platform:moderationDesk.colTarget')}</TableHead>
              <TableHead>{t('common:field.status')}</TableHead>
              <TableHead>{t('platform:moderationDesk.colResolvedBy')}</TableHead>
              <TableHead>
                <span className="sr-only">{t('common:action.actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(query.data ?? []).length === 0 ? (
              <TableStateRow colSpan={6}>
                <EmptyState
                  className="border-none"
                  title={
                    scope === 'open'
                      ? t('platform:moderationDesk.reportsEmptyOpen')
                      : t('platform:moderationDesk.reportsEmpty')
                  }
                />
              </TableStateRow>
            ) : (
              (query.data ?? []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="max-w-[16rem]">
                    <span className="block font-medium text-ink-950">{label.reason(row.reason)}</span>
                    <span className="block truncate text-xs text-ink-500" title={row.detail ?? undefined}>
                      {row.detail ?? t('platform:moderationDesk.noDetail')}
                    </span>
                  </TableCell>
                  {/*
                    L'avis visé est rendu ICI, en entier : décider d'un
                    signalement sans relire l'avis obligerait à changer
                    d'écran, et c'est ainsi qu'on décide sans regarder.
                  */}
                  <TableCell className="max-w-[20rem]">
                    <span className="block font-medium text-ink-950">{`${row.review_rating}/5`}</span>
                    <span className="block truncate text-xs text-ink-500" title={row.review_comment ?? undefined}>
                      {row.review_comment ?? t('platform:moderationDesk.noComment')}
                    </span>
                    <Badge variant={REVIEW_STATUS_VARIANT[row.review_status] ?? 'neutral'} className="mt-1">
                      {t(`platform:moderationDesk.reviewStatus_${row.review_status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[14rem]">
                    <span className="block truncate text-ink-950">{row.professional_display_name}</span>
                    <span className="block truncate text-xs text-ink-500">{row.organization_name}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={REPORT_STATUS_VARIANT[row.status] ?? 'neutral'}>
                      {t(`platform:moderationDesk.reportStatus_${row.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[14rem] text-xs text-ink-500">
                    {row.resolved_at ? (
                      <>
                        <span className="block truncate">
                          {row.resolved_by_email ?? t('platform:moderationDesk.unknownActor')}
                        </span>
                        <span className="block whitespace-nowrap">{stamp.dateTime(row.resolved_at)}</span>
                      </>
                    ) : (
                      <span>—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-end">
                    {row.status === 'open' ? (
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          isLoading={isResolving(resolve, row.id, 'reviewed')}
                          onClick={() => decide(row, 'reviewed')}
                        >
                          {t('platform:moderationDesk.resolveReviewed')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          isLoading={isResolving(resolve, row.id, 'dismissed')}
                          onClick={() => decide(row, 'dismissed')}
                        >
                          {t('platform:moderationDesk.resolveDismissed')}
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          isLoading={isResolving(resolve, row.id, 'actioned')}
                          onClick={() => decide(row, 'actioned')}
                        >
                          {t('platform:moderationDesk.resolveActioned')}
                        </Button>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}
    </section>
  )
}

/** Le bouton exact qui attend, pas les trois : trois filantes pour un clic ne disent plus rien. */
function isResolving(
  resolve: ReturnType<typeof useResolveReviewReport>,
  reportId: string,
  status: 'reviewed' | 'dismissed' | 'actioned',
) {
  return resolve.isPending && resolve.variables?.reportId === reportId && resolve.variables.status === status
}

// ============================================================================
// Onglet 4 — les onboardings, partagés avec le commercial
// ============================================================================

function ApplicationsTab() {
  const { t } = useTranslation()
  const stamp = useStamp()
  const notify = useRefusalToast()

  const [filter, setFilter] = useState<ApplicationFilter>('pending_review')
  const query = useApplicationQueue(filter === 'all' ? undefined : filter)
  const review = useReviewApplication()
  const [target, setTarget] = useState<{ row: ApplicationQueueRow; decision: 'approve' | 'reject' } | null>(null)

  return (
    <section>
      {/*
        LE DÉFAUT QUE CET ONGLET RÉPARE : depuis PLAT-1, un modérateur et un
        commercial pouvaient VALIDER une candidature qu'ils ne pouvaient pas
        LIRE — `professional_applications_select` exige `is_platform_admin()`.
        `list_professional_applications_queue` leur ouvre la file sans élargir
        la policy. Conséquence assumée : la ligne ne renvoie PAS vers
        /platform/applications/:id, dont la lecture reste réservée aux admins ;
        tout ce qu'il faut pour décider est ici.
      */}
      <Alert variant="info" className="mb-4">
        {t('platform:moderationDesk.applicationsShared')}
      </Alert>

      <SegmentedControl<ApplicationFilter>
        className="mb-4 sm:max-w-lg"
        ariaLabel={t('platform:moderationDesk.filterStatus')}
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'pending_review', label: t('platform:moderationDesk.appStatus_pending_review') },
          { value: 'approved', label: t('platform:moderationDesk.appStatus_approved') },
          { value: 'rejected', label: t('platform:moderationDesk.appStatus_rejected') },
          { value: 'all', label: t('platform:moderationDesk.filterAll') },
        ]}
      />

      {query.isPending ? (
        <QueueSkeleton />
      ) : query.isError ? (
        <ErrorState
          title={t('platform:moderationDesk.applicationsLoadFailed')}
          description={getErrorMessage(query.error)}
        />
      ) : (
        <Table label={t('platform:moderationDesk.tabApplications')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('platform:moderationDesk.colBusiness')}</TableHead>
              <TableHead>{t('platform:moderationDesk.colApplicant')}</TableHead>
              <TableHead>{t('platform:moderationDesk.colCity')}</TableHead>
              <TableHead>{t('platform:moderationDesk.colSubmitted')}</TableHead>
              <TableHead>{t('common:field.status')}</TableHead>
              <TableHead>
                <span className="sr-only">{t('common:action.actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(query.data ?? []).length === 0 ? (
              <TableStateRow colSpan={6}>
                <EmptyState
                  className="border-none"
                  title={
                    filter === 'pending_review'
                      ? t('platform:moderationDesk.applicationsEmptyPending')
                      : t('platform:moderationDesk.applicationsEmpty')
                  }
                />
              </TableStateRow>
            ) : (
              (query.data ?? []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="max-w-[14rem]">
                    <span className="block truncate font-medium text-ink-950">{row.business_name}</span>
                    <span className="block truncate text-xs text-ink-500">{row.professional_type}</span>
                  </TableCell>
                  <TableCell className="max-w-[16rem]">
                    <span className="block truncate text-ink-700">{`${row.first_name} ${row.last_name}`}</span>
                    <span className="block truncate text-xs text-ink-500">{row.email}</span>
                    {row.phone ? (
                      <a href={`tel:${row.phone}`} className="block truncate text-xs text-accent-600 underline-offset-2 hover:underline">
                        {row.phone}
                      </a>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-ink-500">{row.city ?? '—'}</TableCell>
                  <TableCell className="whitespace-nowrap text-ink-500">{stamp.date(row.submitted_at)}</TableCell>
                  <TableCell>
                    <Badge variant={APPLICATION_STATUS_VARIANT[row.status] ?? 'neutral'}>
                      {t(`platform:moderationDesk.appStatus_${row.status}`)}
                    </Badge>
                    {row.reviewed_by_email ? (
                      <span className="mt-1 block truncate text-xs text-ink-500">{row.reviewed_by_email}</span>
                    ) : null}
                    {row.rejection_reason ? (
                      <span className="mt-1 block max-w-[14rem] truncate text-xs text-ink-500" title={row.rejection_reason}>
                        {row.rejection_reason}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-end">
                    {row.status === 'pending_review' ? (
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button variant="secondary" size="sm" onClick={() => setTarget({ row, decision: 'approve' })}>
                          {t('platform:moderationDesk.approve')}
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => setTarget({ row, decision: 'reject' })}>
                          {t('platform:moderationDesk.reject')}
                        </Button>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}

      {target ? (
        <ApplicationDecisionDialog
          row={target.row}
          decision={target.decision}
          isPending={review.isPending}
          onClose={() => setTarget(null)}
          onConfirm={(rejectionReason, internalNote) =>
            review.mutate(
              {
                applicationId: target.row.id,
                decision: target.decision,
                rejectionReason,
                internalNote,
              },
              {
                onSuccess: () => {
                  notify.ok(
                    target.decision === 'approve'
                      ? t('platform:moderationDesk.applicationApproved')
                      : t('platform:moderationDesk.applicationRejected'),
                  )
                  setTarget(null)
                },
                onError: (error) => notify.fail(t('platform:moderationDesk.decisionRefused'), error),
              },
            )
          }
        />
      ) : null}
    </section>
  )
}

/**
 * Approuver ou refuser une candidature.
 *
 * LE MOTIF DE REFUS EST EXIGÉ ICI, PAS PAR LE SERVEUR :
 * `review_professional_application` accepte `p_rejection_reason` nul et se
 * contente de le normaliser. Mais ce motif part dans l'e-mail
 * `professional_application_rejected` : refuser sans un mot, c'est envoyer un
 * refus vide à un professionnel. L'interface l'exige donc, et le dit.
 */
function ApplicationDecisionDialog({
  row,
  decision,
  isPending,
  onClose,
  onConfirm,
}: {
  row: ApplicationQueueRow
  decision: 'approve' | 'reject'
  isPending: boolean
  onClose: () => void
  onConfirm: (rejectionReason: string | null, internalNote: string | null) => void
}) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [invalid, setInvalid] = useState(false)

  function submit() {
    if (decision === 'reject' && reason.trim().length === 0) {
      setInvalid(true)
      return
    }
    onConfirm(decision === 'reject' ? reason.trim() : null, note.trim() || null)
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {decision === 'approve'
              ? t('platform:moderationDesk.approveApplicationTitle')
              : t('platform:moderationDesk.rejectApplicationTitle')}
          </DialogTitle>
          <DialogDescription>
            {decision === 'approve'
              ? t('platform:moderationDesk.approveApplicationDescription', { business: row.business_name })
              : t('platform:moderationDesk.rejectApplicationDescription', { business: row.business_name })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {decision === 'reject' ? (
            <Textarea
              label={t('platform:moderationDesk.rejectionReasonLabel')}
              hint={t('platform:moderationDesk.rejectionReasonHint')}
              error={invalid ? t('platform:moderationDesk.rejectionReasonRequired') : undefined}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value)
                setInvalid(false)
              }}
            />
          ) : null}
          <Textarea
            label={t('platform:moderationDesk.internalNoteLabel')}
            hint={t('platform:moderationDesk.internalNoteHint')}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('common:action.cancel')}
          </Button>
          <Button variant={decision === 'approve' ? 'primary' : 'danger'} isLoading={isPending} onClick={submit}>
            {decision === 'approve' ? t('platform:moderationDesk.approve') : t('platform:moderationDesk.reject')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// Onglet 5 — les revendications, et leur arbitrage
// ============================================================================

function ClaimsTab() {
  const { t } = useTranslation()
  const stamp = useStamp()
  const notify = useRefusalToast()

  const [scope, setScope] = useState<'pending' | 'all'>('pending')
  const query = useClaimQueue(scope === 'all')
  const review = useReviewClaim()
  const [target, setTarget] = useState<{ row: ClaimQueueRow; decision: 'approve' | 'reject'; rivals: number } | null>(
    null,
  )

  /*
   * GROUPÉ PAR PROFIL, PAS RETRIÉ. La file arrive triée serveur, contestées
   * en tête ; regrouper en conservant l'ordre de première apparition garde
   * cet ordre-là. Un humain ne peut pas arbitrer deux demandes rivales s'il
   * doit les chercher à deux endroits de la liste.
   */
  const groups = useMemo(() => {
    const byProfessional = new Map<string, ClaimQueueRow[]>()
    for (const row of query.data ?? []) {
      const existing = byProfessional.get(row.professional_id)
      if (existing) existing.push(row)
      else byProfessional.set(row.professional_id, [row])
    }
    return [...byProfessional.values()]
  }, [query.data])

  return (
    <section>
      <SegmentedControl<'pending' | 'all'>
        className="mb-4 sm:max-w-xs"
        ariaLabel={t('platform:moderationDesk.filterScope')}
        value={scope}
        onChange={setScope}
        options={[
          { value: 'pending', label: t('platform:moderationDesk.scopePending') },
          { value: 'all', label: t('platform:moderationDesk.scopeAll') },
        ]}
      />

      {query.isPending ? (
        <QueueSkeleton />
      ) : query.isError ? (
        <ErrorState
          title={t('platform:moderationDesk.claimsLoadFailed')}
          description={getErrorMessage(query.error)}
        />
      ) : groups.length === 0 ? (
        <EmptyState
          title={
            scope === 'pending'
              ? t('platform:moderationDesk.claimsEmptyPending')
              : t('platform:moderationDesk.claimsEmpty')
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => {
            const head = group[0]!
            const pending = group.filter((row) => row.state === 'pending')
            /* Le nombre de demandes vivantes SUR CE PROFIL, tel que le serveur
               le compte (`competing_pending` = les AUTRES). */
            const live = pending.length === 0 ? 0 : Math.max(...pending.map((row) => row.competing_pending)) + 1
            const contested = live > 1

            return (
              <Card key={head.professional_id}>
                <CardContent className="p-4 pt-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink-950">{head.professional_display_name}</p>
                      <p className="truncate text-xs text-ink-500">
                        {head.professional_handle ? `@${head.professional_handle}` : '—'}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={head.professional_claim_state === 'claimed' ? 'success' : 'neutral'}>
                        {t(`platform:moderationDesk.claimState_${head.professional_claim_state}`)}
                      </Badge>
                      {contested ? (
                        <Badge variant="warning">{t('platform:moderationDesk.contestedBadge')}</Badge>
                      ) : null}
                    </div>
                  </div>

                  {/* L'ARBITRAGE, DIT FORT. Jamais « dernier arrivé gagne » —
                      MASTER_SPEC §5. */}
                  {contested ? (
                    <Alert variant="warning" className="mt-3">
                      {t('platform:moderationDesk.contestedWarning', { total: live })}
                    </Alert>
                  ) : null}

                  <div className="mt-3">
                    {/* Un nom par région : plusieurs tableaux portant la même
                        étiquette accessible sont indistinguables au lecteur
                        d'écran, or c'est précisément entre eux qu'on arbitre. */}
                    <Table label={`${t('platform:moderationDesk.tabClaims')} — ${head.professional_display_name}`}>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('platform:moderationDesk.colClaimant')}</TableHead>
                          <TableHead>{t('platform:moderationDesk.colEvidence')}</TableHead>
                          <TableHead>{t('platform:moderationDesk.colSubmitted')}</TableHead>
                          <TableHead>{t('common:field.status')}</TableHead>
                          <TableHead>
                            <span className="sr-only">{t('common:action.actions')}</span>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell className="max-w-[16rem] truncate text-ink-950">
                              {row.claimant_email ?? t('platform:moderationDesk.unknownActor')}
                            </TableCell>
                            <TableCell className="max-w-[22rem]">
                              <span className="block whitespace-pre-line text-xs text-ink-700">
                                {row.evidence ?? t('platform:moderationDesk.noEvidence')}
                              </span>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-ink-500">
                              {stamp.dateTime(row.submitted_at)}
                            </TableCell>
                            <TableCell>
                              <Badge variant={CLAIM_STATE_VARIANT[row.state] ?? 'neutral'}>
                                {t(`platform:moderationDesk.claimState_${row.state}`)}
                              </Badge>
                              {row.decided_by_email ? (
                                <span className="mt-1 block truncate text-xs text-ink-500">{row.decided_by_email}</span>
                              ) : null}
                              {row.decision_note ? (
                                <span className="mt-1 block max-w-[12rem] truncate text-xs text-ink-500" title={row.decision_note}>
                                  {row.decision_note}
                                </span>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-end">
                              {row.state === 'pending' ? (
                                <div className="flex flex-wrap justify-end gap-2">
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => setTarget({ row, decision: 'approve', rivals: row.competing_pending })}
                                  >
                                    {t('platform:moderationDesk.approve')}
                                  </Button>
                                  <Button
                                    variant="danger"
                                    size="sm"
                                    onClick={() => setTarget({ row, decision: 'reject', rivals: row.competing_pending })}
                                  >
                                    {t('platform:moderationDesk.reject')}
                                  </Button>
                                </div>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {target ? (
        <ClaimDecisionDialog
          row={target.row}
          decision={target.decision}
          rivals={target.rivals}
          isPending={review.isPending}
          onClose={() => setTarget(null)}
          onConfirm={(note) =>
            review.mutate(
              { claimId: target.row.id, decision: target.decision, note },
              {
                onSuccess: () => {
                  notify.ok(
                    target.decision === 'approve'
                      ? t('platform:moderationDesk.claimApproved')
                      : t('platform:moderationDesk.claimRejected'),
                  )
                  setTarget(null)
                },
                onError: (error) => notify.fail(t('platform:moderationDesk.decisionRefused'), error),
              },
            )
          }
        />
      ) : null}
    </section>
  )
}

/**
 * La décision sur une revendication.
 *
 * APPROUVER FERME LES RIVALES, ET L'UTILISATEUR DOIT LE SAVOIR AVANT DE
 * CLIQUER : `review_professional_claim` clôt toutes les autres demandes
 * vivantes sur le même profil dans la même transaction. Ce n'est pas du
 * ménage, c'est le geste qui empêche un second arbitre d'approuver plus tard
 * une identité déjà attribuée.
 */
function ClaimDecisionDialog({
  row,
  decision,
  rivals,
  isPending,
  onClose,
  onConfirm,
}: {
  row: ClaimQueueRow
  decision: 'approve' | 'reject'
  rivals: number
  isPending: boolean
  onClose: () => void
  onConfirm: (note: string | null) => void
}) {
  const { t } = useTranslation()
  const [note, setNote] = useState('')

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {decision === 'approve'
              ? t('platform:moderationDesk.approveClaimTitle')
              : t('platform:moderationDesk.rejectClaimTitle')}
          </DialogTitle>
          <DialogDescription>
            {decision === 'approve'
              ? t('platform:moderationDesk.approveClaimDescription', {
                  profile: row.professional_display_name,
                  claimant: row.claimant_email ?? t('platform:moderationDesk.unknownActor'),
                })
              : t('platform:moderationDesk.rejectClaimDescription', {
                  claimant: row.claimant_email ?? t('platform:moderationDesk.unknownActor'),
                })}
          </DialogDescription>
        </DialogHeader>

        {decision === 'approve' && rivals > 0 ? (
          <Alert variant="warning" className="mb-4">
            {t('platform:moderationDesk.approveClosesRivals', { total: rivals })}
          </Alert>
        ) : null}

        <Textarea
          label={t('common:field.notesOptional')}
          hint={t('platform:moderationDesk.claimNoteHint')}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('common:action.cancel')}
          </Button>
          <Button
            variant={decision === 'approve' ? 'primary' : 'danger'}
            isLoading={isPending}
            onClick={() => onConfirm(note.trim() || null)}
          >
            {decision === 'approve' ? t('platform:moderationDesk.approve') : t('platform:moderationDesk.reject')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// La vue en tant que, et sa limite
// ============================================================================

/**
 * Entrer dans la vue d'un propriétaire depuis une ligne d'avis.
 *
 * CE QUE CE BOUTON FAIT ET CE QU'IL NE FAIT PAS, ÉCRIT DANS LA MODALE. PLAT-1
 * §5 a livré le CADRE — la trace, l'échéance de 30 minutes, le bandeau
 * permanent, la garde de paiement sur les six RPC Stripe — et PAS l'élévation
 * de lecture. Un modérateur en vue empruntée ne voit toujours ni les
 * établissements ni l'équipe du salon. Laisser croire l'inverse produirait
 * exactement le défaut de PLAT-1 §12.7 : une garde qui dit oui sur une
 * lecture qui reste fermée.
 *
 * Seul l'onglet des avis l'offre : `ModerationPostRow` ne porte pas
 * d'`organization_id`, et il n'est pas question d'en deviner un.
 */
function SupportViewDialog({
  organizationId,
  organizationName,
  onClose,
}: {
  organizationId: string
  organizationName: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { enterSupportView, isEntering } = useSupportView()
  const notify = useRefusalToast()
  const [reason, setReason] = useState('')

  async function enter() {
    try {
      await enterSupportView({
        organizationId,
        targetType: 'organization',
        reason: reason.trim() || null,
      })
      notify.ok(t('platform:moderationDesk.supportViewStarted'))
      onClose()
    } catch (error) {
      notify.fail(t('platform:moderationDesk.supportViewRefused'), error)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('platform:moderationDesk.supportViewTitle')}</DialogTitle>
          <DialogDescription>
            {t('platform:moderationDesk.supportViewDescription', { organization: organizationName })}
          </DialogDescription>
        </DialogHeader>

        <Alert variant="warning" className="mb-4">
          {t('platform:moderationDesk.supportViewLimit')}
        </Alert>

        <Textarea
          label={t('common:field.reasonOptional')}
          hint={t('platform:moderationDesk.supportViewReasonHint')}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('common:action.cancel')}
          </Button>
          <Button isLoading={isEntering} onClick={() => void enter()}>
            {t('platform:moderationDesk.supportViewEnter')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// Le geste partagé : une décision, et son motif obligatoire
// ============================================================================

interface DecisionOption {
  value: string
  label: string
  requiresReason: boolean
}

function decisionOptions(
  t: (key: string) => string,
  canRevert: boolean,
  definitions: { value: string; labelKey: string; requiresReason: boolean; isRevert: boolean }[],
): DecisionOption[] {
  return definitions
    /*
      LE MODÉRATEUR MASQUE, IL NE DÉFAIT PAS. Remettre en ligne exige
      `moderation.revert` (fondateur et admin) et le serveur refuse sinon
      (`revert_requires_admin`). Ici l'option est ABSENTE — pas grisée, pas
      cadenassée : une option visible qu'on ne peut pas choisir est une
      promesse qu'on ne peut pas tenir.

      `isRevert` est porté explicitement plutôt que déduit de « n'exige pas de
      motif » : les deux coïncident aujourd'hui, et le jour où ils cesseront
      de coïncider, une déduction implicite rendrait un bouton interdit.
    */
    .filter((definition) => !definition.isRevert || canRevert)
    .map((definition) => ({
      value: definition.value,
      label: t(`platform:moderationDesk.${definition.labelKey}`),
      requiresReason: definition.requiresReason,
    }))
}

/**
 * La modale de décision des avis et des posts.
 *
 * LE MOTIF EST OBLIGATOIRE ET FERMÉ. Le serveur refuse un masquage sans motif
 * (`reason_required`) et hors vocabulaire (`reason_not_allowed`) ; le
 * formulaire l'exige aussi, et rappelle en une phrase que « la note est
 * mauvaise » n'est pas un motif — c'est la règle produit, pas une préférence
 * d'interface.
 */
function DecisionDialog({
  title,
  description,
  options,
  isPending,
  onClose,
  onConfirm,
}: {
  title: string
  description: string
  options: DecisionOption[]
  isPending: boolean
  onClose: () => void
  onConfirm: (decision: string, reason: ModerationReason | null) => void
}) {
  const { t } = useTranslation()
  const [decision, setDecision] = useState(options[0]?.value ?? '')
  const [reason, setReason] = useState('')
  const [invalid, setInvalid] = useState(false)

  const requiresReason = options.find((option) => option.value === decision)?.requiresReason ?? false

  function submit() {
    if (requiresReason && !MODERATION_REASONS.includes(reason as ModerationReason)) {
      setInvalid(true)
      return
    }
    onConfirm(decision, requiresReason ? (reason as ModerationReason) : null)
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <SelectField
            label={t('platform:moderationDesk.decisionLabel')}
            value={decision}
            onChange={(event) => {
              setDecision(event.target.value)
              setInvalid(false)
            }}
            options={options.map((option) => ({ value: option.value, label: option.label }))}
          />

          {requiresReason ? (
            <>
              <SelectField
                label={t('common:field.reason')}
                value={reason}
                error={invalid ? t('platform:moderationDesk.reasonRequired') : undefined}
                onChange={(event) => {
                  setReason(event.target.value)
                  setInvalid(false)
                }}
                options={[
                  { value: '', label: t('platform:moderationDesk.reasonPlaceholder') },
                  ...MODERATION_REASONS.map((value) => ({
                    value,
                    label: t(`platform:moderationDesk.reason_${value}`),
                  })),
                ]}
              />
              <p className="text-xs text-ink-500">{t('platform:moderationDesk.ruleReason')}</p>
            </>
          ) : (
            <Alert variant="info">{t('platform:moderationDesk.revertNote')}</Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('common:action.cancel')}
          </Button>
          <Button variant="danger" isLoading={isPending} onClick={submit}>
            {t('platform:moderationDesk.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// Les petites choses partagées
// ============================================================================

function QueueSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4" aria-hidden="true">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-3/4" />
    </div>
  )
}

/**
 * Les horodatages internes, écrits dans la langue du LECTEUR.
 *
 * `toLocaleString()` sans argument demande au navigateur quelle langue il
 * parle, ce qui n'est jamais la question que FadeUp pose : un modérateur qui a
 * choisi l'anglais doit lire des dates anglaises sur un portable français.
 * Aucune zone horaire d'établissement ici — ce sont des tampons de
 * plateforme, pas des heures de rendez-vous.
 */
function useStamp() {
  const { i18n } = useTranslation()
  return useMemo(
    () => ({
      date: (value: string | null) => (value ? new Date(value).toLocaleDateString(i18n.language) : '—'),
      dateTime: (value: string | null) => (value ? new Date(value).toLocaleString(i18n.language) : '—'),
    }),
    [i18n.language],
  )
}

/** Le vocabulaire fermé, traduit ; une valeur inconnue s'affiche telle quelle plutôt que de disparaître. */
function useVocabulary() {
  const { t } = useTranslation()
  return useMemo(
    () => ({
      reason: (value: string | null) => {
        if (!value) return '—'
        return KNOWN_REASONS.has(value) ? t(`platform:moderationDesk.reason_${value}`) : value
      },
    }),
    [t],
  )
}

/**
 * Les refus serveur portent un motif NOMMÉ (`fadeup_*_refusal=…`, dans
 * `details` ou dans le message). L'afficher tel quel donnerait « new row
 * violates… » ; le traduire donne une phrase qui dit ce qu'il faut faire.
 * Ce qui n'est pas reconnu tombe sur le message brut plutôt que sur rien.
 */
function useRefusalToast() {
  const { t } = useTranslation()
  const { toast } = useToast()

  return useMemo(
    () => ({
      ok: (title: string) => toast({ title, variant: 'success' }),
      fail: (title: string, error: unknown) => {
        const token = refusalToken(error)
        const known = token ? REFUSAL_KEYS[token] : undefined
        toast({
          title,
          description: known ? t(`platform:moderationDesk.${known}`) : getErrorMessage(error),
          variant: 'error',
        })
      },
    }),
    [t, toast],
  )
}

const REFUSAL_KEYS: Record<string, string> = {
  reason_required: 'refusalReasonRequired',
  reason_not_allowed: 'refusalReasonNotAllowed',
  revert_requires_admin: 'refusalRevertRequiresAdmin',
  not_authorized: 'refusalNotAuthorized',
  moderation_required: 'refusalNotAuthorized',
  invalid_status: 'refusalInvalidStatus',
}

function refusalToken(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const candidates = [
    'details' in error ? error.details : null,
    'hint' in error ? error.hint : null,
    getErrorMessage(error),
  ]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const match = /fadeup_[a-z_]*refusal=([a-z_]+)/.exec(candidate)
    if (match) return match[1]!
  }
  return null
}
