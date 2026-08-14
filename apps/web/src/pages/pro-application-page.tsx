import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Check, Loader2, Circle, CalendarClock, Building2, CircleCheckBig, CircleSlash } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { getSupabaseClient } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/get-error-message'
import {
  useMyProfessionalApplication,
  useUpdateMyApplicationContact,
  type MyProfessionalApplication,
} from '@/lib/queries/professional-applications'
import { Container } from '@/components/ui/container'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { TextField } from '@/components/ui/text-field'
import { Alert } from '@/components/ui/alert'
import { PageSpinner } from '@/components/ui/spinner'
import { ErrorState } from '@/components/ui/error-state'
import { useToast } from '@/components/ui/toast'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { cn } from '@/lib/cn'

/**
 * /pro/application — where an applicant lives between submitting and being
 * decided on, and where they land afterwards.
 *
 * The query behind this polls while the status is pending, so an applicant
 * sitting on this page when the reviewer approves them sees the approved
 * state without touching anything.
 */
export function ProApplicationPage() {
  const { t } = useTranslation('auth')
  const { user, loading: authLoading } = useAuth()
  const applicationQuery = useMyProfessionalApplication(Boolean(user))

  useDocumentMeta({ title: 'FadeUp Pro', description: 'Your FadeUp professional application status.', noIndex: true })

  if (authLoading || applicationQuery.isPending) {
    return <PageSpinner label="Loading" />
  }

  if (applicationQuery.isError) {
    return (
      <Container size="sm" className="py-16">
        <ErrorState title="Couldn't load your application" description={applicationQuery.error.message} />
      </Container>
    )
  }

  const application = applicationQuery.data

  if (!application) {
    return (
      <ApplicationShell>
        <Card elevated className="p-6 text-center sm:p-8">
          <h1 className="text-xl font-semibold text-ink-950">{t('application.noApplicationTitle')}</h1>
          <p className="mt-2 text-sm text-ink-500">{t('application.noApplicationLead')}</p>
          <Link to="/pro/register" className={buttonVariants({ variant: 'primary' }, 'mt-6 w-full sm:w-auto')}>
            {t('application.noApplicationCta')}
          </Link>
        </Card>
      </ApplicationShell>
    )
  }

  if (application.status === 'approved') {
    return <ApprovedState application={application} />
  }
  if (application.status === 'rejected') {
    return <RejectedState application={application} />
  }
  return <PendingState application={application} />
}

function ApplicationShell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('auth')
  const navigate = useNavigate()

  async function handleSignOut() {
    const supabase = getSupabaseClient()
    await supabase.auth.signOut()
    navigate('/pro/login', { replace: true })
  }

  return (
    <main className="min-h-svh bg-paper-50 py-10">
      <Container size="sm">
        <div className="mb-8 flex items-center justify-between">
          <Link to="/" className="inline-flex min-h-11 items-center text-lg font-semibold text-ink-950">
            FadeUp
          </Link>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="min-h-11 text-sm font-medium text-ink-500 underline underline-offset-2 hover:text-ink-950"
          >
            {t('application.signOut')}
          </button>
        </div>
        {children}
      </Container>
    </main>
  )
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Business name / submission date / status — shown in every state. */
function ApplicationFacts({ application }: { application: MyProfessionalApplication }) {
  const { t } = useTranslation('auth')
  const statusLabel =
    application.status === 'approved'
      ? t('application.statusApproved')
      : application.status === 'rejected'
        ? t('application.statusRejected')
        : t('application.statusPending')
  const statusVariant = application.status === 'approved' ? 'success' : application.status === 'rejected' ? 'danger' : 'warning'

  return (
    <dl className="mt-6 grid gap-3 border-t border-border pt-6 sm:grid-cols-3">
      <div>
        <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-500">
          <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
          {t('application.business')}
        </dt>
        <dd className="mt-1 text-sm font-medium text-ink-950">{application.businessName}</dd>
      </div>
      <div>
        <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-500">
          <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
          {t('application.submittedOn')}
        </dt>
        <dd className="mt-1 text-sm font-medium text-ink-950">{formatDate(application.submittedAt)}</dd>
      </div>
      <div>
        <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">{t('application.status')}</dt>
        <dd className="mt-1">
          <Badge variant={statusVariant}>{statusLabel}</Badge>
        </dd>
      </div>
    </dl>
  )
}

/**
 * The three-step review tracker.
 *
 * Deliberately NOT a percentage or a countdown: a human being reviews these,
 * and no honest number exists for "how far through reading your application
 * a person currently is". The middle step animates to show the request is
 * live and moving, which is a true statement; a "75% reviewed" bar would be
 * a fabricated one.
 */
