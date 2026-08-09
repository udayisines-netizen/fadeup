import { forwardRef, type ElementType, type HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

type ContainerSize = 'sm' | 'md' | 'lg' | 'xl'

interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  /** Max-width step. `sm` ~ auth cards, `md` ~ focused single-column pages, `lg` ~ default app pages, `xl` ~ marketing/content pages. */
  size?: ContainerSize
  as?: ElementType
}

const SIZE_CLASSES: Record<ContainerSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-3xl',
  lg: 'max-w-5xl',
  xl: 'max-w-6xl',
}

/** Responsive max-width + horizontal padding wrapper used by every page shell. */
export const Container = forwardRef<HTMLDivElement, ContainerProps>(function Container(
  { as: Component = 'div', size = 'lg', className, ...props },
  ref,
) {
  return (
    <Component
      ref={ref}
      className={cn('mx-auto w-full px-4 sm:px-6 lg:px-8', SIZE_CLASSES[size], className)}
      {...props}
    />
  )
})
