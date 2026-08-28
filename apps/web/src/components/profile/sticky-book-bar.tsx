import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * ============================================================================
 * BOOK, ALWAYS WITHIN REACH
 * ============================================================================
 *
 * §13 and §34: booking must not be hidden several scroll lengths down a
 * profile, and on web it should be a persistent action.
 *
 * The profile header carries the FIRST Book. This is the SECOND one, and it
 * only appears once the header's has scrolled away — which is why it is
 * `sticky bottom-0` inside the page rather than `fixed`: a fixed bar covers
 * content from the moment the page loads, including the header's own Book,
 * which leaves two identical primary buttons on screen at once.
 *
 * WHY IT IS SAFE-AREA AWARE AND WHY THE CUSTOMER APP DOES NOT USE IT
 *
 * Public profiles at /s/:slug/* are visited without the customer shell, so
 * there is no tab bar underneath and the bar sits on the device edge. Inside
 * the signed-in app the tab bar already occupies that space and already
 * carries BOOK in its centre, so this bar would be the third Book on screen.
 * The caller decides; this component only knows how to be a bar.
 */
export function StickyBookBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'sticky bottom-0 z-[--fu-z-sticky] -mx-4 mt-2 border-t border-border sm:-mx-6',
        'bg-paper-0/95 px-4 pb-[--fu-safe-bottom] pt-3 backdrop-blur sm:px-6',
        className,
      )}
    >
      {children}
    </div>
  )
}
