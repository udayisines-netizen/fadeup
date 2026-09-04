import * as RadixPopover from '@radix-ui/react-popover'
import { cn } from '@/shared/lib/cn'

export interface PopoverProps {
  trigger: React.ReactNode
  children: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  align?: 'start' | 'center' | 'end'
  className?: string
}

export function Popover({ trigger, children, open, onOpenChange, align = 'center', className }: PopoverProps) {
  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          data-fu-content
          align={align}
          sideOffset={6}
          className={cn(
            'z-[var(--fu-z-overlay)] w-72 rounded-[var(--radius-card)] border border-[var(--fu-border)] bg-[var(--fu-surface)] p-4',
            'focus-visible:outline-none',
            className,
          )}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  )
}
