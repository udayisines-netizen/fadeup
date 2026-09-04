import * as RadixCheckbox from '@radix-ui/react-checkbox'
import { useId } from 'react'
import { cn } from '@/shared/lib/cn'
import { IconCheck } from '@/shared/ui/icons'

export interface CheckboxProps {
  label: string
  checked?: boolean
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean
  name?: string
  value?: string
  className?: string
  ref?: React.Ref<HTMLButtonElement>
}

export function Checkbox({ label, checked, defaultChecked, onCheckedChange, disabled, name, value, className, ref }: CheckboxProps) {
  const id = useId()
  return (
    <div className={cn('flex min-h-11 items-center gap-2.5', className)}>
      <RadixCheckbox.Root
        ref={ref}
        id={id}
        checked={checked}
        defaultChecked={defaultChecked}
        onCheckedChange={(state) => onCheckedChange?.(state === true)}
        disabled={disabled}
        name={name}
        value={value}
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-media)] border border-[var(--fu-border-strong)] bg-[var(--fu-surface)]',
          'transition-colors duration-[var(--fu-dur-instant)] ease-[var(--fu-ease)]',
          'data-[state=checked]:border-transparent data-[state=checked]:bg-[var(--fu-accent)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--fu-canvas)]',
          'disabled:cursor-not-allowed disabled:opacity-45',
        )}
      >
        <RadixCheckbox.Indicator className="text-[var(--fu-accent-fg)]">
          <IconCheck aria-hidden="true" className="size-3.5" />
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      <label htmlFor={id} className={cn('text-fu-sm text-[var(--fu-text-primary)]', disabled && 'opacity-45')}>
        {label}
      </label>
    </div>
  )
}
