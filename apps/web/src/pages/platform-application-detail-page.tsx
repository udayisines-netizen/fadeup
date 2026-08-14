import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Phone, Copy, Check, X, Building2, Globe, AtSign, MapPin, Users2, Hash } from 'lucide-react'
import type { ReactNode } from 'react'
import { Container } from '@/components/ui/container'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Textarea } from '@/components/ui/textarea'
import { ErrorState } from '@/components/ui/error-state'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { getErrorMessage } from '@/lib/get-error-message'
import { usePlatformApplication, useReviewApplication } from '@/lib/queries/professional-applications'

/**
 * /platform/applications/:applicationId — the review surface.
 *
 * Three actions: call, approve, refuse. Approve and refuse both confirm
 * first, because both are one-way from the applicant's point of view.
 */
export function PlatformApplicationDetailPage() {
  const { t } = useTranslation('auth')
  const { applicationId } = useParams()
  const query = usePlatformApplication(applicationId)

  return (
    <Container size="lg" className="py-8">
      <Link
        to="/platform/applications"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-950"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t('platform.backToList')}
      </Link>

      {query.isPending ? (
        <div className="mt-4 flex flex-col gap-3" aria-hidden="true">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : query.isError ? (
        <ErrorState className="mt-4" title="Couldn't load this application" description={query.error.message} />
      ) : !query.data ? (
        <EmptyState className="mt-4" title="Application not found" />
      ) : (
        <ApplicationDetail application={query.data} />
      )}
    </Container>
  )
}

type Application = NonNullable<ReturnType<typeof usePlatformApplication>['data']>

function ApplicationDetail({ application }: { application: Application }) {
  const { t } = useTranslation('auth')
  const toast = useToast()
  const review = useReviewApplication()
  const [confirming, setConfirming] = useState<'approve' | 'reject' | null>(null)
  const [rejectionReason, setRejectionReason] = useState('')
  const [internalNote, setInternalNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const isPending = application.status === 'pending_review'
  const statusLabel =
    application.status === 'approved'
      ? t('application.statusApproved')
      : application.status === 'rejected'
        ? t('application.statusRejected')
        : t('application.statusPending')
  const statusVariant =
    application.status === 'approved' ? 'success' : application.status === 'rejected' ? 'danger' : 'warning'

  async function handleCopyPhone() {
    try {
      await navigator.clipboard.writeText(application.phone)
      setCopied(true)
      toast.toast({ variant: 'success', title: t('platform.phoneCopied') })
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard can be unavailable (insecure context, denied permission).
      // The number is rendered as selectable text anyway, so this is a
      // convenience that is allowed to fail quietly.
    }
  }

  async function handleDecision(decision: 'approve' | 'reject') {
    setError(null)
    try {
      await review.mutateAsync({
        applicationId: application.id,
        decision,
        rejectionReason: decision === 'reject' ? rejectionReason || null : null,
        internalNote: internalNote || null,
      })
      setConfirming(null)
      toast.toast({
        variant: 'success',
        title: decision === 'approve' ? t('platform.approvedToast') : t('platform.rejectedToast'),
      })
    } catch (decisionError) {
      setError(getErrorMessage(decisionError) ?? 'Something went wrong.')
    }
  }

  return (
    <>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink-950">{application.businessName}</h1>
          <p className="mt-1 text-sm text-ink-500">
            {application.firstName} {application.lastName} · {t(`professionalType.${application.professionalType}`)}
          </p>
        </div>
        <Badge variant={statusVariant}>{statusLabel}</Badge>
      </div>

      {error ? (
        <Alert variant="error" className="mt-4">
          {error}
        </Alert>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {/*
          Contact card first and full-width on mobile: calling the applicant
          is the reviewer's primary job before deciding.
        */}
        <Card className="p-5 lg:col-span-1">
          <h2 className="text-sm font-semibold text-ink-950">{t('platform.contactSection')}</h2>

          <p className="mt-4 text-lg font-semibold tracking-tight text-ink-950">{application.phone}</p>
          <p className="text-xs text-ink-500">{t('platform.callHint')}</p>

          <div className="mt-3 flex flex-wrap gap-2">
            {/*
              A real tel: link, not a VoIP integration — the device does the
              dialling. On desktop it still resolves to whatever handler the
              OS has, and the number above stays selectable regardless.
            */}
            <a
              href={`tel:${application.phone}`}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md bg-accent-600 px-4 text-sm font-medium text-paper-0 transition-colors hover:bg-accent-700"
            >
              <Phone className="h-4 w-4" aria-hidden="true" />
              {t('platform.call')}
            </a>
            <Button variant="secondary" onClick={() => void handleCopyPhone()} aria-label={t('platform.copyPhone')}>
              {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
            </Button>
          </div>

          <dl className="mt-5 flex flex-col gap-3 border-t border-border pt-4 text-sm">
            <Field label={t('platform.colEmail')}>
              <a href={`mailto:${application.email}`} className="text-ink-800 underline-offset-2 hover:underline">
                {application.email}
              </a>
            </Field>
            <Field label={t('platform.colSubmitted')}>
              {new Date(application.submittedAt).toLocaleString()}
            </Field>
            {application.reviewedAt ? (
              <Field label={t('platform.reviewedOn')}>{new Date(application.reviewedAt).toLocaleString()}</Field>
            ) : null}
          </dl>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-ink-950">{t('platform.businessSection')}</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label={t('platform.colBusiness')} icon={<Building2 className="h-3.5 w-3.5" aria-hidden="true" />}>
              {application.businessName}
            </Field>
            <Field label={t('platform.colType')}>{t(`professionalType.${application.professionalType}`)}</Field>
            <Field label={t('platform.colCity')} icon={<MapPin className="h-3.5 w-3.5" aria-hidden="true" />}>
              {[application.addressLine1, application.postalCode, application.city, application.country]
                .filter(Boolean)
                .join(', ') || '—'}
            </Field>
            <Field label={t('register.staffCount')} icon={<Users2 className="h-3.5 w-3.5" aria-hidden="true" />}>
              {application.staffCount ?? '—'}
            </Field>
            <Field label={t('register.website')} icon={<Globe className="h-3.5 w-3.5" aria-hidden="true" />}>
              {application.website ? (
                <a
                  href={application.website.startsWith('http') ? application.website : `https://${application.website}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-ink-800 underline-offset-2 hover:underline"
                >
                  {application.website}
                </a>
              ) : (
                '—'
              )}
            </Field>
            <Field label={t('register.instagram')} icon={<AtSign className="h-3.5 w-3.5" aria-hidden="true" />}>
              {application.instagram ?? '—'}
            </Field>
            <Field label={t('register.businessIdentifier')} icon={<Hash className="h-3.5 w-3.5" aria-hidden="true" />}>
              {application.businessIdentifier ?? '—'}
            </Field>
            {application.organizationId ? (
              <Field label={t('platform.organizationCreated')}>
                <Link
                  to={`/platform/organizations/${application.organizationId}`}
                  className="text-accent-700 underline-offset-2 hover:underline"
                >
                  {application.businessName}
                </Link>
              </Field>
            ) : null}
          </dl>
        </Card>
      </div>

      {application.rejectionReason ? (
        <Card className="mt-4 p-5">
          <h2 className="text-sm font-semibold text-ink-950">{t('platform.rejectionReason')}</h2>
          <p className="mt-2 text-sm text-ink-700">{application.rejectionReason}</p>
        </Card>
      ) : null}

      {isPending ? (
        <Card className="mt-4 p-5">
          <h2 className="text-sm font-semibold text-ink-950">{t('platform.reviewSection')}</h2>

          {/*
            Internal notes are captured alongside the decision and are stored
            in a column the applicant-facing RPC cannot return, and are never
            placed in the email payload.
          */}
          <div className="mt-4">
            <Textarea
              label={t('platform.internalNote')}
              hint={t('platform.internalNoteHint')}
              rows={2}
              value={internalNote}
              onChange={(event) => setInternalNote(event.target.value)}
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => setConfirming('approve')} isLoading={review.isPending && confirming === 'approve'}>
              <Check className="h-4 w-4" aria-hidden="true" />
              {t('platform.approve')}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming('reject')}>
              <X className="h-4 w-4" aria-hidden="true" />
              {t('platform.reject')}
            </Button>
          </div>
        </Card>
      ) : null}

      <Dialog open={confirming === 'approve'} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('platform.approveTitle', { business: application.businessName })}</DialogTitle>
            <DialogDescription>{t('platform.approveBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">{t('application.cancel')}</Button>
            </DialogClose>
            <Button variant="primary" isLoading={review.isPending} onClick={() => void handleDecision('approve')}>
              {t('platform.approveConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirming === 'reject'} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('platform.rejectTitle', { business: application.businessName })}</DialogTitle>
            <DialogDescription>{t('platform.rejectBody')}</DialogDescription>
          </DialogHeader>
          <div className="mt-2">
            <Textarea
              label={t('platform.rejectionReason')}
              hint={t('platform.rejectionReasonHint')}
              rows={3}
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">{t('application.cancel')}</Button>
            </DialogClose>
            <Button variant="danger" isLoading={review.isPending} onClick={() => void handleDecision('reject')}>
              {t('platform.rejectConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Field({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-500">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 text-sm text-ink-950">{children}</dd>
    </div>
  )
}
