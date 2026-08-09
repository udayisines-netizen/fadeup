import { forwardRef, type HTMLAttributes } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'

/** A Dialog styled to slide in from a screen edge — same focus-trap/portal/ARIA guarantees as Dialog. */
export const Drawer = DialogPrimitive.Root
export const DrawerTrigger = DialogPrimitive.Trigger
export const DrawerClose = DialogPrimitive.Close

function DrawerOverlay({ className, ...props }: DialogPrimitive.DialogOverlayProps) {
  return (
    <DialogPrimitive.Overlay data-fu-overlay className={cn('fixed inset-0 z-50 bg-ink-950/40', className)} {...props} />
  )
}

interface DrawerContentProps extends DialogPrimitive.DialogContentProps {
  side?: 'right' | 'left'
}

export const DrawerContent = forwardRef<HTMLDivElement, DrawerContentProps>(function DrawerContent(
  { className, side = 'right', children, ...props },
  ref,
) {
  return (
    <DialogPrimitive.Portal>
      <DrawerOverlay />
      <DialogPrimitive.Content
        ref={ref}
        data-fu-drawer-content
        data-side={side}
        className={cn(
          'fixed inset-y-0 z-50 flex w-[calc(100vw-3rem)] max-w-sm flex-col overscroll-contain border-border bg-paper-0 p-6 shadow-lg',
          side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-500 hover:bg-paper-100 hover:text-ink-950"
          aria-label="Close"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
})

export function DrawerHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-4 flex flex-col gap-1 pr-8', className)} {...props} />
}

export function DrawerTitle({ className, ...props }: DialogPrimitive.DialogTitleProps) {
  return <DialogPrimitive.Title className={cn('text-lg font-semibold text-ink-950', className)} {...props} />
}

export function DrawerDescription({ className, ...props }: DialogPrimitive.DialogDescriptionProps) {
  return <DialogPrimitive.Description className={cn('text-sm text-ink-500', className)} {...props} />
}

export function DrawerFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-6 flex flex-col gap-2', className)} {...props} />
}
