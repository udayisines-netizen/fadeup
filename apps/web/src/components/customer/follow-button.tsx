import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth-context'
import {
  useFollowProfessional,
  useMyFollowedProfessionals,
  useUnfollowProfessional,
} from '@/lib/queries/follows'
import { FollowControl } from '@/components/ui/follow-control'

interface FollowButtonProps {
  professionalId: string
  className?: string
}

/**
 * Follow a PROFESSIONAL — a durable identity, not a chair at a shop.
 *
 * Deliberately distinct from FavoriteButton and from OrganizationFollowButton:
 * following a person, following a shop and saving a shop are three separate
 * product facts with three separate tables, and §15 forbids conflating them.
 * All three share `FollowControl`'s presentation so they still feel like one
 * product; none of them shares state.
 */
export function FollowButton({ professionalId, className }: FollowButtonProps) {
  const { t } = useTranslation('booking')
  const { user } = useAuth()

  const followedQuery = useMyFollowedProfessionals(Boolean(user))
  const follow = useFollowProfessional()
  const unfollow = useUnfollowProfessional()

  const isFollowing =
    followedQuery.data?.some((professional) => professional.id === professionalId) ?? false

  return (
    <FollowControl
      signedOut={!user}
      isFollowing={isFollowing}
      isPending={followedQuery.isPending || follow.isPending || unfollow.isPending}
      onToggle={() => (isFollowing ? unfollow.mutate(professionalId) : follow.mutate(professionalId))}
      followLabel={t('professional.follow')}
      followingLabel={t('professional.following')}
      unfollowLabel={t('professional.unfollow')}
      className={className}
    />
  )
}
