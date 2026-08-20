import { useTranslation } from 'react-i18next'
import { forwardRef, type HTMLAttributes } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

function DialogOverlay({ className, ...props }: DialogPrimitive.DialogOverlayProps) {
  return (
    <DialogPrimitive.Overlay
      data-fu-overlay
      className={cn('fixed inset-0 z-50 bg-ink-950/40', className)}
      {...props}
    />
  )
}

/**
 * A dialog that always fits the viewport.
 *
 * This used to be a `fixed`, centre-translated box with no height limit. A
 * form taller than the window then extended past BOTH edges, and because a
 * fixed element does not scroll with the page, the fields and the Save button
 * below the fold were simply unreachable — no amount of scrolling helped.
 * That is what made Add Location unusable at 1366x768.
 *
 * The fix is structural rather than a per-form patch: the content is a flex
 * column capped at the viewport, so a `DialogBody` inside it can take the
 * leftover space and scroll on its own while the header and footer stay put.
 * `dvh` is used so mobile browser chrome collapsing does not clip the footer,
 * with `vh` as the fallback for engines that lack it.
 */
export const DialogContent = forwardRef<HTMLDivElement, DialogPrimitive.DialogContentProps>(
  function DialogContent({ className, children, ...props }, ref) {
    const { t } = useTranslation()
    return (
      <DialogPrimitive.Portal>
        <DialogOverlay />
        <DialogPrimitive.Content
          ref={ref}
          data-fu-content
          className={cn(
            // left-1/2 + -translate-x-1/2 is SYMMETRIC centring, not a direction.
            // Its logical twin (start-1/2) would flip the offset under RTL
            // while the transform kept moving left, landing the dialog
            // off-centre — the one case where the physical property is right.
            'fixed left-1/2 top-1/2 z-50 flex w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col',
            'max-h-[calc(100vh-2rem)] max-h-[calc(100dvh-2rem)]',
            // Dialogs that don't opt into DialogBody still scroll as a whole
            // rather than overflowing the screen.
            'overflow-y-auto overscroll-contain rounded-xl border border-border bg-paper-0 p-6 shadow-lg',
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
  },
)

/**
 * The scrollable middle of a dialog. Wrap the fields in this whenever a form
 * can grow — the header and footer then stay visible and the Save button is
 * always reachable.
 *
 * `min-h-0` is what actually lets it shrink: a flex child defaults to
 * `min-height:auto`, which refuses to go below its content and pushes the
 * footer out of the dialog instead of scrolling. The negative margin with
 * matching padding keeps focus rings from being clipped at the scroll edge.
 */
export function DialogBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('-mx-6 min-h-0 flex-1 overflow-y-auto px-6', className)} {...props} />
}

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-4 flex shrink-0 flex-col gap-1 pe-8', className)} {...props} />
}

export function DialogTitle({ className, ...props }: DialogPrimitive.DialogTitleProps) {
  return <DialogPrimitive.Title className={cn('text-lg font-semibold text-ink-950', className)} {...props} />
}

export function DialogDescription({ className, ...props }: DialogPrimitive.DialogDescriptionProps) {
  return <DialogPrimitive.Description className={cn('text-sm text-ink-500', className)} {...props} />
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('mt-6 flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  )
}
