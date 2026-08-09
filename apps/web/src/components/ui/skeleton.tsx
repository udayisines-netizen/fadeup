import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

/**
 * Loading placeholder that previews layout shape (table rows, list items,
 * cards). Prefer this over `Spinner` whenever the eventual content's shape
 * is known — it reduces perceived load time and layout shift. Purely
 * decorative, so it's hidden from assistive tech; pair it with a `Spinner`
 * or an `aria-live` region when a page has no other loading announcement.
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-paper-200', className)} {...props} />
}
