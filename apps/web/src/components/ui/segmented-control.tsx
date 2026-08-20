import type { ReactNode } from 'react'
import { useId } from 'react'
import { cn } from '@/lib/cn'

/**
 * Two to four mutually exclusive choices, all visible at once.
 *
 * Distinct from Tabs: Tabs switch a *panel* and own a region of the page.
 * A segmented control is a FILTER on content that is already there —
 * Morning/Afternoon/Evening, Day/Week/Month. Using Tabs for those would put
 * `role="tabpanel"` semantics around content that does not change identity,
 * which reads wrong to a screen reader.
 *
 * Implemented as a radiogroup for exactly that reason, with roving arrow-key
 * navigation the browser gives us for free with real radio inputs.
 *
 * The moving indicator is one absolutely-positioned element translated by
 * transform, not a background swapped per segment: transform composites, and
 * animating background-color across four elements is the kind of thing that
 * makes a phone stutter mid-scroll.
 */

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'md',
  className,
}: {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  size?: 'sm' | 'md'
  className?: string
}) {
  const name = useId()
  const index = Math.max(0, options.findIndex((option) => option.value === value))

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'relative isolate inline-grid w-full rounded-lg border border-border bg-paper-100 p-1',
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-y-1 -z-10 rounded-md border border-accent-200 bg-paper-0 shadow-xs',
          'transition-transform duration-[--fu-duration-quick] ease-[--fu-ease-out] motion-reduce:transition-none',
        )}
        style={{
          width: `calc((100% - 0.5rem) / ${options.length})`,
          // insetInlineStart + translate keeps this correct under RTL, where a
          // left-based offset would slide the indicator the wrong way.
          // `--fu-dir` is defined in index.css (1 / -1); no inline fallback,
          // because a fallback here would silently hide the token going
          // missing and every RTL slide would go the wrong way unnoticed.
          insetInlineStart: '0.25rem',
          transform: `translateX(calc(var(--fu-dir) * ${index * 100}%))`,
        }}
      />
      {options.map((option) => {
        const selected = option.value === value
        return (
          <label
            key={option.value}
            className={cn(
              'relative flex cursor-pointer items-center justify-center gap-1.5 rounded-md font-medium transition-colors',
              'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent-700',
              size === 'sm' ? 'min-h-9 px-2 text-xs' : 'min-h-11 px-3 text-sm',
              selected ? 'text-ink-950' : 'text-ink-500 hover:text-ink-700',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.icon ? <span aria-hidden="true">{option.icon}</span> : null}
            <span className="truncate">{option.label}</span>
          </label>
        )
      })}
    </div>
  )
}
