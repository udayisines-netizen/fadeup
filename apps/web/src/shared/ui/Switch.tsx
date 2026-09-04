import * as RadixSwitch from '@radix-ui/react-switch'
import { useId } from 'react'
import { cn } from '@/shared/lib/cn'

export interface SwitchProps {
  label: string
  checked?: boolean
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean
  className?: string
  ref?: React.Ref<HTMLButtonElement>
}

export function Switch({ label, checked, defaultChecked, onCheckedChange, disabled, className, ref }: SwitchProps) {
  const id = useId()
  return (
    <div className={cn('flex min-h-11 items-center justify-between gap-3', className)}>
      <label htmlFor={id} className={cn('text-fu-sm text-[var(--fu-text-primary)]', disabled && 'opacity-45')}>
        {label}
      </label>
      <RadixSwitch.Root
        ref={ref}
        id={id}
        checked={checked}
        defaultChecked={defaultChecked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className={cn(
          'relative h-6 w-10 shrink-0 rounded-[var(--radius-avatar)] border border-transparent bg-[var(--fu-border-strong)]',
          'transition-colors duration-[var(--fu-dur-state)] ease-[var(--fu-ease)]',
          'data-[state=checked]:bg-[var(--fu-accent)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--fu-canvas)]',
          'disabled:cursor-not-allowed disabled:opacity-45',
        )}
      >
        <RadixSwitch.Thumb
          className={cn(
            'block size-5 translate-x-0.5 rounded-[var(--radius-avatar)] bg-[var(--fu-surface)]',
            'transition-transform duration-[var(--fu-dur-state)] ease-[var(--fu-ease)]',
            'data-[state=checked]:translate-x-[1.125rem] rtl:-translate-x-0.5 rtl:data-[state=checked]:-translate-x-[1.125rem]',
          )}
        />
      </RadixSwitch.Root>
    </div>
  )
}
