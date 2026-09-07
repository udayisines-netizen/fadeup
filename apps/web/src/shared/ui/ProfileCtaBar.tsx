import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { ProfileCtaState } from '@/shared/lib/serviceState'
import { Button } from '@/shared/ui/Button'
import { StickyActionBar } from '@/shared/ui/StickyActionBar'
import { DateTime } from '@/shared/ui/DateTime'

export interface ProfileCtaBarProps {
  /** L'état RÉEL, dérivé de get_public_service_state (deriveProfileCta). */
  cta: ProfileCtaState
  /** Nom affiché — porte les libellés d'accessibilité. */
  name: string
  /** Destination du CTA RÉSERVER quand la réservation accepte. */
  bookTo: string
  /** Destination « Rejoindre la file » (/q/:slug…) quand seule la file accepte. */
  queueTo: string | null
  /** Fuseau du lieu pour l'échéance d'un mode temporaire. */
  timezone: string | null
  following: boolean
  followBusy?: boolean
  onToggleFollow: () => void
  /**
   * Remplace la note dérivée de l'état — le cas non revendiqué explique que
   * la réservation ouvrira à la revendication, sans laisser croire à une
   * erreur ni fabriquer une capacité.
   */
  noteOverride?: string | null
}

/**
 * LA barre transactionnelle des profils publics (F2 §3, MASTER_SPEC §9).
 *
 * BOOK est le CTA dominant : vert plein, texte encre — le SEUL vert plein de
 * l'écran. FOLLOW est toujours secondaire. L'écart doit sauter aux yeux.
 *
 * Le CTA dit l'état RÉEL :
 * - réservation ouverte  -> RÉSERVER actif ;
 * - file seule ouverte   -> l'alternative réelle : « Rejoindre la file » ;
 * - fermé                -> RÉSERVER désactivé, le profil reste entier ;
 * - état inconnu (RPC en échec) -> désactivé, JAMAIS un état inventé.
 * Un mode temporaire affiche son échéance (fuseau du lieu).
 *
 * Sous 768 px la nav basse consumer occupe le bord : la barre se pose
 * AU-DESSUS (bottom-14), leçon F1 §10.2.
 */
export function ProfileCtaBar({
  cta,
  name,
  bookTo,
  queueTo,
  timezone,
  following,
  followBusy = false,
  onToggleFollow,
  noteOverride,
}: ProfileCtaBarProps) {
  const { t } = useTranslation('v2')
  const navigate = useNavigate()

  const derivedNote =
    cta.kind === 'loading'
      ? null
      : cta.kind === 'unknown'
      ? t('profile.cta.unknownNote')
      : cta.kind === 'queue-only'
        ? t('profile.cta.queueNote')
        : cta.kind === 'closed'
          ? t('profile.cta.closedNote')
          : null
  const note = noteOverride ?? derivedNote

  return (
    <StickyActionBar className="bottom-14 pb-3 md:bottom-0 md:pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-md">
        {(note || cta.temporaryUntil) && (
          <p className="mb-2 text-center text-fu-xs text-[var(--fu-text-secondary)]" data-testid="cta-note">
            {note}
            {cta.temporaryUntil && timezone && (
              <span className="ms-1">
                {t('profile.cta.temporaryUntilPrefix')}{' '}
                <DateTime value={cta.temporaryUntil} timezone={timezone} format="time" />
              </span>
            )}
          </p>
        )}
        <div className="flex gap-2 [&>*:first-child]:flex-[2] [&>*:last-child]:flex-1">
          {cta.kind === 'loading' ? (
            /* Résolution en cours : le CTA charge — il n'affirme NI panne ni
               fermeture (largeur et couleur conservées par le Button). */
            <Button
              variant="primary"
              size="lg"
              data-testid="profile-book-cta"
              aria-label={t('profile.cta.bookAria', { name })}
              loading
            >
              {t('common.action.book')}
            </Button>
          ) : cta.kind === 'queue-only' && queueTo ? (
            /* L'alternative réelle : la file existe et accepte (pont F1). */
            <Button
              variant="primary"
              size="lg"
              data-testid="profile-book-cta"
              aria-label={t('profile.cta.bookAria', { name })}
              onClick={() => void navigate(queueTo)}
            >
              {t('profile.cta.joinQueue')}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              data-testid="profile-book-cta"
              aria-label={t('profile.cta.bookAria', { name })}
              disabled={cta.kind !== 'bookable'}
              onClick={() => void navigate(bookTo)}
            >
              {t('common.action.book')}
            </Button>
          )}
          <Button
            variant="secondary"
            size="lg"
            data-testid="profile-follow-cta"
            aria-label={following ? t('profile.cta.unfollowAria', { name }) : t('profile.cta.followAria', { name })}
            aria-pressed={following}
            loading={followBusy}
            onClick={onToggleFollow}
          >
            {following ? t('profile.cta.following') : t('common.action.follow')}
          </Button>
        </div>
      </div>
    </StickyActionBar>
  )
}
