import { useTranslation } from 'react-i18next'
import { Avatar } from '@/components/ui/avatar'
import { FadeUpMark } from '@/components/brand/fadeup-mark'
import { cn } from '@/lib/cn'

/**
 * ============================================================================
 * THE FADE PASSPORT, AS A CARD
 * ============================================================================
 *
 * §18: Apple Wallet premium, plus a social identity card. Membership, identity,
 * status — without becoming flashy.
 *
 * WHY THIS EXISTS AT ALL, WHEN THE PAGE BELOW IT ALREADY WORKED
 *
 * The passport was a form and a list of `dt`/`dd` pairs. That is a perfectly
 * good editor for grooming preferences and it is not an identity artefact: it
 * looks like the settings screen it sits next to, so nothing about it says
 * "this is yours, and it means something". The card is the object; the form
 * underneath is how you change what is on it.
 *
 * WHAT IS ON IT IS ONLY WHAT IS TRUE
 *
 * The customer's own name and avatar, the FadeUp mark, and the two or three
 * preferences they actually filled in. There is no tier, no points balance, no
 * "member since" — FadeUp has no loyalty tiers, no points and no membership
 * start date to draw on, and a card is exactly the surface where an invented
 * status reads as a promise. A passport with nothing filled in yet renders as
 * a card with nothing filled in yet, which is honest and still looks like it
 * belongs to somebody.
 *
 * THERE IS NO "GET YOUR FADE PASSPORT" CTA, on this card or anywhere else.
 * §18: every customer already has one. A button offering to create the thing
 * you already have is a dark pattern in miniature — it manufactures an action
 * out of a state.
 */
export function PassportCard({
  name,
  avatarUrl,
  entries,
  className,
}: {
  name: string
  avatarUrl?: string | null
  /** The preferences this customer has actually set. Empty is a real state. */
  entries: Array<{ key: string; label: string; value: string }>
  className?: string
}) {
  const { t } = useTranslation('passport')

  return (
    <section
      aria-label={t('title')}
      className={cn(
        // The one deliberately "material" surface in the customer product.
        // A soft top-lit gradient over the accent tint, a real border, and a
        // single elevation — enough to read as an object rather than a panel,
        // short of the glassmorphism the brand charter rejects.
        'relative overflow-hidden rounded-2xl border border-accent-200 shadow-sm',
        'bg-gradient-to-br from-accent-100 via-paper-0 to-paper-100',
        className,
      )}
    >
      {/* A single soft highlight along the top edge. Decorative, and the only
          decoration on the card. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-paper-0/70 to-transparent"
      />

      <div className="relative flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={name} src={avatarUrl} size="lg" className="ring-2 ring-paper-0" />
            <div className="min-w-0">
              <p className="truncate text-heading text-ink-950">{name}</p>
              <p className="text-label uppercase text-accent-700">{t('title')}</p>
            </div>
          </div>
          <FadeUpMark className="h-7 w-auto shrink-0" />
        </div>

        {entries.length > 0 ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            {entries.map((entry) => (
              <div key={entry.key} className="min-w-0">
                <dt className="text-label uppercase text-ink-500">{entry.label}</dt>
                <dd className="mt-0.5 truncate text-sm font-medium text-ink-950">{entry.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          // Not an empty state with a call to action — the passport already
          // exists. A line explaining what filling it in gets you, and the
          // form is directly below.
          <p className="text-pretty text-sm text-ink-700">{t('cardEmptyHint')}</p>
        )}
      </div>
    </section>
  )
}
