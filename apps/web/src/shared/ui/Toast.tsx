import * as RadixToast from '@radix-ui/react-toast'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import { IconButton } from '@/shared/ui/IconButton'
import { IconCheck, IconClose, IconError, IconInfo } from '@/shared/ui/icons'

export interface ToastInput {
  title: string
  description?: string
  tone?: 'neutral' | 'success' | 'error'
}

interface ToastItem extends ToastInput {
  id: number
}

interface ToastContextValue {
  toast: (input: ToastInput) => void
}


const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within V2ToastProvider')
  return ctx
}

const MAX_VISIBLE = 3
let nextId = 0

/**
 * File de toasts : trois visibles au maximum, les plus anciens cèdent la
 * place. `aria-live="polite"` par défaut, `assertive` pour les erreurs.
 */
export function V2ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation('v2')
  const [items, setItems] = useState<ToastItem[]>([])

  const toast = useCallback((input: ToastInput) => {
    nextId += 1
    const item: ToastItem = { id: nextId, tone: 'neutral', ...input }
    setItems((current) => [...current, item].slice(-MAX_VISIBLE))
  }, [])

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id))
  }, [])

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      <RadixToast.Provider swipeDirection="down" duration={5000}>
        {children}
        {items.map((item) => (
          <RadixToast.Root
            key={item.id}
            data-fu-content
            onOpenChange={(open) => {
              if (!open) dismiss(item.id)
            }}
            // Les erreurs interrompent ; le reste attend son tour.
            type={item.tone === 'error' ? 'foreground' : 'background'}
            className={cn(
              'flex items-start gap-3 rounded-[var(--radius-card)] border bg-[var(--fu-surface)] p-3',
              item.tone === 'error' ? 'border-[var(--fu-danger)]' : 'border-[var(--fu-border-strong)]',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'mt-0.5 inline-flex shrink-0 [&>svg]:size-4',
                item.tone === 'success' && 'text-[var(--fu-accent-text)]',
                item.tone === 'error' && 'text-[var(--fu-danger)]',
                item.tone === 'neutral' && 'text-[var(--fu-text-secondary)]',
              )}
            >
              {item.tone === 'success' ? <IconCheck /> : item.tone === 'error' ? <IconError /> : <IconInfo />}
            </span>
            <div className="min-w-0 flex-1">
              <RadixToast.Title className="text-fu-sm font-semibold text-[var(--fu-text-primary)]">
                {item.title}
              </RadixToast.Title>
              {item.description ? (
                <RadixToast.Description className="mt-0.5 text-fu-sm text-[var(--fu-text-secondary)]">
                  {item.description}
                </RadixToast.Description>
              ) : null}
            </div>
            <RadixToast.Close asChild>
              <IconButton aria-label={t('common.action.dismiss')} className="size-8 shrink-0">
                <IconClose />
              </IconButton>
            </RadixToast.Close>
          </RadixToast.Root>
        ))}
        <RadixToast.Viewport
          className={cn(
            'fixed bottom-0 end-0 z-[var(--fu-z-toast)] flex w-full max-w-sm flex-col gap-2 p-4',
            'pb-[calc(1rem+env(safe-area-inset-bottom))]',
          )}
        />
      </RadixToast.Provider>
    </ToastContext.Provider>
  )
}
