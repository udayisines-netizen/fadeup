import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Button } from '@/shared/ui/Button'

export type NotBuiltZone =
  /* 'home' et 'search' ont été construits par F3 et retirés d'ici. */
  | 'feed'
  | 'bookings'
  | 'account'
  | 'proProfile'
  | 'business'
  | 'dashboard'
  /* F2 — le tunnel de réservation n'est pas encore construit ; le CTA
     RÉSERVER des profils publics mène ici quand la réservation est ouverte.
     L'état affiché sur le profil reste RÉEL : c'est l'écran de destination
     qui manque, pas la capacité du salon. */
  | 'booking'

// Une fonction plutôt qu'un Record constant : la garde
// no-untranslated-status-maps interdit les maps de chaînes — et ces valeurs
// sont des routes, pas de la copie.
function actionTarget(_zone: NotBuiltZone): string {
  return '/'
}

/**
 * Toute route de la table qui n'est pas construite par P1b rend ceci : le
 * BON shell autour, un EmptyState traduit qui nomme le lot qui la
 * construira, et une action. Jamais de page blanche, jamais de TODO en dur.
 */
export function NotBuiltPage({ zone }: { zone: NotBuiltZone }) {
  const { t } = useTranslation('v2')
  const navigate = useNavigate()
  return (
    <EmptyState
      className="min-h-[60dvh] justify-center"
      title={t(`empty.${zone}.title`)}
      description={t(`empty.${zone}.description`)}
      action={
        zone === 'booking' ? (
          /* On arrive ici DEPUIS un profil : l'action honnête y retourne. */
          <Button variant="secondary" onClick={() => void navigate(-1)}>
            {t('empty.booking.action')}
          </Button>
        ) : (
        <Link
          to={actionTarget(zone)}
          className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-[var(--fu-border-strong)] px-4 text-fu-sm font-medium text-[var(--fu-text-primary)] hover:bg-[var(--fu-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--fu-canvas)]"
        >
          {t(`empty.${zone}.action`)}
        </Link>
        )
      }
    />
  )
}

export function NotFoundPage() {
  const { t } = useTranslation('v2')
  return (
    <EmptyState
      className="min-h-[60dvh] justify-center"
      title={t('errors.route.notFoundTitle')}
      description={t('errors.route.notFoundDescription')}
      action={
        <Link
          to="/"
          className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-[var(--fu-border-strong)] px-4 text-fu-sm font-medium text-[var(--fu-text-primary)] hover:bg-[var(--fu-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--fu-canvas)]"
        >
          {t('errors.route.notFoundAction')}
        </Link>
      }
    />
  )
}
