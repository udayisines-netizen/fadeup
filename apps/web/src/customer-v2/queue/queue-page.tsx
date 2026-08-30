import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth-context'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { useMyQueueStatus, type MyQueueEntry } from '@/lib/queries/customer-app'
import { useDelayedFlag } from '@/customer-v2/hooks/use-delayed'
import { Notice } from '@/customer-v2/ui/notice'
import { V2_ROUTES, v2ShopProfilePath } from '@/customer-v2/routes'

/**
 * The customer's live queue ticket.
 *
 * ============================================================================
 * WHY THERE IS NO JOIN BUTTON ANYWHERE IN THE GREENFIELD APP
 * ============================================================================
 *
 * Joining a FadeUp queue requires being AT the shop: the join surface is the
 * kiosk URL behind the shop's own QR code, reached by scanning it on location.
 * That is the product rule, and this app enforces it BY CONSTRUCTION — no
 * customer-v2 surface renders a join affordance, so there is no remote-join
 * path to guard, weaken or bypass. A customer who found the shop online sees
 * the real waiting count on its profile and one sentence saying joining
 * happens at the shop.
 *
 * A second factor — server-validated proximity/geofencing — is specified but
 * has no backend contract yet: `join_public_queue` validates the organization
 * and location, not the caller's coordinates, and a client-side geofence would
 * be spoofable theatre rather than validation. Recorded as a backend gap, not
 * imitated in the UI.
 *
 * ============================================================================
 * "REALTIME" HERE IS HONEST POLLING
 * ============================================================================
 *
 * `get_my_queue_status` refetches on the interval its own contract sets;
 * queue_entries has no anon/customer realtime channel (its module says so).
 * The position number is keyed by its value, so a change REMOUNTS it through
 * the standard entry animation — a visible, subtle transition on every real
 * update, which under reduced motion collapses to an instant swap. Nothing
 * animates when nothing changed.
 *
 * The ticket shows people-ahead as `position - 1` — arithmetic on a real
 * number, not an estimate — and shows NO wait-minutes anywhere, because
 * nothing in this schema computes one and a queue that advertises invented
 * minutes teaches customers to distrust the real position beside it.
 */
export function CustomerV2QueuePage() {
  const { t } = useTranslation()
  const { user, loading } = useAuth()

  const queue = useMyQueueStatus(Boolean(user))
  const showSkeletons = useDelayedFlag(Boolean(user) && queue.isPending)

  useDocumentMeta({
    title: t('customer-app:v2.queue.documentTitle'),
    description: t('customer-app:v2.queue.documentDescription'),
    noIndex: true,
  })

  const active: MyQueueEntry | null =
    (queue.data ?? []).find(
      (entry) =>
        entry.status === 'waiting' || entry.status === 'called' || entry.status === 'in_service',
    ) ?? null

  return (
    <div className="mx-auto max-w-[26rem]">
      <h1 className="text-v2-lead font-semibold tracking-[-0.02em] text-v2-ink">
        {t('customer-app:v2.queue.title')}
      </h1>

      <div className="mt-4">
        {!loading && !user ? (
          <>
            <Notice
              tone="empty"
              title={t('customer-app:v2.queue.signInTitle')}
              body={t('customer-app:v2.queue.joinExplainer')}
              actionLabel={null}
              onAction={null}
            />
            <Link
              to={`/login?redirect=${encodeURIComponent(V2_ROUTES.queue)}`}
              className="v2-press mt-3 inline-flex h-11 w-full items-center justify-center rounded-v2-2 bg-v2-ink px-4 text-v2-meta font-semibold text-v2-paper hover:bg-v2-ink/90"
            >
              {t('customer-app:v2.appointments.signInAction')}
            </Link>
          </>
        ) : queue.isError ? (
          <Notice
            tone="failure"
            title={t('customer-app:v2.discovery.errorTitle')}
            body={t('customer-app:v2.discovery.errorBody')}
            actionLabel={t('customer-app:v2.discovery.retry')}
            onAction={() => void queue.refetch()}
          />
        ) : loading || queue.isPending ? (
          showSkeletons ? (
            <div className="v2-plate p-6">
              <div className="v2-skeleton mx-auto h-24 w-24 rounded-full" />
            </div>
          ) : (
            <div className="min-h-64" />
          )
        ) : active ? (
          <Ticket entry={active} />
        ) : (
          <Notice
            tone="empty"
            title={t('customer-app:v2.queue.notInQueueTitle')}
            body={t('customer-app:v2.queue.joinExplainer')}
            actionLabel={null}
            onAction={null}
          />
        )}
      </div>
    </div>
  )
}

/**
 * The boarding-pass ticket. One dominant fact — your position — and the small
 * true facts around it. `key` on the number is the whole animation system:
 * a real update remounts it through `.v2-enter`.
 */
function Ticket({ entry }: { entry: MyQueueEntry }) {
  const { t } = useTranslation()

  const isNext = entry.status === 'waiting' && entry.queuePosition === 1
  const inService = entry.status === 'in_service'
  const called = entry.status === 'called'

  return (
    <section aria-live="polite" className="v2-plate overflow-hidden text-center">
      <div className="border-b border-v2-hairline px-5 py-3">
        <p className="truncate text-v2-meta font-semibold text-v2-ink">
          <bdi>{entry.locationName}</bdi>
        </p>
        {entry.barberDisplayName ? (
          <p className="truncate text-v2-caption text-v2-ink-soft">
            <bdi>{entry.barberDisplayName}</bdi>
          </p>
        ) : null}
      </div>

      <div className="px-5 py-8">
        {inService ? (
          <p className="text-v2-heading font-semibold text-v2-green-ink">
            {t('customer-app:v2.queue.inService')}
          </p>
        ) : called || isNext ? (
          <p key="next" className="v2-enter text-v2-heading font-semibold text-v2-green-ink">
            {t('customer-app:v2.queue.youAreNext')}
          </p>
        ) : entry.queuePosition !== null ? (
          <>
            <p
              key={entry.queuePosition}
              className="v2-enter text-[4rem]/[4rem] font-semibold tabular-nums tracking-[-0.03em] text-v2-ink"
            >
              {entry.queuePosition}
            </p>
            <p className="mt-2 text-v2-meta text-v2-ink-soft">
              {t('customer-app:v2.queue.peopleAhead', { count: entry.queuePosition - 1 })}
            </p>
          </>
        ) : (
          <p className="text-v2-body text-v2-ink-soft">{t('customer-app:v2.queue.waiting')}</p>
        )}
      </div>

      <div className="border-t border-v2-hairline px-5 py-3">
        <Link
          to={v2ShopProfilePath(entry.organizationSlug, entry.locationId)}
          className="text-v2-meta font-semibold text-v2-green hover:underline"
        >
          <bdi>{entry.organizationName}</bdi>
        </Link>
      </div>
    </section>
  )
}
