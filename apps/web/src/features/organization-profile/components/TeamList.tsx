import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Avatar } from '@/shared/ui/Avatar'
import { Button } from '@/shared/ui/Button'
import { Row } from '@/shared/ui/Row'
import {
  useMemberHandle,
  useShopServiceState,
  type TeamMember,
} from '@/features/organization-profile/api/organizationProfile'

interface TeamListProps {
  slug: string
  members: readonly TeamMember[]
  /** Lieu de référence du profil (les états de service sont par lieu). */
  locationId: string | null
}

/**
 * L'équipe du salon (F2 §4) : TOUS les membres publics sont visibles, mais le
 * CTA de réservation n'apparaît QUE pour ceux qui sont réellement réservables
 * — l'état vient de get_public_service_state PAR BARBER (les overrides
 * individuels comptent).
 *
 * Chaque membre revendiqué renvoie vers son profil /pro/:handle — le chemin
 * inverse du rattachement. Un membre dont l'identité n'est pas revendiquée
 * n'a PAS de page publique portable (décision B1 : le lien staff<->identité
 * n'est public qu'après revendication) : sa rangée n'invente pas de lien.
 *
 * Le bouton « Réserver » des rangées reste en registre SECONDAIRE : le vert
 * plein est réservé AU CTA dominant de l'écran, unique par surface (P1 §9).
 */
export function TeamList({ slug, members, locationId }: TeamListProps) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--fu-border)] [&>*:last-child]:border-b-0" data-testid="team-list">
      {members.map((member) => (
        <TeamMemberRow key={member.barber_id} slug={slug} member={member} locationId={locationId} />
      ))}
    </div>
  )
}

function TeamMemberRow({ slug, member, locationId }: { slug: string; member: TeamMember; locationId: string | null }) {
  const { t } = useTranslation('v2')
  const navigate = useNavigate()
  const handle = useMemberHandle(member.professional_id)
  const memberLocationId = member.location_id ?? locationId
  const state = useShopServiceState(slug, memberLocationId, member.barber_id, { poll: false })
  // F4 : même porte que le CTA principal — le MODE ; une organisation sans
  // capacité reçoit une demande, le tunnel annonce laquelle.
  const bookable = Boolean(state.data?.mode_allows_booking)

  const bookButton = bookable ? (
    <Button
      variant="secondary"
      size="sm"
      data-testid="team-book"
      onClick={(event) => {
        // La rangée est peut-être un lien : le bouton ne doit pas le suivre.
        event.stopPropagation()
        event.preventDefault()
        void navigate(`/book/${encodeURIComponent(slug)}?l=${memberLocationId ?? ''}&b=${member.barber_id}`)
      }}
    >
      {t('profile.shop.bookMember')}
    </Button>
  ) : undefined

  const common = {
    leading: <Avatar name={member.display_name} src={member.avatar_url} />,
    title: member.display_name,
    subtitle: member.title ?? undefined,
    trailing: bookButton,
    clampTitle: true,
  }

  if (handle.data) {
    return (
      <Row
        as="link"
        to={`/pro/${encodeURIComponent(handle.data)}`}
        aria-label={t('profile.shop.teamMemberAria', { name: member.display_name })}
        chevron
        {...common}
      />
    )
  }
  return <Row {...common} />
}
