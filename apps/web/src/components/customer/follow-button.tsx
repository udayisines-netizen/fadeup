import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth-context'
import {
  useFollowProfessional,
  useMyFollowedProfessionals,
  useUnfollowProfessional,
} from '@/lib/queries/follows'
import { cn } from '@/lib/cn'

interface FollowButtonProps {
  professionalId: string
  className?: string
}

export function FollowButton({ professionalId, className }: FollowButtonProps) {
  const { t } = useTranslation('booking')
  const { user } = useAuth()
  const location = useLocation()

  const followedQuery = useMyFollowedProfessionals(Boolean(user))
  const follow = useFollowProfessional()
  const unfollow = useUnfollowProfessional()

  const isFollowing =
    followedQuery.data?.some((professional) => professional.id === professionalId) ?? false

  const isPending =
    followedQuery.isPending || follow.isPending || unfollow.isPending

  if (!user) {
    const redirectTarget = `${location.pathname}${location.search}`

    return (
      <Link
        to={`/login?redirect=${encodeURIComponent(redirectTarget)}`}
        className={cn(
          'relative z-10 inline-flex min-h-9 items-center justify-center rounded-full border border-border bg-paper-0/95 px-3 text-sm font-semibold text-ink-950 shadow-sm backdrop-blur transition-colors hover:bg-paper-100',
          className,
        )}
      >
        {t('professional.follow')}
      </Link>
    )
  }

  function handleClick() {
    if (isFollowing) {
      unfollow.mutate(professionalId)
    } else {
      follow.mutate(professionalId)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      aria-pressed={isFollowing}
      aria-label={
        isFollowing
          ? t('professional.unfollow')
          : t('professional.follow')
      }
      className={cn(
        'relative z-10 inline-flex min-h-9 items-center justify-center rounded-full border px-3 text-sm font-semibold shadow-sm transition-colors disabled:opacity-50',
        isFollowing
          ? 'border-ink-950 bg-ink-950 text-paper-0 hover:bg-ink-800'
          : 'border-border bg-paper-0/95 text-ink-950 backdrop-blur hover:bg-paper-100',
        className,
      )}
    >
      {isFollowing
        ? t('professional.following')
        : t('professional.follow')}
    </button>
  )
}
