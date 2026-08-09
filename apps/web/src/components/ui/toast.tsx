import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import * as ToastPrimitive from '@radix-ui/react-toast'
import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react'
import { cn } from '@/lib/cn'

type ToastVariant = 'default' | 'success' | 'error'

interface ToastInput {
  title: string
  description?: string
  variant?: ToastVariant
}

interface ToastItem extends ToastInput {
  id: string
}

interface ToastContextValue {
  /** Trigger a transient confirmation/notification. Use `Alert` instead for messages that must stay visible until dismissed or the form state changes. */
  toast: (input: ToastInput) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const VARIANT_ICONS: Record<ToastVariant, typeof Info> = {
  default: Info,
  success: CheckCircle2,
  error: CircleAlert,
}

const VARIANT_ICON_CLASSES: Record<ToastVariant, string> = {
  default: 'text-info-600',
  success: 'text-success-600',
  error: 'text-danger-600',
}

/** Mounts the toast viewport once near the app root; children can call `useToast()` anywhere below it. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id))
  }, [])

  const toast = useCallback((input: ToastInput) => {
    const id = crypto.randomUUID()
    setToasts((current) => [...current, { id, ...input }])
  }, [])

  const value = useMemo<ToastContextValue>(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="right" duration={5000}>
        {children}
        {toasts.map((item) => {
          const Icon = VARIANT_ICONS[item.variant ?? 'default']
          return (
            <ToastPrimitive.Root
              key={item.id}
              data-fu-toast
              type={item.variant === 'error' ? 'foreground' : 'background'}
              className={cn(
                'flex items-start gap-3 rounded-lg border border-border bg-paper-0 p-4 shadow-md',
                'data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]',
                'data-[swipe=end]:animate-none data-[state=closed]:opacity-0',
              )}
              onOpenChange={(open) => {
                if (!open) dismiss(item.id)
              }}
            >
              <Icon
                className={cn('mt-0.5 h-4 w-4 shrink-0', VARIANT_ICON_CLASSES[item.variant ?? 'default'])}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <ToastPrimitive.Title className="text-sm font-medium text-ink-950">
                  {item.title}
                </ToastPrimitive.Title>
                {item.description ? (
                  <ToastPrimitive.Description className="mt-0.5 text-sm text-ink-500">
                    {item.description}
                  </ToastPrimitive.Description>
                ) : null}
              </div>
              <ToastPrimitive.Close
                aria-label="Dismiss notification"
                className="shrink-0 rounded-sm text-ink-400 hover:text-ink-950"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </ToastPrimitive.Close>
            </ToastPrimitive.Root>
          )
        })}
        <ToastPrimitive.Viewport className="fixed bottom-0 right-0 z-[100] flex w-full max-w-sm flex-col gap-2 p-4 outline-none sm:bottom-4 sm:right-4" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  )
}

/** Fire transient toasts, e.g. `toast({ title: 'Invitation revoked', variant: 'success' })`. */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used within a ToastProvider')
  return context
}
