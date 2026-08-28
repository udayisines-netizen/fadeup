import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/cn'

/**
 * ============================================================================
 * THE FADEUP VERIFIED BADGE
 * ============================================================================
 *
 * WHAT IT MEANS, EXACTLY
 *
 * There is no `verified` column anywhere in this schema, and R5 did not invent
 * one. The badge is anchored on the one fact the database can actually assert:
 * `professionals.claim_state = 'claimed'` — a real person proved control of
 * this identity and holds it. That is a statement about IDENTITY, never about
 * quality, and the tooltip copy says so in those words. A badge that quietly
 * reads as "FadeUp endorses this barber" would be a claim FadeUp has never
 * made and has no evidence for.
 *
 * Callers pass the fact. This component does not fetch, does not derive, and
 * has no default — omitting the prop is a type error rather than an unverified
 * profile silently gaining a badge.
 *
 * WHY THE GEOMETRY IS DRAWN AND NOT IMPORTED
 *
 * The scalloped disc is instantly legible because a decade of social products
 * trained everyone to read it, and that recognisability is the entire point of
 * using the shape. It is also somebody else's trademarked asset. So the path
 * below is FadeUp's own: twelve lobes rather than eight, a shallower scallop,
 * and a check with squared terminals that matches the product's other icons.
 * Recognisable at 14px, not a copy at any size.
 *
 * COLOUR IS NEVER THE MESSAGE
 *
 * The badge always carries a text alternative — `aria-label` on the graphic,
 * plus a tooltip on pointer and keyboard focus. Someone who cannot distinguish
 * the emerald from the surrounding grey still gets the whole meaning, which is
 * WCAG 1.4.1 and is also just correct: a coloured dot that means something
 * important and says nothing is a badge only its designer can read.
 */

type BadgeSize = 'sm' | 'md' | 'lg'

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: 'h-3.5 w-3.5',
  md: 'h-[1.125rem] w-[1.125rem]',
  lg: 'h-6 w-6',
}

export function VerifiedBadge({
  /**
   * Whether this identity is claimed and controlled by the person it names.
   * Required, and false renders nothing at all — see the note above on why
   * there is deliberately no default.
   */
  verified,
  size = 'md',
  /**
   * Suppresses the tooltip. For dense contexts (a list row, a card corner)
   * where a hover surface would be noise — the `aria-label` still carries the
   * meaning, so nothing is lost for a screen reader.
   */
  withoutTooltip = false,
  className,
}: {
  verified: boolean
  size?: BadgeSize
  withoutTooltip?: boolean
  className?: string
}) {
  const { t } = useTranslation('common')

  if (!verified) return null

  const mark = (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label={t('verified.label')}
      className={cn('inline-block shrink-0 align-[-0.125em] text-accent-600', SIZE_CLASSES[size], className)}
    >
      {/*
        Twenty-four points, alternating between two circles centred on (12,12)
        and stepped 15 degrees apart: r=11 at the crest of a lobe, r=9.15 in
        the valley between two. Twelve lobes rather than eight, and a scallop
        depth of 1.85 units rather than the reference's much deeper cut — that
        shallowness is what keeps it reading as a disc with a soft edge at
        14px instead of as a gear or a flower.
      */}
      <path
        fill="currentColor"
        d="M12.0 1.0 14.37 3.16 17.5 2.47 18.47 5.53 21.53 6.5 20.84 9.63 23.0 12.0 20.84 14.37 21.53 17.5 18.47 18.47 17.5 21.53 14.37 20.84 12.0 23.0 9.63 20.84 6.5 21.53 5.53 18.47 2.47 17.5 3.16 14.37 1.0 12.0 3.16 9.63 2.47 6.5 5.53 5.53 6.5 2.47 9.63 3.16Z"
      />
      {/* Squared terminals, matching the product's lucide icon set. */}
      <path
        fill="none"
        stroke="var(--color-on-accent)"
        strokeWidth="2.4"
        strokeLinecap="square"
        strokeLinejoin="miter"
        d="M7.8 12.2 10.7 15.1 16.3 9.4"
      />
    </svg>
  )

  if (withoutTooltip) return mark

  return (
    /*
      Its own provider, rather than assuming an ancestor mounted one.
      `ui/tooltip` had no consumers before this badge, so nothing in the app
      rendered a TooltipProvider — and a Radix tooltip without one does not
      degrade, it throws. A badge that crashes a barber profile because
      somebody forgot a provider three layers up is not a primitive anyone can
      safely drop into a card. Providers nest, and the cost of an extra one is
      a context value.
    */
    <TooltipProvider delayDuration={200}>
      <Tooltip>
      {/*
        `asChild` on a plain <span> wrapper rather than on the svg: Radix needs
        to attach focus and pointer handlers, and an <svg> that receives
        tabIndex is announced inconsistently across screen readers. The span is
        focusable so the tooltip is reachable by keyboard, which is the half of
        WCAG 1.4.13 that hover-only tooltips always miss.
      */}
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className="inline-flex rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
          >
            {mark}
          </span>
        </TooltipTrigger>
        <TooltipContent>{t('verified.description')}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
