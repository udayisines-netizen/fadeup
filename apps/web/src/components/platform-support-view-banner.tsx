import { useEffect, useState } from 'react'
import { useSupportView } from '@/routes/platform-support-view-context'
import { useOrganization } from '@/lib/queries/platform'
import { useOrgStaffProfiles } from '@/lib/queries/staff-profiles'
import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { useToast } from '@/components/ui/toast'
import { getErrorMessage } from '@/lib/get-error-message'
import { useTranslation } from 'react-i18next'

/**
 * Le bandeau de vue empruntée.
 *
 * PLAT-1 §7 : « Le bandeau de vue empruntée doit être impossible à ignorer.
 * C'est le seul endroit où j'accepte un traitement visuel agressif. » D'où le
 * fond plein, la barre collée en haut de la fenêtre au-dessus de tout le
 * reste, et le décompte qui rappelle que la session expire.
 *
 * IL N'A PAS DE BOUTON DE FERMETURE, et ce n'est pas un oubli : un modérateur
 * qui oublie où il est fait des dégâts. La seule sortie est de SORTIR de la
 * vue — ce qui ferme la session et l'écrit au journal.
 *
 * Ne rend rien quand aucune session n'est active. « Active » veut dire non
 * close ET non échue : la requête filtre sur expires_at et se rafraîchit à la
 * minute, si bien que le bandeau tombe au moment où la session cesse
 * réellement d'emprunter quoi que ce soit côté serveur.
 */
export function PlatformSupportViewBanner() {
  const { t } = useTranslation()
  const { activeSession, exitSupportView, isExiting } = useSupportView()
  const { toast } = useToast()
  const organizationQuery = useOrganization(activeSession?.organizationId)
  const staffProfilesQuery = useOrgStaffProfiles(
    activeSession?.targetType === 'barber' ? activeSession.organizationId : undefined,
  )
  const remaining = useRemainingMinutes(activeSession?.expiresAt)

  if (!activeSession) return null

  const targetStaffProfile = staffProfilesQuery.data?.find((profile) => profile.userId === activeSession.targetUserId)
  const workspaceLabel =
    activeSession.targetType === 'barber' && targetStaffProfile
      ? t('platform:supportView.barberWorkspace', { name: targetStaffProfile.displayName })
      : (organizationQuery.data?.name ?? t('platform:supportView.thisOrganization'))

  async function handleExit() {
    try {
      await exitSupportView()
      toast({ title: t('platform:nav.exitedSupportView') })
    } catch (error) {
      toast({ title: t('platform:nav.couldntExitSupportView'), description: getErrorMessage(error), variant: 'error' })
    }
  }

  return (
    <div
      data-plat1-support-banner="true"
      role="status"
      aria-live="polite"
      /*
       * Encre sur ambre, dans les DEUX thèmes — pas de blanc sur ambre.
       * `--color-warning-600` vaut #b4790a en clair et #e0a02f en sombre :
       * du blanc y donne 3,7:1 et échoue AA, une encre fixe donne 5,1:1 et
       * 8,1:1. La couleur de texte est volontairement figée plutôt que prise
       * dans l'échelle `ink`, qui s'inverse avec le thème et rendrait le
       * bandeau illisible en sombre. Même raisonnement que « blanc sur vert
       * interdit » du contrat pro.
       */
      className="sticky top-0 z-50 border-y-2 border-warning-700 bg-warning-600 text-[#150e02] shadow-lg"
    >
      <Container size="lg" className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-xs font-semibold uppercase tracking-[0.18em]">
            {t('platform:supportView.badge')}
          </span>
          <span className="truncate text-sm font-semibold">
            {t('platform:supportView.viewing', { target: workspaceLabel })}
          </span>
          <span className="text-sm tabular-nums">
            {remaining === null
              ? null
              : remaining <= 0
                ? t('platform:supportView.expired')
                : t('platform:supportView.remaining', { count: remaining })}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs sm:inline">{t('platform:supportView.noPayment')}</span>
          <Button variant="secondary" size="sm" isLoading={isExiting} onClick={() => void handleExit()}>
            {t('platform:nav.exitSupportView')}
          </Button>
        </div>
      </Container>
    </div>
  )
}

/** Minutes restantes avant l'échéance, arrondies au supérieur. Retick chaque minute. */
function useRemainingMinutes(expiresAt: string | undefined): number | null {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!expiresAt) return
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [expiresAt])

  if (!expiresAt) return null
  const parsed = Date.parse(expiresAt)
  if (Number.isNaN(parsed)) return null
  // Arrondi au plus proche : `ceil` afficherait « 31 min » sur une session de
  // trente, au moindre décalage d'horloge entre le serveur et le navigateur.
  return Math.max(0, Math.round((parsed - now) / 60_000))
}
