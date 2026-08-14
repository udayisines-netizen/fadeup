import { forwardRef } from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/cn'

export const TooltipProvider = TooltipPrimitive.Provider
export const Tooltip = TooltipPrimitive.Root
export const TooltipTrigger = TooltipPrimitive.Trigger

export const TooltipContent = forwardRef<HTMLDivElement, TooltipPrimitive.TooltipContentProps>(
  function TooltipContent({ className, sideOffset = 6, children, ...props }, ref) {
    return (
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          ref={ref}
          data-fu-popover
          sideOffset={sideOffset}
          className={cn(
            // `paper-0` rather than `on-accent`: both invert with the theme,
            // so the tooltip stays readable. `on-accent` stays near-white by
            // design, which on an inverted `ink-950` surface is white-on-white.
            'z-50 max-w-xs rounded-md bg-ink-950 px-2 py-1 text-xs text-paper-0 shadow-sm',
            className,
          )}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow className="fill-ink-950" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    )
  },
)
