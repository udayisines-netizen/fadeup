import { useMemo } from 'react'
import { cn } from '@/lib/cn'

/**
 * A person, as a circle.
 *
 * FadeUp has no customer photographs and only sometimes has a professional's
 * `avatar_url`, so the DEFAULT case here is initials — not a grey silhouette.
 * That matters more than it sounds: the references show photo avatars
 * everywhere, and copying that would mean either inventing images or shipping
 * a wall of identical placeholder icons. Initials on a tinted ground read as
 * deliberate, stay legible at 28px, and give each row a distinguishable colour.
 *
 * The tint is derived from the name, so the same person is always the same
 * colour — a small thing that makes a list of twelve appointments scannable.
 */

const TINTS = [
  'bg-accent-100 text-accent-800',
  'bg-info-100 text-info-700',
  'bg-warning-100 text-warning-700',
  'bg-danger-100 text-danger-700',
  'bg-success-100 text-success-700',
] as const

const SIZES = {
  xs: 'h-7 w-7 text-[11px]',
  sm: 'h-9 w-9 text-xs',
  md: 'h-11 w-11 text-sm',
  lg: 'h-14 w-14 text-lg',
  xl: 'h-16 w-16 text-xl',
} as const

export type AvatarSize = keyof typeof SIZES

/** First letters of the first two words — "Jean-Luc Martin" -> "JM". */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

function tintFor(name: string): string {
  // Deterministic, so a person keeps their colour between renders and pages.
  let hash = 0
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0
  return TINTS[Math.abs(hash) % TINTS.length]
}

export function Avatar({
  name,
  src,
  size = 'md',
  className,
  ring,
}: {
  name: string
  src?: string | null
  size?: AvatarSize
  className?: string
  /** A soft accent ring, for the one avatar a screen is actually about. */
  ring?: boolean
}) {
  const initials = useMemo(() => initialsOf(name), [name])
  const tint = useMemo(() => tintFor(name), [name])

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold',
        SIZES[size],
        src ? 'bg-paper-100' : tint,
        ring && 'ring-2 ring-accent-600/40 ring-offset-2 ring-offset-paper-0',
        className,
      )}
      // The name is already rendered beside every avatar in this product, so
      // announcing it twice is noise for a screen reader.
      aria-hidden="true"
    >
      {src ? (
        <img src={src} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : (
        initials
      )}
    </span>
  )
}

/** Overlapping avatars for "who is waiting" — caps at `max` and counts the rest. */
export function AvatarStack({
  names,
  max = 3,
  size = 'sm',
  className,
}: {
  names: string[]
  max?: number
  size?: AvatarSize
  className?: string
}) {
  const shown = names.slice(0, max)
  const overflow = names.length - shown.length

  return (
    <span className={cn('flex items-center', className)}>
      {shown.map((name, index) => (
        <Avatar
          key={`${name}-${index}`}
          name={name}
          size={size}
          className={cn('ring-2 ring-paper-0', index > 0 && '-ms-2')}
        />
      ))}
      {overflow > 0 ? (
        <span
          className={cn(
            '-ms-2 inline-flex items-center justify-center rounded-full bg-paper-100 font-semibold text-ink-700 ring-2 ring-paper-0',
            SIZES[size],
          )}
          aria-hidden="true"
        >
          +{overflow}
        </span>
      ) : null}
    </span>
  )
}
