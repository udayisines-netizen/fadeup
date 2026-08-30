import { useTranslation } from 'react-i18next'
import { TriangleAlert } from 'lucide-react'

/**
 * One shape for empty and failure, with one thing separating them.
 *
 * Extracted from Home's discovery section in R5R.1B, unchanged, because the
 * Marketplace has the same three truths to tell — nothing here, nothing
 * matched, could not load — and two visual dialects for the same situation
 * would be two design systems.
 *
 * Both say what happened, what is still true, and offer at most one action. No
 * dashed box and no generic illustration — DESIGN_SYSTEM.md asks an empty state
 * to explain what to do next, and a grey outline around the explanation adds
 * nothing to it. It sits on a plate for the same reason the lists do: the page
 * should still be made of something when it has nothing to list.
 *
 * What must NOT be shared is the reading: "nothing exists here" and "we could
 * not reach the server" are different situations and one of them is our fault.
 * `tone="failure"` earns a warning-toned marker and a filled recovery button;
 * `tone="empty"` stays quiet, because there is nothing to recover from. The
 * filled button is INK, not green — green in this product means an action that
 * books a haircut, and "Try again" is not one.
 *
 * The title is a real `h2`, at the same level as a section heading, so a
 * screen-reader user navigating by heading finds the page's content region
 * whether it succeeded or failed.
 */
export function Notice({
  tone,
  title,
  body,
  actionLabel,
  onAction,
}: {
  tone: 'empty' | 'failure'
  title: string
  body: string
  actionLabel: string | null
  onAction: (() => void) | null
}) {
  const { t } = useTranslation()
  const failed = tone === 'failure'

  return (
    <div className="v2-plate px-5 py-10 md:px-6 md:py-14">
      {failed ? (
        <p className="mb-2 flex items-center gap-1.5 text-v2-caption font-semibold uppercase tracking-[0.08em] text-v2-alert">
          <TriangleAlert className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          {t('customer-app:v2.discovery.errorEyebrow')}
        </p>
      ) : null}

      <h2 className="text-v2-lead font-semibold text-v2-ink">{title}</h2>
      <p className="mt-1.5 max-w-md text-v2-body text-v2-ink-soft">{body}</p>

      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className={
            failed
              ? 'v2-press mt-4 inline-flex h-11 items-center rounded-v2-2 bg-v2-ink px-4 text-v2-meta font-semibold text-v2-paper hover:bg-v2-ink/90'
              : 'v2-press mt-4 inline-flex h-11 items-center rounded-v2-2 border border-v2-edge bg-v2-paper px-4 text-v2-meta font-semibold text-v2-ink hover:bg-v2-fill'
          }
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}
