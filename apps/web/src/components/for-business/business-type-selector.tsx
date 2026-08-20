import { useTranslation } from 'react-i18next'
import { useBusinessMode } from '@/components/for-business/business-mode'
import { BUSINESS_MODES, type BusinessMode } from '@/lib/commerce/plans'
import { cn } from '@/lib/cn'

/**
 * The business-type control, at the top of Pricing.
 *
 * Same state, same consequence: this writes to the exact `setMode` that the
 * previous carousel wrote to, so every downstream behaviour (which plans are
 * offered, which prices resolve, what the CTA carries into
 * `/pro/register?plan=`) is untouched. Only the control itself is new.
 *
 * It is a segmented selector rather than a carousel because the question moved.
 * At the top of the page it was a gate a visitor had to pass before seeing
 * anything, and stepping through three states one arrow at a time was fine for
 * browsing. Here it is a decision made once, at the moment of comparing prices,
 * and all three options must be visible and comparable at a glance. Hiding two
 * thirds of the answer behind a next arrow is the wrong shape for that.
 *
 * Each option carries one short clarification, because "Independent" and
 * "Barbershop" are not self-evident to someone deciding which one they are.
 *
 * Semantics: a radiogroup, not a tablist. These buttons do not reveal
 * associated panels, they set a value that changes content elsewhere on the
 * page, which is what a radio group describes. Arrow-key roving focus comes
 * free from the native buttons plus `aria-checked`.
 */
export function BusinessTypeSelector({ className }: { className?: string }) {
  const { t } = useTranslation('landing')
  const { mode, setMode } = useBusinessMode()

  return (
    <div className={className}>
      {/*
        A filter, not an onboarding step. This was three tall cards with a
        heading above them, which is a lot of furniture for a control whose
        entire job is to decide which prices to show. It is now one compact
        rail: three labels, and the clarification appears only for the option
        actually chosen, where it is useful and where it costs no height.
      */}
      <div
        role="radiogroup"
        aria-label={t('business.pricing.typeLabel')}
        className="pro-glass mx-auto grid w-full grid-cols-3 gap-1 p-1"
      >
        {BUSINESS_MODES.map((option: BusinessMode) => {
          const selected = option === mode
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setMode(option)}
              className={cn(
                'min-h-11 rounded-[var(--pro-r-control)] px-3 text-sm font-medium transition-colors duration-200',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pro-highlight)]',
                selected
                  ? 'bg-[color-mix(in_srgb,var(--pro-emerald)_20%,transparent)] text-[var(--pro-text)]'
                  : 'text-[var(--pro-muted)] hover:text-[var(--pro-text)]',
              )}
            >
              {t(`business.pricing.types.${option}.label`)}
            </button>
          )
        })}
      </div>

      <p className="mt-3 text-center text-sm text-[var(--pro-faint)]">
        {t(`business.pricing.types.${mode}.hint`)}
      </p>
    </div>
  )
}
