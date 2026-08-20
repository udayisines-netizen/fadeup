import { forwardRef, useId, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string
  description?: string
  /** Visually hide the label (still exposed to assistive tech) — for dense contexts like a table cell where a column header already names the control. */
  hideLabel?: boolean
}

/**
 * Accessible on/off toggle, built on a native checkbox (real keyboard/AT
 * semantics for free) styled as a track + thumb, with `role="switch"` to
 * announce it correctly. No extra dependency — plain Tailwind, matching the
 * rest of the design system.
 */
export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch(
  { label, description, hideLabel = false, id, className, ...props },
  ref,
) {
  const generatedId = useId()
  const inputId = id ?? generatedId

  return (
    <label
      htmlFor={inputId}
      className={cn('flex min-h-11 cursor-pointer items-center gap-3', !hideLabel && 'justify-between')}
    >
      {hideLabel ? (
        <span className="sr-only">{label}</span>
      ) : (
        <span className="flex flex-col">
          <span className="text-sm font-medium text-ink-950">{label}</span>
          {description ? <span className="text-xs text-ink-500">{description}</span> : null}
        </span>
      )}
      <span className="relative inline-flex shrink-0 items-center">
        <input ref={ref} id={inputId} type="checkbox" role="switch" className={cn('peer sr-only', className)} {...props} />
        <span
          aria-hidden="true"
          className={cn(
            'h-6 w-11 rounded-full bg-paper-200 transition-colors',
            'peer-checked:bg-accent-600',
            'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-600',
            'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
          )}
        />
        <span
          aria-hidden="true"
          // The thumb sits at the inline START and travels toward the inline
          // END. `translateX` has no logical form, so the distance carries the
          // direction as a multiplier (--fu-dir, see index.css) — otherwise
          // the thumb starts on the right in Arabic and then slides further
          // right, straight off the track.
          className={cn(
            'pointer-events-none absolute start-0.5 top-0.5 h-5 w-5 rounded-full bg-paper-0 shadow-sm',
            'transition-transform peer-checked:translate-x-[calc(var(--fu-dir)*1.25rem)] motion-reduce:transition-none',
          )}
        />
      </span>
    </label>
  )
})