function ReviewProgress({ status }: { status: 'pending_review' | 'approved' | 'rejected' }) {
  const { t } = useTranslation('auth')
  const decided = status !== 'pending_review'

  const steps = [
    { key: 'submitted', label: t('application.steps.submitted'), state: 'done' as const },
    {
      key: 'review',
      label: t('application.steps.review'),
      state: decided ? ('done' as const) : ('active' as const),
    },
    {
      key: 'decision',
      label: t('application.steps.decision'),
      state: decided ? ('done' as const) : ('todo' as const),
    },
  ]

  return (
    <ol className="mt-6 flex flex-col gap-0" aria-label={t('application.steps.review')}>
      {steps.map((step, index) => (
        <li key={step.key} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                step.state === 'done' && 'border-success-600 bg-success-600 text-paper-0',
                step.state === 'active' && 'border-accent-600 bg-accent-100 text-accent-700',
                step.state === 'todo' && 'border-border-strong bg-paper-0 text-ink-400',
              )}
            >
              {step.state === 'done' ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : step.state === 'active' ? (
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : (
                <Circle className="h-3 w-3" aria-hidden="true" />
              )}
            </span>
            {index < steps.length - 1 ? (
              <span
                className={cn(
                  'w-0.5 flex-1 min-h-8',
                  steps[index + 1].state === 'todo' ? 'bg-border-strong' : 'bg-success-600',
                )}
                aria-hidden="true"
              />
            ) : null}
          </div>
          <div className="pb-6 pt-1">
            <p
              className={cn(
                'text-sm font-medium',
                step.state === 'todo' ? 'text-ink-400' : 'text-ink-950',
              )}
            >
              {step.label}
            </p>
            {step.state === 'active' ? (
              <p className="text-xs text-accent-700">{t('application.inProgress')}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  )
}

function PendingState({ application }: { application: MyProfessionalApplication }) {
  const { t } = useTranslation('auth')
  const [editing, setEditing] = useState(false)

  return (
    <ApplicationShell>
      <Card elevated className="p-6 sm:p-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success-100">
          <Check className="h-6 w-6 text-success-700" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-ink-950">{t('application.pendingTitle')}</h1>
        <p className="mt-2 text-sm text-ink-700">{t('application.pendingLead')}</p>
        <p className="mt-1 text-sm text-ink-500">{t('application.pendingEmailNote')}</p>

        <ReviewProgress status="pending_review" />
        <ApplicationFacts application={application} />

        {editing ? (
          <ContactEditor application={application} onDone={() => setEditing(false)} />
        ) : (
          <Button variant="secondary" className="mt-6 w-full sm:w-auto" onClick={() => setEditing(true)}>
            {t('application.editContact')}
          </Button>
        )}
      </Card>
    </ApplicationShell>
  )
}

function ContactEditor({
  application,
  onDone,
}: {
  application: MyProfessionalApplication
  onDone: () => void
}) {
  const { t } = useTranslation('auth')
  const toast = useToast()
  const updateContact = useUpdateMyApplicationContact()
  const [error, setError] = useState<string | null>(null)

  const { register, handleSubmit } = useForm({
    defaultValues: {
      firstName: application.firstName,
      lastName: application.lastName,
      phone: application.phone,
    },
  })

  async function onSubmit(values: { firstName: string; lastName: string; phone: string }) {
    setError(null)
    try {
      await updateContact.mutateAsync({ id: application.id, ...values })
      toast.toast({ variant: 'success', title: t('application.contactSaved') })
      onDone()
    } catch (submitError) {
      setError(getErrorMessage(submitError) ?? 'Something went wrong.')
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="mt-6 flex flex-col gap-4 rounded-lg border border-border bg-paper-50 p-4">
      <div>
        <h2 className="text-sm font-semibold text-ink-950">{t('application.editContactTitle')}</h2>
        <p className="mt-0.5 text-xs text-ink-500">{t('application.editContactHint')}</p>
      </div>
      {error ? <Alert variant="error">{error}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={t('register.firstName')} {...register('firstName')} />
        <TextField label={t('register.lastName')} {...register('lastName')} />
      </div>
      <TextField label={t('register.phone')} type="tel" inputMode="tel" {...register('phone')} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" isLoading={updateContact.isPending}>
          {t('application.save')}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('application.cancel')}
        </Button>
      </div>
    </form>
  )
}

function ApprovedState({ application }: { application: MyProfessionalApplication }) {
  const { t } = useTranslation('auth')
  return (
    <ApplicationShell>
      <Card elevated className="p-6 sm:p-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success-100">
          <CircleCheckBig className="h-6 w-6 text-success-700" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-ink-950">{t('application.approvedTitle')}</h1>
        <p className="mt-2 text-sm text-ink-700">{t('application.approvedLead')}</p>

        <ReviewProgress status="approved" />
        <ApplicationFacts application={application} />

        <Link to="/app" className={buttonVariants({ variant: 'primary', size: 'lg' }, 'mt-6 w-full')}>
          {t('application.approvedCta')}
        </Link>
      </Card>
    </ApplicationShell>
  )
}

function RejectedState({ application }: { application: MyProfessionalApplication }) {
  const { t } = useTranslation('auth')
  return (
    <ApplicationShell>
      <Card elevated className="p-6 sm:p-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-paper-100">
          <CircleSlash className="h-6 w-6 text-ink-500" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-ink-950">{t('application.rejectedTitle')}</h1>
        <p className="mt-2 text-sm text-ink-700">{t('application.rejectedLead')}</p>

        {/*
          Only the reason a reviewer explicitly wrote for the applicant is
          ever rendered here. Internal assessment lives in a separate column
          that this page's query cannot even return.
        */}
        {application.rejectionReason ? (
          <div className="mt-4 rounded-lg border border-border bg-paper-50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
              {t('application.rejectedReasonLabel')}
            </p>
            <p className="mt-1 text-sm text-ink-800">{application.rejectionReason}</p>
          </div>
        ) : null}

        <ApplicationFacts application={application} />

        <a href="mailto:support@fadeup.app" className={buttonVariants({ variant: 'secondary' }, 'mt-6 w-full sm:w-auto')}>
          {t('application.rejectedContact')}
        </a>
      </Card>
    </ApplicationShell>
  )
}
