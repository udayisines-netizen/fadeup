import { Link, useLocation } from 'react-router-dom'
import { cn } from '@/lib/cn'

/**
 * ============================================================================
 * FOLLOW / FOLLOWING, WITHOUT THE JUMP
 * ============================================================================
 *
 * "Follow" and "Following" are different lengths in every language FadeUp
 * ships, and dramatically different in some — `Suivre` / `Abonné`, `متابعة` /
 * `تتم المتابعة`. A button that sizes to its current label therefore RESIZES
 * the instant you press it, and because the button sits at the end of a flex
 * row on a profile header, everything beside it slides. The one interaction
 * that should feel weightless is the one that moves the page.
 *
 * Both labels are rendered, stacked in the same grid cell. The inactive one is
 * `invisible` — laid out, painted nothing, and `aria-hidden` so it is not read
 * twice. The cell is therefore always as wide as the longer label and the
 * width never changes, in any language, including ones nobody tested.
 *
 * `visibility: hidden` rather than `opacity-0`: an opacity-0 label is still a
 * hit target and still selectable text.
 *
 * WHY THE PENDING STATE HAS NO SPINNER
 *
 * Following someone is optimistic in every social product because it always
 * succeeds and because the feedback IS the point. Swapping the label for a
 * spinner would make the fast path — press, done — feel slower than it is.
 * The control dims and stops accepting input instead, which is honest about
 * being busy without taking the answer away.
 *
 * WHY SIGNED-OUT IS A LINK
 *
 * A button that silently does nothing for a signed-out visitor is the worst
 * available option. This renders a real `<Link>` to /login carrying a redirect
 * back to where they were, so pressing Follow eventually follows.
 */

export function FollowControl({
  isFollowing,
  isPending,
  onToggle,
  /** Signed out? Renders a login link instead of a control. */
  signedOut,
  followLabel,
  followingLabel,
  /** The accessible name when already following — "Unfollow X", not "Following". */
  unfollowLabel,
  className,
}: {
  isFollowing: boolean
  isPending: boolean
  onToggle: () => void
  signedOut: boolean
  followLabel: string
  followingLabel: string
  unfollowLabel: string
  className?: string
}) {
  const location = useLocation()

  const shape = cn(
    // `relative z-10` keeps the control above a stretched card link — without
    // it, a Follow button inside a marketplace card is swallowed by the
    // card's own `after:inset-0` overlay and navigates instead of following.
    'relative z-10 inline-flex min-h-[--fu-control-md] items-center justify-center rounded-full',
    'border px-4 text-sm font-semibold shadow-sm',
    'transition-colors duration-[--fu-duration-quick] motion-reduce:transition-none',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700',
    className,
  )

  const idle = 'border-border-strong bg-paper-0/95 text-ink-950 backdrop-blur hover:bg-paper-100'

  if (signedOut) {
    const redirectTarget = `${location.pathname}${location.search}`
    return (
      <Link to={`/login?redirect=${encodeURIComponent(redirectTarget)}`} className={cn(shape, idle)}>
        {followLabel}
      </Link>
    )
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={isPending}
      aria-pressed={isFollowing}
      aria-label={isFollowing ? unfollowLabel : followLabel}
      className={cn(
        shape,
        'disabled:opacity-60',
        isFollowing
          ? // Inverted rather than accent-filled: Follow must not out-shout
            // Book on a profile. See the note in button.tsx on `social`.
            'border-ink-950 bg-ink-950 text-paper-0 hover:bg-ink-800'
          : idle,
      )}
    >
      <span className="grid">
        <span
          aria-hidden={isFollowing ? undefined : true}
          className={cn('col-start-1 row-start-1', isFollowing ? '' : 'invisible')}
        >
          {followingLabel}
        </span>
        <span
          aria-hidden={isFollowing ? true : undefined}
          className={cn('col-start-1 row-start-1', isFollowing ? 'invisible' : '')}
        >
          {followLabel}
        </span>
      </span>
    </button>
  )
}
