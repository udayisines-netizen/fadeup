import { useTranslation } from 'react-i18next'
import { QrCode } from '@/shared/ui/QrCode'

/**
 * L'affiche A5 collée au mur du salon : logo, nom, phrase d'instruction, QR.
 * Partagée entre /dashboard/queue/qr et l'installation (deux features — donc
 * shared/ui, jamais un import croisé).
 *
 * L'impression isole `#fu-qr-poster` par visibilité : tout le reste de
 * l'écran disparaît, la page est déclarée A5. Encre sur blanc, toujours —
 * une affiche n'est pas thémée.
 */

export interface QueueQrPosterProps {
  organizationName: string
  /** URL /q/:slug?l=…&t=… — celle que `buildQueueLink` produit. */
  link: string
}

export function QueueQrPoster({ organizationName, link }: QueueQrPosterProps) {
  const { t } = useTranslation('v2')

  return (
    <>
      <style>{`
        @media print {
          @page { size: A5 portrait; margin: 12mm; }
          body * { visibility: hidden; }
          #fu-qr-poster, #fu-qr-poster * { visibility: visible; }
          #fu-qr-poster {
            position: fixed;
            inset-block-start: 0;
            inset-inline-start: 0;
            inline-size: 100%;
            box-shadow: none;
            border: none;
          }
        }
      `}</style>
      <div
        id="fu-qr-poster"
        className="fu-poster mx-auto flex w-full max-w-sm flex-col items-center gap-4 rounded-[var(--radius-card)] border border-[var(--fu-border)] p-8 text-center"
      >
        <img src="/brand/fadeup-mark-primary.png" alt="" aria-hidden="true" className="size-12" />
        <p className="text-fu-xl font-semibold">{organizationName}</p>
        <p className="text-fu-base">{t('queue.poster.instruction')}</p>
        <QrCode value={link} label={t('queue.poster.qrLabel', { organization: organizationName })} className="w-full max-w-64" />
        <p className="fu-poster-muted font-fu-mono text-fu-xs">{t('queue.poster.footer')}</p>
      </div>
    </>
  )
}
