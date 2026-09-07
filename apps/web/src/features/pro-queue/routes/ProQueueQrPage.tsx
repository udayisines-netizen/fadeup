import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useProOrganization } from '@/shared/data/organization'
import { Button } from '@/shared/ui/Button'
import { Dialog } from '@/shared/ui/Dialog'
import { EmptyState } from '@/shared/ui/EmptyState'
import { QueueQrPoster } from '@/shared/ui/QueueQrPoster'
import { SkeletonRow } from '@/shared/ui/Skeleton'
import { useToast } from '@/shared/ui/Toast'
import { IconBack } from '@/shared/ui/icons'
import { useQueueCheckIn, useRegenerateCheckInToken } from '@/features/pro-queue/api/proQueue'
import { buildQueueLink } from '@/shared/lib/queueLink'

/**
 * /dashboard/queue/qr — le QR du salon, en grand pour être scanné depuis
 * l'écran, imprimable en A5 pour être collé au mur, régénérable si le patron
 * pense qu'il circule (chaque copie imprimée devient alors invalide — la RPC
 * le réserve à owner/manager, la réceptionniste ne fait qu'afficher).
 */
export function ProQueueQrPage() {
  const { t } = useTranslation('v2')
  const { toast } = useToast()
  const { organization, loading } = useProOrganization()

  // Même résolution de lieu que l'écran file : le premier lieu physique.
  const location = (organization?.locations ?? []).find((row) => row.kind === 'physical_address') ?? null
  const locationId = location?.id ?? null

  const checkIn = useQueueCheckIn(locationId)
  const regenerate = useRegenerateCheckInToken(locationId)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const link = useMemo(() => {
    if (!organization || !locationId || !checkIn.data?.queue_check_in_token) return null
    return buildQueueLink(window.location.origin, organization.slug, locationId, checkIn.data.queue_check_in_token)
  }, [organization, locationId, checkIn.data?.queue_check_in_token])

  if (loading || (locationId && checkIn.isPending)) {
    return (
      <div className="p-4">
        <SkeletonRow />
      </div>
    )
  }

  if (!organization || !locationId || checkIn.isError || !checkIn.data) {
    // Rôle sans autorité sur les seuils (barber) ou lieu absent : état
    // honnête, pas un écran qui fait semblant.
    return (
      <div className="p-4">
        <EmptyState
          title={t('queue.qr.unavailable.title')}
          description={t('queue.qr.unavailable.description')}
          action={
            <Link to="/dashboard/queue" className="text-fu-sm font-medium text-[var(--fu-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]">
              {t('common.action.back')}
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 p-4">
      <Link
        to="/dashboard/queue"
        className="inline-flex min-h-11 items-center gap-1.5 self-start text-fu-sm font-medium text-[var(--fu-text-secondary)] hover:text-[var(--fu-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]"
      >
        <IconBack aria-hidden="true" className="size-4 rtl:-scale-x-100" />
        {t('queue.qr.backToQueue')}
      </Link>

      <header>
        <h1 className="text-fu-xl font-semibold">{t('queue.qr.title')}</h1>
        <p className="mt-1 text-fu-sm text-[var(--fu-text-secondary)]">{t('queue.qr.description')}</p>
      </header>

      {link && <QueueQrPoster organizationName={organization.name} link={link} />}

      <div className="flex flex-col gap-2">
        <Button variant="primary" onClick={() => window.print()}>
          {t('queue.qr.print')}
        </Button>
        <Button variant="destructive" loading={regenerate.isPending} onClick={() => setConfirmOpen(true)}>
          {t('queue.qr.regenerate')}
        </Button>
        <p className="text-fu-xs text-[var(--fu-text-secondary)]">{t('queue.qr.regenerateHint')}</p>
      </div>

      <Dialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('queue.qr.confirm.title')}
        description={t('queue.qr.confirm.description')}
      >
        <div className="flex flex-col gap-2">
          <Button
            variant="destructive"
            loading={regenerate.isPending}
            onClick={() => {
              regenerate.mutate(undefined, {
                onSuccess: () => {
                  setConfirmOpen(false)
                  toast({ title: t('queue.qr.confirm.done'), tone: 'success' })
                },
                onError: () => toast({ title: t('errors.data.unknown'), tone: 'error' }),
              })
            }}
          >
            {t('queue.qr.confirm.action')}
          </Button>
          <Button variant="tertiary" onClick={() => setConfirmOpen(false)}>
            {t('common.action.cancel')}
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
