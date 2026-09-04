import { useId } from 'react'
import { cn } from '@/shared/lib/cn'

export interface SegmentedOption {
  value: string
  label: string
}

export interface SegmentedControlProps {
  /** Nom accessible du groupe. */
  label: string
  options: SegmentedOption[]
  value: string
  onValueChange: (value: string) => void
  className?: string
}

/**
 * Bascule exclusive compacte (liste/carte, jour/semaine). Sémantique de
 * groupe radio : flèches pour naviguer, un seul tabstop.
 */
export function SegmentedControl({ label, options, value, onValueChange, className }: SegmentedControlProps) {
  const groupId = useId()

  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % options.length
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + options.length) % options.length
    if (nextIndex !== null) {
      event.preventDefault()
      const option = options[nextIndex]
      if (option) {
        onValueChange(option.value)
        document.getElementById(`${groupId}-${nextIndex}`)?.focus()
      }
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex rounded-[var(--radius-control)] border border-[var(--fu-border-strong)] p-0.5', className)}
    >
      {options.map((option, index) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            id={`${groupId}-${index}`}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onValueChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              'min-h-10 rounded-[calc(var(--radius-control)-2px)] px-3 text-fu-sm font-medium md:min-h-8',
              'transition-colors duration-[var(--fu-dur-instant)] ease-[var(--fu-ease)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]',
              selected
                ? 'bg-[var(--fu-text-primary)] text-[var(--fu-canvas)]'
                : 'text-[var(--fu-text-secondary)] hover:bg-[var(--fu-surface-subtle)]',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
