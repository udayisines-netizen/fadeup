import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'

/**
 * The phone's dialog.
 *
 * A centred modal on a 6-inch screen puts its primary action in the middle of
 * the display, which is the hardest place on a phone to reach one-handed while
 * holding clippers. A sheet rises from the bottom edge and lands its actions
 * in the thumb zone.
 *
 * Capped at 88svh on purpose: seeing a strip of the screen behind the sheet is
 * what tells the user they are in a layer, not on a new page. `svh` rather
 * than `vh` so collapsing browser chrome does not clip the footer mid-scroll.
 *
 * Same Radix Dialog underneath as `Dialog` — identical focus trap, escape
 * handling, scroll lock and ARIA. Only the presentation differs, which is why
 * this is a wrapper and not a second dialog implementation.
 */

export const BottomSheet = DialogPrimitive.Root
export const BottomSheetTrigger = DialogPrimitive.Trigger
export const BottomSheetClose = DialogPrimitive.Close

export const BottomSheetContent = forwardRef<HTMLDivElement, DialogPrimitive.DialogContentProps>(
  function BottomSheetContent({ className, children, ...props }, ref) {
    const { t } = useTranslation()
    return (
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay data-fu-overlay className="fixed inset-0 z-50 bg-ink-950/50 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          ref={ref}
          data-fu-sheet
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex max-h-[88svh] flex-col rounded-t-2xl border-t border-border bg-paper-0',
            'pb-[max(1rem,env(safe-area-inset-bottom))] shadow-lg',
            // overscroll containment stops a scroll inside the sheet from
            // chaining to the page underneath and dragging it around.
            'overscroll-contain',
            className,
          )}
          {...props}
        >
          {/* The grabber. Purely a signifier — the sheet is dismissed by the
              overlay, Escape, or an explicit action, not by dragging, because
              a half-implemented drag feels broken. */}
          <div className="flex justify-center pt-3" aria-hidden="true">
            <span className="h-1 w-10 rounded-full bg-border-strong" />
          </div>
          {children}
          <DialogPrimitive.Close className="sr-only">{t('common:action.close')}</DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    )
  },
)

export function BottomSheetHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 px-5 pb-2 pt-3', className)} {...props} />
}

export function BottomSheetTitle({ className, ...props }: DialogPrimitive.DialogTitleProps) {
  return <DialogPrimitive.Title className={cn('text-lg font-semibold text-ink-950', className)} {...props} />
}

export function BottomSheetDescription({ className, ...props }: DialogPrimitive.DialogDescriptionProps) {
  return <DialogPrimitive.Description className={cn('text-sm text-ink-500', className)} {...props} />
}

/** Scrollable middle. Keeps the header and the action rail fixed. */
export function BottomSheetBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-2', className)} {...props} />
}

export function BottomSheetFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-col gap-2 px-5 pt-3', className)}>{children}</div>
}
