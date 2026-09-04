import * as RadixRadio from '@radix-ui/react-radio-group'
import { useId } from 'react'
import { cn } from '@/shared/lib/cn'

export interface RadioOption {
  value: string
  label: string
  disabled?: boolean
}

export interface RadioProps {
  /** Libellé du groupe — visible. */
  label: string
  options: RadioOption[]
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  disabled?: boolean
  className?: string
  ref?: React.Ref<HTMLDivElement>
}

export function Radio({ label, options, value, defaultValue, onValueChange, disabled, className, ref }: RadioProps) {
  const groupId = useId()
  return (
    <fieldset className={cn('flex flex-col gap-2', className)}>
      <legend className="mb-1 text-fu-sm font-medium text-[var(--fu-text-primary)]">{label}</legend>
      <RadixRadio.Root
        ref={ref}
        value={value}
        defaultValue={defaultValue}
        onValueChange={onValueChange}
        disabled={disabled}
        className="flex flex-col gap-1"
      >
        {options.map((option, index) => {
          const id = `${groupId}-${index}`
          return (
            <div key={option.value} className="flex min-h-11 items-center gap-2.5">
              <RadixRadio.Item
                id={id}
                value={option.value}
                disabled={option.disabled}
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-avatar)] border border-[var(--fu-border-strong)] bg-[var(--fu-surface)]',
                  'transition-colors duration-[var(--fu-dur-instant)] ease-[var(--fu-ease)]',
                  'data-[state=checked]:border-[var(--fu-accent)]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--fu-canvas)]',
                  'disabled:cursor-not-allowed disabled:opacity-45',
                )}
              >
                <RadixRadio.Indicator className="size-2.5 rounded-[var(--radius-avatar)] bg-[var(--fu-accent)]" />
              </RadixRadio.Item>
              <label htmlFor={id} className={cn('text-fu-sm text-[var(--fu-text-primary)]', option.disabled && 'opacity-45')}>
                {option.label}
              </label>
            </div>
          )
        })}
      </RadixRadio.Root>
    </fieldset>
  )
}
