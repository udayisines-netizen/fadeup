import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Phone } from 'lucide-react'
import { Container } from '@/components/ui/container'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  usePlatformApplications,
  type PlatformApplication,
  type ProfessionalApplicationStatus,
} from '@/lib/queries/professional-applications'

/**
 * /platform/applications — the review queue, inside the existing Platform
 * interface rather than a separate admin app.
 *
 * Pending is the default tab and sorts oldest-first: the queue is work to
 * get through, so the application that has been waiting longest is the one
 * that should be looked at next. Approved/rejected sort newest-first, since
 * those are history.
 */
export function PlatformApplicationsPage() {
  const { t } = useTranslation('auth')

  return (
    <Container size="lg" className="py-8">
      <h1 className="text-xl font-semibold text-ink-950">{t('platform.applicationsTitle')}</h1>
      <p className="mt-1 text-sm text-ink-500">{t('platform.applicationsSubtitle')}</p>

      <Tabs defaultValue="pending_review" className="mt-6">
        <TabsList>
          <TabsTrigger value="pending_review">{t('platform.tabPending')}</TabsTrigger>
          <TabsTrigger value="approved">{t('platform.tabApproved')}</TabsTrigger>
          <TabsTrigger value="rejected">{t('platform.tabRejected')}</TabsTrigger>
        </TabsList>

        <TabsContent value="pending_review">
          <ApplicationsTable status="pending_review" />
        </TabsContent>
        <TabsContent value="approved">
          <ApplicationsTable status="approved" />
        </TabsContent>
        <TabsContent value="rejected">
          <ApplicationsTable status="rejected" />
        </TabsContent>
      </Tabs>
    </Container>
  )
}

function ApplicationsTable({ status }: { status: ProfessionalApplicationStatus }) {
  const { t } = useTranslation('auth')
  const query = usePlatformApplications(status)

  if (query.isPending) {
    return (
      <div className="mt-4 flex flex-col gap-2" aria-hidden="true">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-3/4" />
      </div>
    )
  }

  if (query.isError) {
    return <ErrorState className="mt-4" title={t('platform:applications.couldntLoadApplications')} description={query.error.message} />
  }

  const emptyTitle =
    status === 'pending_review'
      ? t('platform.emptyPending')
      : status === 'approved'
        ? t('platform.emptyApproved')
        : t('platform.emptyRejected')

  if (query.data.length === 0) {
    return (
      <EmptyState
        className="mt-4"
        title={emptyTitle}
        description={status === 'pending_review' ? t('platform.emptyPendingHint') : undefined}
      />
    )
  }

  return (
    <>
      {/*
        Below `sm` the queue is a stack of cards rather than a seven-column
        table. A table that wide can only be read on a phone by dragging it
        sideways, which pushes the phone number — the single thing a reviewer
        most needs to act on — off screen behind a scroll. Same data, same
        order, laid out for the device.
      */}
      <ul className="mt-4 flex flex-col gap-3 sm:hidden">
        {query.data.map((application) => (
          <ApplicationCard key={application.id} application={application} />
        ))}
      </ul>

      <div className="mt-4 hidden overflow-x-auto sm:block">
        <Table label={t('platform.applicationsTitle')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('platform.colBusiness')}</TableHead>
              <TableHead>{t('platform.colApplicant')}</TableHead>
              <TableHead>{t('platform.colType')}</TableHead>
              <TableHead>{t('platform.colCity')}</TableHead>
              <TableHead>{t('platform.colPhone')}</TableHead>
              <TableHead>{t('platform.colSubmitted')}</TableHead>
              <TableHead>{t('platform.colStatus')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data.map((application) => (
              <ApplicationRow key={application.id} application={application} />
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
}

function statusPresentation(application: PlatformApplication) {
  return {
    approved: { label: 'application.statusApproved', variant: 'success' as const },
    rejected: { label: 'application.statusRejected', variant: 'danger' as const },
    pending_review: { label: 'application.statusPending', variant: 'warning' as const },
  }[application.status]
}

function ApplicationCard({ application }: { application: PlatformApplication }) {
  const { t } = useTranslation('auth')
  const presentation = statusPresentation(application)

  return (
    <li className="rounded-lg border border-border bg-paper-0 p-4">
      <div className="flex items-start justify-between gap-3">
        {/*
          The business name is plain text here, not a link: a 24px-tall tap
          target next to a full-size Review button is a worse way to reach the
          same page, so the card offers one obvious 44px route instead of two.
        */}
        <div className="min-w-0">
          <p className="truncate font-medium text-ink-950">{application.businessName}</p>
          <p className="mt-0.5 truncate text-sm text-ink-700">
            {application.firstName} {application.lastName}
          </p>
          <p className="truncate text-xs text-ink-500">
            {t(`professionalType.${application.professionalType}`)}
            {application.city ? ` · ${application.city}` : ''}
          </p>
        </div>
        <Badge variant={presentation.variant}>{t(presentation.label)}</Badge>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <a
          href={`tel:${application.phone}`}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border border-border-strong px-3 text-sm font-medium text-ink-950 transition-colors hover:bg-paper-100"
        >
          <Phone className="h-4 w-4" aria-hidden="true" />
          {application.phone}
        </a>
        <Link
          to={`/platform/applications/${application.id}`}
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent-600 px-4 text-sm font-medium text-paper-0 transition-colors hover:bg-accent-700"
        >
          {t('platform.review')}
        </Link>
      </div>
    </li>
  )
}

function ApplicationRow({ application }: { application: PlatformApplication }) {
  const { t } = useTranslation('auth')
  const statusLabel =
    application.status === 'approved'
      ? t('application.statusApproved')
      : application.status === 'rejected'
        ? t('application.statusRejected')
        : t('application.statusPending')
  const statusVariant =
    application.status === 'approved' ? 'success' : application.status === 'rejected' ? 'danger' : 'warning'

  return (
    <TableRow>
      <TableCell>
        <Link
          to={`/platform/applications/${application.id}`}
          className="font-medium text-ink-950 underline-offset-2 hover:underline"
        >
          {application.businessName}
        </Link>
      </TableCell>
      <TableCell className="text-ink-700">
        {application.firstName} {application.lastName}
        <span className="block text-xs text-ink-500">{application.email}</span>
      </TableCell>
      <TableCell className="text-ink-500">{t(`professionalType.${application.professionalType}`)}</TableCell>
      <TableCell className="text-ink-500">{application.city ?? '—'}</TableCell>
      {/*
        The number is a link here too, not just on the detail page, so the
        queue can be worked without opening every row. The phone-sized
        equivalent is ApplicationCard's call button.
      */}
      <TableCell>
        <a href={`tel:${application.phone}`} className="text-ink-700 underline-offset-2 hover:underline">
          {application.phone}
        </a>
      </TableCell>
      <TableCell className="text-ink-500">{new Date(application.submittedAt).toLocaleDateString()}</TableCell>
      <TableCell>
        <Badge variant={statusVariant}>{statusLabel}</Badge>
      </TableCell>
    </TableRow>
  )
}
