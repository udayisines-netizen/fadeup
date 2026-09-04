import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import { IconBack } from '@/shared/ui/icons'

/**
 * Chrome minimal commun aux études /demo : retour à l'index, titre, note
 * technique (RPC utilisée). Le thème est posé par chaque étude (consumer ou
 * pro), pas ici.
 */
export function DemoFrame({
  title,
  note,
  children,
  className,
}: {
  title: string
  /** Note technique — la RPC réelle qui alimente l'étude. */
  note?: string
  children: React.ReactNode
  className?: string
}) {
  const { t } = useTranslation('v2')
  return (
    <div className={cn('min-h-dvh bg-[var(--fu-canvas)] font-fu-sans text-[var(--fu-text-primary)]', className)}>
      <header className="border-b border-[var(--fu-border)]">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-3">
          <Link
            to="/demo"
            className="fu-press inline-flex size-11 items-center justify-center rounded-[var(--radius-control)] text-[var(--fu-text-secondary)] hover:bg-[var(--fu-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]"
            aria-label={t('common.action.back')}
          >
            <IconBack aria-hidden="true" className="size-4 rtl:-scale-x-100" />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-fu-lg font-semibold">{title}</h1>
            {note && <p className="truncate font-fu-mono text-fu-xs text-[var(--fu-text-secondary)]">{note}</p>}
          </div>
        </div>
      </header>
      <main id="fu-main" className="fu-page-in mx-auto w-full max-w-5xl px-4 pb-28 pt-4">
        {children}
      </main>
    </div>
  )
}
