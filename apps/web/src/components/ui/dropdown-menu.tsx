import { forwardRef } from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/cn'

export const DropdownMenu = DropdownMenuPrimitive.Root
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger
export const DropdownMenuGroup = DropdownMenuPrimitive.Group

export const DropdownMenuContent = forwardRef<HTMLDivElement, DropdownMenuPrimitive.DropdownMenuContentProps>(
  function DropdownMenuContent({ className, sideOffset = 6, ...props }, ref) {
    return (
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          ref={ref}
          data-fu-popover
          sideOffset={sideOffset}
          className={cn(
            'z-50 min-w-[10rem] rounded-md border border-border bg-paper-0 p-1 shadow-md',
            className,
          )}
          {...props}
        />
      </DropdownMenuPrimitive.Portal>
    )
  },
)

interface DropdownMenuItemProps extends DropdownMenuPrimitive.DropdownMenuItemProps {
  variant?: 'default' | 'danger'
}

export const DropdownMenuItem = forwardRef<HTMLDivElement, DropdownMenuItemProps>(function DropdownMenuItem(
  { className, variant = 'default', ...props },
  ref,
) {
  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      className={cn(
        'flex min-h-9 cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none',
        'data-[highlighted]:bg-paper-100',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        variant === 'danger' ? 'text-danger-600 data-[highlighted]:bg-danger-100' : 'text-ink-800',
        className,
      )}
      {...props}
    />
  )
})

export function DropdownMenuSeparator({ className, ...props }: DropdownMenuPrimitive.DropdownMenuSeparatorProps) {
  return <DropdownMenuPrimitive.Separator className={cn('my-1 h-px bg-border', className)} {...props} />
}

export function DropdownMenuLabel({ className, ...props }: DropdownMenuPrimitive.DropdownMenuLabelProps) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn('px-2 py-1.5 text-xs font-medium text-ink-500', className)}
      {...props}
    />
  )
}
