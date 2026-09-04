import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
  /** Standalone spinners announce themselves; inline ones (inside Button) stay silent. */
  announce?: boolean
}

const SIZES = { sm: 'size-4', md: 'size-5', lg: 'size-8' } as const

export function Spinner({ size = 'md', className, announce = false, ref }: SpinnerProps & { ref?: React.Ref<SVGSVGElement> }) {
  const { t } = useTranslation('v2')
  return (
    <svg
      ref={ref}
      viewBox="0 0 24 24"
      fill="none"
      role={announce ? 'status' : undefined}
      aria-label={announce ? t('common.a11y.loading') : undefined}
      aria-hidden={announce ? undefined : true}
      className={cn('animate-spin', SIZES[size], className)}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
