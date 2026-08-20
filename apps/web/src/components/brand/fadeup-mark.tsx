/**
 * The FadeUp brand mark and wordmark.
 *
 * Built from the written brand charter — "fluid F mark, emerald → mint;
 * white wordmark on dark, night wordmark on light" — because no vector logo
 * file ships in this repository. `public/favicon.svg` is NOT the brand: it is
 * purple/cyan (#863bff / #7e14ff / #47bfff) and predates the charter, so it is
 * deliberately not used as a source here.
 *
 * If an official logo asset is added later, replace the paths in `FadeUpMark`
 * and nothing else has to change — every caller goes through these two
 * components.
 *
 * The F is drawn as one stem plus two arms whose right-hand terminals sweep
 * rather than cut square. That sweep is the page's motion vocabulary in static
 * form: the same left-to-right flow the product film uses for a customer
 * moving through the shop.
 */

export function FadeUpMark({ className, title }: { className?: string; title?: string }) {
  // Unique per instance so two marks on one page cannot share a gradient id.
  const gradientId = `fadeup-mark-${Math.random().toString(36).slice(2, 9)}`

  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gradientId} x1="6" y1="42" x2="42" y2="6" gradientUnits="userSpaceOnUse">
          <stop stopColor="#17A36A" />
          <stop offset="1" stopColor="#3DDAA2" />
        </linearGradient>
      </defs>

      {/* Stem — the constant the arms flow out of. */}
      <path d="M8 12a6 6 0 0 1 6-6h6v36a6 6 0 0 1-12 0V12Z" fill={`url(#${gradientId})`} />

      {/* Top arm — the long sweep. Its terminal curves out and back, so the
          shape reads as movement leaving the mark rather than a cut edge. */}
      <path
        d="M20 6h14c5 0 8 2.4 8 6s-3 6-8 6H20V6Z"
        fill={`url(#${gradientId})`}
      />

      {/* Mid arm — shorter, same gesture, establishing the rhythm. */}
      <path
        d="M20 21h9c4.4 0 7 2.2 7 5.5S33.4 32 29 32h-9V21Z"
        fill={`url(#${gradientId})`}
        opacity="0.86"
      />
    </svg>
  )
}

/**
 * Mark + wordmark lockup.
 *
 * `tone` follows the charter's two approved treatments: white wordmark on a
 * dark ground, night wordmark on a light one. The mark itself keeps its
 * emerald→mint gradient in both.
 */
export function FadeUpLockup({
  className,
  tone = 'dark',
}: {
  className?: string
  /** `dark` = placed ON a dark surface (white wordmark). */
  tone?: 'dark' | 'light'
}) {
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5em' }}>
      <FadeUpMark className="h-[1.05em] w-[1.05em]" />
      <span
        style={{
          fontWeight: 600,
          letterSpacing: '-0.02em',
          color: tone === 'dark' ? '#F4F6F8' : '#0B1320',
        }}
      >
        FadeUp
      </span>
    </span>
  )
}
