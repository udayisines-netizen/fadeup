import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth-context'
import {
  useFollowOrganization,
  useMyFollowedOrganizations,
  useUnfollowOrganization,
} from '@/lib/queries/organization-follows'
import { FollowControl } from '@/components/ui/follow-control'

interface OrganizationFollowButtonProps {
  organizationId: string
  className?: string
}

/**
 * Follow a SHOP.
 *
 * `organization_follows` — a different table from `professional_follows` and a
 * different one again from `customer_favorites`. §15 is explicit that Follow
 * Shop and Favourite Shop are separate actions with separate meanings: Follow
 * is a social relationship with a place, Favourite is a private bookmark. They
 * sit side by side on the shop profile and neither implies the other.
 */
export function OrganizationFollowButton({ organizationId, className }: OrganizationFollowButtonProps) {
  const { t } = useTranslation('booking')
  const { user } = useAuth()

  const followedQuery = useMyFollowedOrganizations(Boolean(user))
  const follow = useFollowOrganization()
  const unfollow = useUnfollowOrganization()

  const isFollowing =
    followedQuery.data?.some((organization) => organization.organizationId === organizationId) ?? false

  return (
    <FollowControl
      signedOut={!user}
      isFollowing={isFollowing}
      isPending={followedQuery.isPending || follow.isPending || unfollow.isPending}
      onToggle={() => (isFollowing ? unfollow.mutate(organizationId) : follow.mutate(organizationId))}
      followLabel={t('shop.follow')}
      followingLabel={t('shop.following')}
      unfollowLabel={t('shop.unfollow')}
      className={className}
    />
  )
}
