import { useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import { IconChevronDown } from '@/shared/ui/icons'

export interface ComboboxOption {
  value: string
  label: string
}

export interface ComboboxProps {
  label: string
  options: ComboboxOption[]
  value: string | null
  onValueChange: (value: string | null) => void
  placeholder?: string
  hint?: string
  error?: string
  className?: string
  ref?: React.Ref<HTMLInputElement>
}

/**
 * Motif ARIA combobox (liste filtrée au clavier) sur un input natif —
 * navigation flèches, Entrée sélectionne, Échap ferme, aria-activedescendant.
 */
export function Combobox({ label, options, value, onValueChange, placeholder, hint, error, className, ref }: ComboboxProps) {
  const { t } = useTranslation('v2')
  const id = useId()
  const listboxId = `${id}-listbox`
  const describedById = `${id}-described`
  const described = error ?? hint

  const selected = options.find((option) => option.value === value) ?? null
  const [query, setQuery] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const blurTimer = useRef<number | null>(null)

  const text = query ?? selected?.label ?? ''
  const filtered = useMemo(() => {
    if (!query) return options
    const needle = query.toLocaleLowerCase()
    return options.filter((option) => option.label.toLocaleLowerCase().includes(needle))
  }, [options, query])

  const commit = (option: ComboboxOption) => {
    onValueChange(option.value)
    setQuery(null)
    setOpen(false)
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((index) => Math.min(index + 1, filtered.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      const option = filtered[activeIndex]
      if (open && option) {
        event.preventDefault()
        commit(option)
      }
    } else if (event.key === 'Escape') {
      setOpen(false)
      setQuery(null)
    }
  }

  return (
    <div className={cn('relative flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-fu-sm font-medium text-[var(--fu-text-primary)]">
        {label}
      </label>
      <div
        className={cn(
          'flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border bg-[var(--fu-surface)] px-3',
          'focus-within:ring-2 focus-within:ring-[var(--fu-focus)] focus-within:ring-offset-2 focus-within:ring-offset-[var(--fu-canvas)]',
          error ? 'border-[var(--fu-danger)]' : 'border-[var(--fu-border-strong)]',
        )}
      >
        <input
          ref={ref}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={open && filtered[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
          aria-autocomplete="list"
          aria-invalid={error ? true : undefined}
          aria-describedby={described ? describedById : undefined}
          autoComplete="off"
          value={text}
          placeholder={placeholder}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
            setActiveIndex(0)
            if (event.target.value === '') onValueChange(null)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            blurTimer.current = window.setTimeout(() => {
              setOpen(false)
              setQuery(null)
            }, 120)
          }}
          onKeyDown={handleKeyDown}
          className="min-w-0 flex-1 bg-transparent text-fu-base text-[var(--fu-text-primary)] outline-none placeholder:text-[var(--fu-text-secondary)]"
        />
        <IconChevronDown aria-hidden="true" className="size-4 shrink-0 text-[var(--fu-text-secondary)]" />
      </div>
      <ul
        id={listboxId}
        role="listbox"
        aria-label={label}
        className={cn(
          'absolute top-full z-[var(--fu-z-overlay)] mt-1 max-h-60 w-full overflow-y-auto rounded-[var(--radius-card)] border border-[var(--fu-border)] bg-[var(--fu-surface)] p-1',
          !open && 'hidden',
        )}
      >
        {filtered.length === 0 ? (
          <li role="presentation" className="px-2.5 py-2 text-fu-sm text-[var(--fu-text-secondary)]">
            {t('empty.generic.title')}
          </li>
        ) : (
          filtered.map((option, index) => (
            <li
              key={option.value}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={option.value === value}
              onMouseDown={(event) => {
                event.preventDefault()
                if (blurTimer.current !== null) window.clearTimeout(blurTimer.current)
                commit(option)
              }}
              onMouseEnter={() => setActiveIndex(index)}
              className={cn(
                'flex min-h-10 cursor-default items-center rounded-[var(--radius-control)] px-2.5 text-fu-sm text-[var(--fu-text-primary)]',
                index === activeIndex && 'bg-[var(--fu-surface-subtle)]',
              )}
            >
              {option.label}
            </li>
          ))
        )}
      </ul>
      {described && (
        <p id={describedById} className={cn('text-fu-sm', error ? 'text-[var(--fu-danger)]' : 'text-[var(--fu-text-secondary)]')}>
          {described}
        </p>
      )}
    </div>
  )
}
