import * as RadixSelect from '@radix-ui/react-select'
import { useId } from 'react'
import { cn } from '@/shared/lib/cn'
import { IconCheck, IconChevronDown } from '@/shared/ui/icons'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps {
  label: string
  options: SelectOption[]
  placeholder?: string
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  hint?: string
  error?: string
  disabled?: boolean
  className?: string
  ref?: React.Ref<HTMLButtonElement>
}

export function Select({
  label,
  options,
  placeholder,
  value,
  defaultValue,
  onValueChange,
  hint,
  error,
  disabled,
  className,
  ref,
}: SelectProps) {
  const id = useId()
  const describedById = `${id}-described`
  const described = error ?? hint

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-fu-sm font-medium text-[var(--fu-text-primary)]">
        {label}
      </label>
      <RadixSelect.Root value={value} defaultValue={defaultValue} onValueChange={onValueChange} disabled={disabled}>
        <RadixSelect.Trigger
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={described ? describedById : undefined}
          className={cn(
            'flex min-h-11 items-center justify-between gap-2 rounded-[var(--radius-control)] border bg-[var(--fu-surface)] px-3 text-fu-base text-[var(--fu-text-primary)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--fu-canvas)]',
            'disabled:cursor-not-allowed disabled:opacity-45 data-[placeholder]:text-[var(--fu-text-secondary)]',
            error ? 'border-[var(--fu-danger)]' : 'border-[var(--fu-border-strong)]',
          )}
        >
          <RadixSelect.Value placeholder={placeholder} />
          <RadixSelect.Icon>
            <IconChevronDown aria-hidden="true" className="size-4 text-[var(--fu-text-secondary)]" />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content
            position="popper"
            sideOffset={4}
            className={cn(
              'z-[var(--fu-z-overlay)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[var(--radius-card)] border border-[var(--fu-border)] bg-[var(--fu-surface)]',
            )}
          >
            <RadixSelect.Viewport className="p-1">
              {options.map((option) => (
                <RadixSelect.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className={cn(
                    'flex min-h-10 cursor-default select-none items-center justify-between gap-2 rounded-[var(--radius-control)] px-2.5 text-fu-sm text-[var(--fu-text-primary)] outline-none',
                    'data-[highlighted]:bg-[var(--fu-surface-subtle)] data-[disabled]:opacity-45',
                  )}
                >
                  <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                  <RadixSelect.ItemIndicator>
                    <IconCheck aria-hidden="true" className="size-4" />
                  </RadixSelect.ItemIndicator>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
      {described && (
        <p id={describedById} className={cn('text-fu-sm', error ? 'text-[var(--fu-danger)]' : 'text-[var(--fu-text-secondary)]')}>
          {described}
        </p>
      )}
    </div>
  )
}
