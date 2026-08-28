import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Users } from 'lucide-react'
import { Panel } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { buttonVariants } from '@/components/ui/button'
import type { OrganizationAnalyticsSummary } from '@/lib/queries/analytics-summary'

/**
 * §23's Customers module.
 *
 * Two numbers, from two different sources, and the difference between them is
 * the point:
 *
 *   TOTAL     rows in `customers` for this shop — its CRM, everyone it has
 *             ever recorded, including walk-ins staff typed in by hand.
 *   RETURNING accounts with more than one DELIVERED service in the analytics
 *             window, counting bookings and the queue together. A customer who
 *             books once and walks in once is a returning customer, and
 *             treating the two channels as separate worlds would report them
 *             as two different one-time visitors.
 *
 * They are deliberately not combined into a rate. Dividing an all-time CRM
 * count by a windowed activity count produces a percentage that means nothing
 * and falls as a shop gets older, which is the sort of number a dashboard
 * shows confidently for years before anyone notices.
 */
export function CustomersPanel({
  totalCustomers,
  isPending,
  summary,
}: {
  totalCustomers: number | undefined
  isPending: boolean
  summary: OrganizationAnalyticsSummary | null | undefined
}) {
  const { t } = useTranslation('app')

  return (
    <Panel
      title={t('dashboard.customersTitle')}
      footer={
        <Link to="/app/customers" className={buttonVariants({ variant: 'secondary' }, 'w-full')}>
          {t('dashboard.customersOpen')}
        </Link>
      }
    >
      {isPending ? (
        <Skeleton className="h-20 w-full rounded-lg" />
      ) : !totalCustomers ? (
        <EmptyState
          icon={Users}
          title={t('dashboard.customersEmptyTitle')}
          description={t('dashboard.customersEmptyDescription')}
        />
      ) : (
        <dl className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <dt className="text-label uppercase text-ink-500">{t('dashboard.customersTotal')}</dt>
            <dd className="text-kpi tabular-nums text-ink-950">{totalCustomers}</dd>
          </div>
          {/* Only shown when the analytics window actually answered. A missing
              summary is "we could not ask", not "nobody came back". */}
          {summary ? (
            <div className="flex flex-col gap-1">
              <dt className="text-label uppercase text-ink-500">{t('dashboard.customersReturning')}</dt>
              <dd className="text-kpi tabular-nums text-ink-950">{summary.repeatCustomers}</dd>
            </div>
          ) : null}
        </dl>
      )}
    </Panel>
  )
}
