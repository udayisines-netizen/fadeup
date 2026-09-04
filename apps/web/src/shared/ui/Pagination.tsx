import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import { IconButton } from '@/shared/ui/IconButton'
import { IconChevronLeft, IconChevronRight } from '@/shared/ui/icons'

export interface PaginationProps {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  className?: string
}

export function Pagination({ page, totalPages, onPageChange, className }: PaginationProps) {
  const { t, i18n } = useTranslation('v2')
  const nf = new Intl.NumberFormat(i18n.language)

  return (
    <nav className={cn('flex items-center justify-center gap-3', className)}>
      <IconButton
        aria-label={t('common.pagination.previous')}
        variant="outline"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        {/* Icône directionnelle : retournée en RTL. */}
        <IconChevronLeft className="rtl:-scale-x-100" />
      </IconButton>
      <span aria-current="page" className="text-fu-sm text-[var(--fu-text-secondary)]">
        {t('common.pagination.pageOf', { page: nf.format(page), total: nf.format(totalPages) })}
      </span>
      <IconButton
        aria-label={t('common.pagination.next')}
        variant="outline"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        <IconChevronRight className="rtl:-scale-x-100" />
      </IconButton>
    </nav>
  )
}
