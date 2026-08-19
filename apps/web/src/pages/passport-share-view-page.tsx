import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useSharedPassport } from '@/lib/queries/passport'
import { Container } from '@/components/ui/container'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { PageSpinner } from '@/components/ui/spinner'
import { useDocumentMeta } from '@/lib/use-document-meta'

/**
 * "/passport/shared/:token" — the read-only view a barber opens from a
 * customer's "Share my fade" QR/link. Unauthenticated by design; the token
 * itself is the authorization, verified server-side by hash (see
 * get_shared_passport). Deliberately marked noindex: a Passport must never
 * become indexable public content even while a share is live.
 */
export function PassportShareViewPage() {
  const { t } = useTranslation('passport')
  const { token } = useParams<{ token: string }>()
  const sharedQuery = useSharedPassport(token)

  const name = sharedQuery.data?.displayName ?? null

  useDocumentMeta({
    title: name ? t('sharedTitle', { name }) : t('title'),
    description: t('sharedSubtitle'),
    noIndex: true,
  })

  if (sharedQuery.isPending) {
    return <PageSpinner label={t('common:state.loadingEllipsis')} />
  }

  if (sharedQuery.isError) {
    return (
      <Container size="sm" className="py-16">
        <ErrorState title={t('errorTitle')} description={sharedQuery.error.message} />
      </Container>
    )
  }

  const shared = sharedQuery.data

  if (shared.status !== 'active') {
    const copy =
      shared.status === 'expired'
        ? { title: t('sharedExpiredTitle'), description: t('sharedExpiredDescription') }
        : shared.status === 'revoked'
          ? { title: t('sharedRevokedTitle'), description: t('sharedRevokedDescription') }
          : { title: t('sharedNotFoundTitle'), description: t('sharedNotFoundDescription') }

    return (
      <Container size="sm" className="py-16">
        <EmptyState
          title={copy.title}
          description={copy.description}
          action={
            <Link to="/" className={buttonVariants({ variant: 'secondary' })}>
              {t('customer-app:shareView.goToFadeup')}
            </Link>
          }
        />
      </Container>
    )
  }

  return (
    <Container size="sm" className="flex flex-col gap-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-balance text-ink-950">
          {name ? t('sharedTitle', { name }) : t('title')}
        </h1>
        <div className="mt-2 flex items-center gap-2">
          <Badge variant="accent">{t('sharedSubtitle')}</Badge>
        </div>
      </div>

      <Card className="p-5">
        <dl className="flex flex-col gap-2 text-sm">
          <SharedRow label={t('usualHaircut')} value={shared.usualHaircut} notSet={t('notSet')} />
          <SharedRow label={t('fadeType')} value={shared.fadeType} notSet={t('notSet')} />
          <SharedRow label={t('sideLength')} value={shared.sideLength} notSet={t('notSet')} />
          <SharedRow label={t('topLength')} value={shared.topLength} notSet={t('notSet')} />
          <SharedRow label={t('beardPreferences')} value={shared.beardPreferences} notSet={t('notSet')} />
          <SharedRow label={t('preferencesNotes')} value={shared.preferencesNotes} notSet={t('notSet')} />
        </dl>
      </Card>
    </Container>
  )
}

function SharedRow({ label, value, notSet }: { label: string; value: string | null; notSet: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-ink-500">{label}</dt>
      <dd className={value ? 'text-right font-medium text-ink-950' : 'text-right text-ink-300'}>{value || notSet}</dd>
    </div>
  )
}
