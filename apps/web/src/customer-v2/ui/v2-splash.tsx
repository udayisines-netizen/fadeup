import { useTranslation } from 'react-i18next'

/**
 * The global FadeUp loading experience (Design Pass A §1).
 *
 * LIGHT, by direction: near-white canvas, the brand F mark, the wordmark, and
 * one animation — the mark's three real segments (stem, top arm, mid arm,
 * exactly the geometry `components/brand/fadeup-mark.tsx` defines) arriving
 * in sequence on a ~1s cycle. No spinner, no percentage, no fake progress,
 * no barber pole, no black/gold.
 *
 * The paths are inlined rather than imported because the animation is
 * per-segment: each carries its own delay, which a single composed <FadeUpMark>
 * cannot express. If the official logo asset ever replaces the drawn mark,
 * this file changes with fadeup-mark.tsx.
 *
 * USED ONLY for bootstrap-class waits — the router's lazy-branch hydration.
 * Ordinary query refetches render skeletons, never this.
 *
 * Reduced motion: the CSS swaps the sequence for a static mark with a subtle
 * opacity breath (see customer-v2.css).
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
      <svg viewBox="0 0 48 48" className="h-14 w-14" fill="none" aria-hidden="true">
        <defs>
          <linearGradient
            id="v2-splash-grad"
            x1="6"
            y1="42"
            x2="42"
            y2="6"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#17A36A" />
            <stop offset="1" stopColor="#3DDAA2" />
          </linearGradient>
        </defs>
        {/* Stem */}
        <path
          d="M8 12a6 6 0 0 1 6-6h6v36a6 6 0 0 1-12 0V12Z"
          fill="url(#v2-splash-grad)"
          className="v2-splash-seg"
        />
        {/* Top arm */}
        <path
          d="M20 6h14c5 0 8 2.4 8 6s-3 6-8 6H20V6Z"
          fill="url(#v2-splash-grad)"
          className="v2-splash-seg"
          style={{ animationDelay: '140ms' }}
        />
        {/* Mid arm */}
        <path
          d="M20 21h9c4.4 0 7 2.2 7 5.5S33.4 32 29 32h-9V21Z"
          fill="url(#v2-splash-grad)"
          opacity="0.86"
          className="v2-splash-seg"
          style={{ animationDelay: '280ms' }}
        />
      </svg>

      <p className="text-v2-title font-semibold tracking-[-0.01em] text-v2-ink">FadeUp</p>
    </div>
  )
}
