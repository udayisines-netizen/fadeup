import * as RadixDialog from '@radix-ui/react-dialog'
import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import { IconButton } from '@/shared/ui/IconButton'
import { IconClose } from '@/shared/ui/icons'

export interface SheetProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: React.ReactNode
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}

/**
 * Feuille : entre par le BAS sous 768 px (coins hauts en `--radius-sheet`),
 * par le CÔTÉ inline-end au-dessus — propriétés logiques uniquement, jamais
 * `right`, donc le côté s'inverse correctement en RTL.
 */
export function Sheet({ open, onOpenChange, trigger, title, description, children, className }: SheetProps) {
  const { t } = useTranslation('v2')
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger != null && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal>
        <RadixDialog.Overlay data-fu-overlay className="fixed inset-0 z-[var(--fu-z-overlay)] bg-[var(--fu-scrim)]" />
        <RadixDialog.Content
          data-fu-content
          className={cn(
            'fixed z-[var(--fu-z-modal)] flex flex-col bg-[var(--fu-surface)]',
            // < 768 px : bottom sheet
            'max-md:start-0 max-md:end-0 max-md:bottom-0 max-md:max-h-[85dvh] max-md:rounded-t-[var(--radius-sheet)]',
            'max-md:pb-[env(safe-area-inset-bottom)]',
            // ≥ 768 px : side sheet, côté inline-end
            'md:inset-y-0 md:end-0 md:h-dvh md:w-96 md:border-s md:border-[var(--fu-border)]',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-[var(--fu-border)] p-4">
            <div>
              <RadixDialog.Title className="text-fu-lg font-semibold text-[var(--fu-text-primary)]">{title}</RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-0.5 text-fu-sm text-[var(--fu-text-secondary)]">
                  {description}
                </RadixDialog.Description>
              ) : null}
            </div>
            <RadixDialog.Close asChild>
              <IconButton aria-label={t('common.a11y.closeDialog')}>
                <IconClose />
              </IconButton>
            </RadixDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
