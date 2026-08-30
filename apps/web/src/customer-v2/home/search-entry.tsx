import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, X } from 'lucide-react'

/**
 * Home's search entry.
 *
 * ============================================================================
 * IT SEARCHES. THAT IS THE WHOLE POINT.
 * ============================================================================
 *
 * R5's Discover screen was, in its own shell's words, "a card containing a
 * button to Search, which was a dead end worth removing". A search affordance
 * on the first screen of a marketplace that only navigates somewhere else has
 * spent the customer's most valuable tap on a page transition.
 *
 * So this is a real input bound to `p_query` on `search_public_professionals`,
 * debounced by the page, narrowing the same list underneath it. What it is NOT
 * is the dedicated Search experience from blueprint C4 — no filters, no sort,
 * no map, no natural-language intent. Those are R5R.1B, and faking any of them
 * here would be inventing capability the backend does not have.
 *
 * ============================================================================
 * A LABEL, NOT JUST A PLACEHOLDER
 * ============================================================================
 *
 * The visible affordance is the icon and the placeholder; the accessible name
 * is a real `<label>`, visually hidden. Placeholder-as-label disappears the
 * moment someone types, which is exactly when a screen-reader user most needs
 * to know what field they are in.
 *
 * `type="search"` with `enterKeyHint="search"` so a phone keyboard offers the
 * right return key, and `autoComplete="off"` because a marketplace query is not
 * a stored credential.
 *
 * ============================================================================
 * ONE FOCUS RING, NOT TWO
 * ============================================================================
 *
 * The first pass carried `focus:border-v2-green` here on top of the shell's
 * global `:focus-visible` outline. Both are green, the outline sits 2px outside
 * the border, and the result was the stacked double ring the human review
 * called out — two concentric green lines around one field, which reads as a
 * rendering fault rather than as focus.
 *
 * The border colour change is gone. What remains is exactly one 2px outline at
 * 2px offset, in the same green at the same 5.25:1 every other control in the
 * product uses, which is both more restrained and more consistent. Nothing
 * about the VISIBILITY of focus is reduced — the ring is unchanged in weight,
 * colour and offset, it is simply no longer doubled.
 */
export function SearchEntry({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const { t } = useTranslation()
  const inputId = useId()

  return (
    <div className="relative">
      <label htmlFor={inputId} className="sr-only">
        {t('customer-app:v2.search.label')}
      </label>

      <Search
        className="pointer-events-none absolute start-3.5 top-1/2 h-[1.125rem] w-[1.125rem] -translate-y-1/2 text-v2-ink-mute"
        strokeWidth={1.8}
        aria-hidden="true"
      />

      <input
        id={inputId}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t('customer-app:v2.search.placeholder')}
        autoComplete="off"
        enterKeyHint="search"
        className="h-12 w-full rounded-v2-3 border border-v2-edge bg-v2-paper ps-11 pe-11 text-v2-body text-v2-ink placeholder:text-v2-ink-mute [&::-webkit-search-cancel-button]:appearance-none"
      />

      {value.length > 0 ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={t('customer-app:v2.search.clear')}
          className="v2-press absolute end-0.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-v2-2 text-v2-ink-soft hover:bg-v2-fill"
        >
          <X className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}
