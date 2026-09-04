import { cn } from '@/shared/lib/cn'

interface StickyActionBarProps {
  children: React.ReactNode
  className?: string
  ref?: React.Ref<HTMLDivElement>
}

/**
 * The ONE place the consumer surface owns a shadow (direction A). Pins its
 * content (typically a full-width primary Button) to the bottom of the
 * viewport, above the safe area.
 */
export function StickyActionBar({ children, className, ref }: StickyActionBarProps) {
  return (
    <div
      ref={ref}
      className={cn(
        'fixed start-0 end-0 bottom-0 z-[var(--fu-z-sticky)]',
        'bg-[var(--fu-surface)] px-4 pt-3',
        'pb-[calc(0.75rem+env(safe-area-inset-bottom))]',
        'shadow-[var(--fu-shadow-sticky)]',
        className,
      )}
    >
      <div className="mx-auto w-full max-w-md [&>button]:w-full">{children}</div>
    </div>
  )
}
