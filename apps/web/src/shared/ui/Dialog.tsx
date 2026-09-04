import * as RadixDialog from '@radix-ui/react-dialog'
import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import { IconButton } from '@/shared/ui/IconButton'
import { IconClose } from '@/shared/ui/icons'

export interface DialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: React.ReactNode
  title: string
  /** Optionnelle mais recommandée — lue par les lecteurs d'écran. */
  description?: string
  children: React.ReactNode
  className?: string
}

/**
 * Modale centrée (Radix : piège de focus, Échap, aria câblés). Pour les
 * volets mobiles, utiliser `Sheet`.
 */
export function Dialog({ open, onOpenChange, trigger, title, description, children, className }: DialogProps) {
  const { t } = useTranslation('v2')
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger != null && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          data-fu-overlay
          className="fixed inset-0 z-[var(--fu-z-overlay)] bg-[var(--fu-scrim)]"
        />
        <RadixDialog.Content
          data-fu-content
          className={cn(
            'fixed start-1/2 top-1/2 z-[var(--fu-z-modal)] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rtl:translate-x-1/2',
            'rounded-[var(--radius-modal)] border border-[var(--fu-border)] bg-[var(--fu-surface)] p-5',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <RadixDialog.Title className="text-fu-lg font-semibold text-[var(--fu-text-primary)]">{title}</RadixDialog.Title>
            <RadixDialog.Close asChild>
              <IconButton aria-label={t('common.a11y.closeDialog')} className="-me-2 -mt-2">
                <IconClose />
              </IconButton>
            </RadixDialog.Close>
          </div>
          {description ? (
            <RadixDialog.Description className="mt-1 text-fu-sm text-[var(--fu-text-secondary)]">
              {description}
            </RadixDialog.Description>
          ) : null}
          <div className="mt-4">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
