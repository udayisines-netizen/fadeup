import { useId } from 'react'
import { cn } from '@/shared/lib/cn'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Obligatoire et visible, comme sur Input. */
  label: string
  hint?: string
  error?: string
  ref?: React.Ref<HTMLTextAreaElement>
}

export function Textarea({ label, hint, error, className, id, ref, ...rest }: TextareaProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const describedById = `${inputId}-described`
  const described = error ?? hint

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className="text-fu-sm font-medium text-[var(--fu-text-primary)]">
        {label}
      </label>
      <textarea
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={described ? describedById : undefined}
        className={cn(
          'min-h-24 rounded-[var(--radius-control)] border bg-[var(--fu-surface)] px-3 py-2.5',
          'text-fu-base text-[var(--fu-text-primary)] outline-none placeholder:text-[var(--fu-text-secondary)]',
          'focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--fu-canvas)]',
          error ? 'border-[var(--fu-danger)]' : 'border-[var(--fu-border-strong)]',
        )}
        {...rest}
      />
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
