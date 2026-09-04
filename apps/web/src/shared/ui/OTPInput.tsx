import { useRef } from 'react'
import { cn } from '@/shared/lib/cn'

export interface OTPInputProps {
  /** Libellé visible du groupe. */
  label: string
  value: string
  onValueChange: (value: string) => void
  /** Appelé quand les six chiffres sont saisis. */
  onComplete?: (value: string) => void
  error?: string
  disabled?: boolean
  autoFocus?: boolean
  className?: string
}

const LENGTH = 6

/**
 * Six cases, collage intelligent (un code collé remplit tout), autofocus,
 * `autocomplete="one-time-code"` pour l'auto-remplissage iOS/Android.
 * Sert au lien magique / OTP de P2.
 */
export function OTPInput({ label, value, onValueChange, onComplete, error, disabled, autoFocus, className }: OTPInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([])

  const apply = (next: string) => {
    const digits = next.replace(/\D/g, '').slice(0, LENGTH)
    onValueChange(digits)
    if (digits.length === LENGTH) onComplete?.(digits)
    const focusIndex = Math.min(digits.length, LENGTH - 1)
    refs.current[focusIndex]?.focus()
  }

  const handleChange = (index: number, char: string) => {
    const digits = value.split('')
    if (char === '') {
      digits.splice(index, 1)
    } else {
      digits[index] = char.slice(-1)
    }
    apply(digits.join(''))
  }

  const handleKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !event.currentTarget.value && index > 0) {
      event.preventDefault()
      apply(value.slice(0, index - 1))
    }
  }

  return (
    <fieldset className={cn('flex flex-col gap-1.5', className)}>
      <legend className="mb-1.5 text-fu-sm font-medium text-[var(--fu-text-primary)]">{label}</legend>
      <div dir="ltr" className="flex gap-2">
        {Array.from({ length: LENGTH }, (_, index) => (
          <input
            key={index}
            ref={(node) => {
              refs.current[index] = node
            }}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            maxLength={LENGTH /* collage : la 1re case reçoit tout */}
            aria-label={`${label} ${index + 1}/${LENGTH}`}
            aria-invalid={error ? true : undefined}
            disabled={disabled}
            autoFocus={autoFocus && index === 0}
            value={value[index] ?? ''}
            onPaste={(event) => {
              // Collage intercepté AVANT maxLength : un code collé avec du
              // bruit (« 12ab34cd56 ») est filtré puis réparti sur les cases.
              event.preventDefault()
              apply(value.slice(0, index) + event.clipboardData.getData('text'))
            }}
            onChange={(event) => {
              const raw = event.target.value
              if (raw.length > 1) {
                // Collage complet — remplit toutes les cases.
                apply(value.slice(0, index) + raw)
              } else {
                handleChange(index, raw)
              }
            }}
            onKeyDown={(event) => handleKeyDown(index, event)}
            onFocus={(event) => event.target.select()}
            className={cn(
              'size-11 rounded-[var(--radius-control)] border bg-[var(--fu-surface)] text-center font-fu-mono text-fu-lg text-[var(--fu-text-primary)] tabular-nums outline-none',
              'focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--fu-canvas)]',
              'disabled:cursor-not-allowed disabled:opacity-45',
              error ? 'border-[var(--fu-danger)]' : 'border-[var(--fu-border-strong)]',
            )}
          />
        ))}
      </div>
      {error && <p className="text-fu-sm text-[var(--fu-danger)]">{error}</p>}
    </fieldset>
  )
}
