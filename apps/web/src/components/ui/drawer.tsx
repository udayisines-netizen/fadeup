import { useTranslation } from 'react-i18next'
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
  /**
   * `bottom` is the phone default for anything the user acts on: it opens
   * inside the thumb's reach, where a side drawer puts its primary buttons
   * at the top of a 6-inch screen.
   */
  side?: 'right' | 'left' | 'bottom'
}

export const DrawerContent = forwardRef<HTMLDivElement, DrawerContentProps>(function DrawerContent(
  { className, side = 'right', children, ...props },
  ref,
) {
  const { t } = useTranslation()
  return (
    <DialogPrimitive.Portal>
      <DrawerOverlay />
      <DialogPrimitive.Content
        ref={ref}
        data-fu-drawer-content
        data-side={side}
        className={cn(
          'fixed z-50 flex flex-col overscroll-contain border-border bg-paper-0 shadow-lg',
          side === 'bottom'
            ? // Capped so the sheet never covers the whole screen: seeing what
              // is behind it is how the user keeps their place in the day.
              'inset-x-0 bottom-0 max-h-[85svh] rounded-t-xl border-t p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]'
            : 'inset-y-0 w-[calc(100vw-3rem)] max-w-sm p-6',
          // `right`/`left` name the INLINE edge, not the physical one: a
          // drawer that slides in from the right in English slides in from
          // the left in Arabic, because it is anchored to the end of the
          // reading direction the whole interface follows.
          side === 'right' && 'end-0 border-s',
          side === 'left' && 'start-0 border-e',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="absolute end-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-500 hover:bg-paper-100 hover:text-ink-950"
          aria-label={t('common:action.close')}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
})

export function DrawerHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-4 flex flex-col gap-1 pe-8', className)} {...props} />
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
