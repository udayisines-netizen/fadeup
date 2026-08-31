import { useTranslation } from 'react-i18next'
import loadingMark from '@/assets/brand/fadeup-loading-mark.svg'

/**
 * The global FadeUp loading experience (Design Pass A §1, asset-backed in
 * Design Pass A.1 §2).
 *
 * LIGHT, by direction: near-white canvas, the REAL brand asset
 * (`assets/brand/fadeup-loading-mark.svg` — the canonical F geometry from
 * `components/brand/fadeup-mark.tsx`, carrying its own segment-sequence
 * animation and its own reduced-motion static state), and the dark wordmark
 * as HTML text so it stays crisp. No spinner, no percentage, no fake
 * progress, no black splash.
 *
 * The same asset family (`fadeup-mark.svg`, `fadeup-loading-lockup.svg`)
 * serves future PWA/startup imagery — one geometry, everywhere.
 *
 * USED ONLY for bootstrap-class waits — the router's lazy-branch hydration.
 * Ordinary query refetches render skeletons, never this.
 */
export function V2Splash() {
  const { t } = useTranslation()

  return (
    <div
      data-fu-v2
      role="status"
      aria-label={t('common:loading')}
      className="flex min-h-svh flex-col items-center justify-center gap-4 bg-v2-ground"
    >
      <img src={loadingMark} alt="" className="h-14 w-14" />
      <p className="text-v2-title font-semibold tracking-[-0.01em] text-v2-ink">FadeUp</p>
    </div>
  )
}
