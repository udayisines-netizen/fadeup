import { forwardRef, useId, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
  error?: string
  hint?: string
}

/** Multi-line counterpart to `TextField` — same label/hint/error contract. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, hint, id, className, rows = 3, ...props },
  ref,
) {
  const generatedId = useId()
  const textareaId = id ?? generatedId
  const hintId = hint ? `${textareaId}-hint` : undefined
  const errorId = error ? `${textareaId}-error` : undefined

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={textareaId} className="text-sm font-medium text-ink-950">
        {label}
      </label>
      <textarea
        ref={ref}
        id={textareaId}
        rows={rows}
        aria-invalid={Boolean(error)}
        aria-describedby={cn(hintId, errorId) || undefined}
        className={cn(
          'resize-y rounded-md border border-border-strong bg-paper-0 px-3 py-2 text-sm text-ink-950',
          'placeholder:text-ink-300',
          'disabled:cursor-not-allowed disabled:border-border disabled:bg-paper-100 disabled:text-ink-300',
          error && 'border-danger-600',
          className,
        )}
        {...props}
      />
      {hint && !error ? (
        <p id={hintId} className="text-xs text-ink-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-danger-600">
          {error}
        </p>
      ) : null}
    </div>
  )
})
