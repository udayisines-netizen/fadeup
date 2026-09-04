import { useId } from 'react'
import { cn } from '@/shared/lib/cn'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** OBLIGATOIRE et rendu visuellement — jamais réduit à un aria-label. */
  label: string
  hint?: string
  error?: string
  iconStart?: React.ReactNode
  suffix?: React.ReactNode
  ref?: React.Ref<HTMLInputElement>
}

export function Input({ label, hint, error, iconStart, suffix, className, id, ref, ...rest }: InputProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const describedById = `${inputId}-described`
  // `error` replaces `hint` — never both at once.
  const described = error ?? hint

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className="text-fu-sm font-medium text-[var(--fu-text-primary)]">
        {label}
      </label>
      <div
        className={cn(
          'flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border bg-[var(--fu-surface)] px-3',
          'transition-colors duration-[var(--fu-dur-instant)] ease-[var(--fu-ease)]',
          'focus-within:ring-2 focus-within:ring-[var(--fu-focus)] focus-within:ring-offset-2 focus-within:ring-offset-[var(--fu-canvas)]',
          error ? 'border-[var(--fu-danger)]' : 'border-[var(--fu-border-strong)]',
        )}
      >
        {iconStart != null && (
          <span aria-hidden="true" className="inline-flex shrink-0 text-[var(--fu-text-secondary)] [&>svg]:size-4">
            {iconStart}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={described ? describedById : undefined}
          className="min-w-0 flex-1 bg-transparent text-fu-base text-[var(--fu-text-primary)] outline-none placeholder:text-[var(--fu-text-secondary)]"
          {...rest}
        />
        {suffix != null && <span className="inline-flex shrink-0 items-center text-[var(--fu-text-secondary)]">{suffix}</span>}
      </div>
      {described && (
        <p
          id={describedById}
          className={cn('text-fu-sm', error ? 'text-[var(--fu-danger)]' : 'text-[var(--fu-text-secondary)]')}
        >
          {described}
        </p>
      )}
    </div>
  )
}
