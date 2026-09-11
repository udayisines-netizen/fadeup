import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useSession } from '@/shared/hooks/useSession'
import { useApplySurfaceTheme } from '@/shared/theme/useTheme'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'
import { SkeletonRect } from '@/shared/ui/Skeleton'
import { useToast } from '@/shared/ui/Toast'
import { posterRefusalCode, useAssignPoster, useResolvePosterCode } from '@/features/posters/api/posterScan'

/**
 * `/a/:code` — CE QUE VOIT QUELQU'UN QUI SCANNE UNE AFFICHE.
 *
 * Le QR d'une affiche n'encode PAS le lien d'un salon : il encode un CODE,
 * parce que les affiches sont imprimées AVANT qu'on sache quels salons les
 * recevront. C'est donc cet écran qui décide, et il décide selon DEUX choses :
 * l'état du code, et QUI scanne.
 *
 *   libre    + habilité → proposition d'attribution, avec le choix explicite
 *                          de l'établissement quand il y en a plusieurs
 *   libre    + client   → « pas encore active », honnêtement, sans invitation
 *                          à créer un compte pour rien
 *   attribué            → la file du salon
 *   révoqué             → un message clair
 *   inconnu             → un message clair, et rien d'autre : un code mal
 *                          formé ne touche même pas la table côté serveur
 *
 * LA GARDE N'EST PAS ICI. `resolve_poster_code` ne rend la liste des
 * établissements qu'à qui peut vraiment attribuer, et `assign_poster` repose
 * la question (memberships owner/manager, ou rôle interne borné à ses zones).
 * Cet écran ne fait que RENDRE ce que le serveur a déjà tranché.
 */
/** Un état vide sans issue est un défaut : chacun sort par l'accueil. */
function HomeLink({ label }: { label: string }) {
  return (
    <Link
      to="/"
      className="border-fu-line text-fu-ink inline-flex min-h-11 items-center justify-center rounded-full border px-5 text-fu-sm font-medium"
    >
      {label}
    </Link>
  )
}

/*
 * `<section>` et non `<main>` : la coque consumer fournit déjà le repère
 * `<main id="fu-main">`. Deux `<main>` imbriqués sont du HTML invalide et
 * donnent DEUX repères principaux à un lecteur d'écran — axe ne l'attrape pas
 * sous les étiquettes WCAG AA, mais c'est faux quand même.
 */
export function PosterScanPage() {
  const { t } = useTranslation('v2')
  const { toast } = useToast()
  const { code = '' } = useParams()
  const { session } = useSession()
  useApplySurfaceTheme('consumer')

  const normalized = useMemo(() => code.trim().toUpperCase(), [code])
  const resolution = useResolvePosterCode(normalized.length > 0 ? normalized : undefined)
  const assign = useAssignPoster()
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null)
  const [assigned, setAssigned] = useState<{ slug: string | null; locationId: string } | null>(null)

  const locations = resolution.data?.assignable_locations ?? []

  useEffect(() => {
    // Un seul établissement : pas de choix à faire, mais l'attribution reste
    // un GESTE — on le pré-sélectionne, on ne le déclenche pas.
    const only = locations.length === 1 ? locations[0] : null
    if (only && selectedLocation === null) setSelectedLocation(only.location_id)
  }, [locations, selectedLocation])

  if (resolution.isPending) {
    return (
      <section data-plat2-poster-scan className="mx-auto w-full max-w-md px-4 py-10">
        <SkeletonRect className="h-40 w-full" />
      </section>
    )
  }

  if (resolution.isError) {
    return (
      <section data-plat2-poster-scan className="mx-auto w-full max-w-md px-4 py-10">
        <EmptyState
          title={t('poster.error.title')}
          description={t('poster.error.body')}
          action={<HomeLink label={t('poster.backHome')} />}
        />
      </section>
    )
  }

  const data = resolution.data

  // ATTRIBUÉ : la file du salon, tout de suite. Un écran intermédiaire ferait
  // perdre le temps que l'affiche est censée faire gagner.
  if (data?.state === 'assigned' && data.organization_slug) {
    const target = `/q/${encodeURIComponent(data.organization_slug)}${data.location_id ? `?l=${data.location_id}` : ''}`
    return <Navigate to={target} replace />
  }

  if (assigned?.slug) {
    return <Navigate to={`/q/${encodeURIComponent(assigned.slug)}?l=${assigned.locationId}`} replace />
  }

  if (data?.state === 'unknown') {
    return (
      <section data-plat2-poster-scan className="mx-auto w-full max-w-md px-4 py-10">
        <EmptyState
          title={t('poster.unknown.title')}
          description={t('poster.unknown.body')}
          action={<HomeLink label={t('poster.backHome')} />}
        />
      </section>
    )
  }

  if (data?.state === 'revoked') {
    return (
      <section data-plat2-poster-scan className="mx-auto w-full max-w-md px-4 py-10">
        <EmptyState
          title={t('poster.revoked.title')}
          description={t('poster.revoked.body')}
          action={<HomeLink label={t('poster.backHome')} />}
        />
      </section>
    )
  }

  // ---- état LIBRE ---------------------------------------------------------

  async function handleAssign() {
    if (!selectedLocation) return
    try {
      const result = await assign.mutateAsync({ code: normalized, locationId: selectedLocation })
      toast({ title: t('poster.assign.done'), tone: 'success' })
      setAssigned({ slug: result.organization_slug, locationId: selectedLocation })
    } catch (error) {
      // Le motif nommé, traduit ; jamais le message brut de PostgREST.
      const code = posterRefusalCode(error)
      const known = ['already_assigned', 'revoked', 'location_not_mine', 'unknown_code', 'not_authenticated']
      toast({
        title: t('poster.assign.failed'),
        description: code && known.includes(code) ? t(`poster.assign.refusal.${code}`) : t('poster.error.body'),
        tone: 'error',
      })
    }
  }

  const canAssign = Boolean(data?.can_assign) && locations.length > 0

  return (
    <section data-plat2-poster-scan className="mx-auto w-full max-w-md px-4 py-10">
      <p className="text-fu-muted text-xs tracking-[0.18em] uppercase">{t('poster.codeLabel')}</p>
      <p className="text-fu-ink mt-1 font-mono text-2xl tracking-[0.22em]">{data?.code ?? normalized}</p>

      {canAssign ? (
        <section className="mt-8">
          <h1 className="text-fu-ink text-xl font-semibold">{t('poster.assign.title')}</h1>
          <p className="text-fu-muted mt-2 text-sm">{t('poster.assign.body')}</p>

          {/* MULTI-ÉTABLISSEMENTS : le choix est EXPLICITE. Attribuer au
              « premier » établissement d'un patron qui en a trois collerait
              l'affiche au mauvais mur, et seul un interne pourrait défaire. */}
          <ul className="mt-5 space-y-2">
            {locations.map((location) => {
              const active = selectedLocation === location.location_id
              return (
                <li key={location.location_id}>
                  <button
                    type="button"
                    onClick={() => setSelectedLocation(location.location_id)}
                    aria-pressed={active}
                    className={`border-fu-line w-full rounded-2xl border p-4 text-start ${active ? 'border-fu-accent bg-fu-surface-2' : ''}`}
                  >
                    <span className="text-fu-ink block text-sm font-medium">{location.organization_name}</span>
                    <span className="text-fu-muted block text-sm">
                      {location.location_name}
                      {location.city ? ` · ${location.city}` : ''}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          <Button
            className="mt-6 w-full"
            disabled={!selectedLocation || assign.isPending}
            onClick={() => void handleAssign()}
          >
            {assign.isPending ? t('poster.assign.pending') : t('poster.assign.cta')}
          </Button>
          <p className="text-fu-muted mt-3 text-xs">{t('poster.assign.irreversible')}</p>
        </section>
      ) : (
        <section className="mt-8">
          <EmptyState
            title={t('poster.inactive.title')}
            description={t('poster.inactive.body')}
            action={<HomeLink label={t('poster.backHome')} />}
          />

          {/* LE CROCHET. L'affiche est partie par la poste vers un salon dont
              la fiche est publiée mais NON REVENDIQUÉE : elle devient un
              chemin vers la revendication. C'est le seul endroit où cet écran
              propose quelque chose à quelqu'un qui n'est pas habilité. */}
          {data?.claim?.professional_handle ? (
            <div className="border-fu-line mt-6 rounded-2xl border p-4">
              <p className="text-fu-ink text-fu-sm font-medium">{t('poster.claim.title')}</p>
              <p className="text-fu-muted mt-1 text-fu-sm">
                {t('poster.claim.body', { name: data.claim.display_name ?? data.claim.professional_handle })}
              </p>
              <Link
                to={`/pro/${encodeURIComponent(data.claim.professional_handle)}`}
                className="border-fu-line text-fu-ink mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-full border px-4 text-fu-sm font-medium"
              >
                {t('poster.claim.cta')}
              </Link>
            </div>
          ) : null}

          {/* Un patron déconnecté ne verrait aucune proposition : la liste
              d'établissements n'est rendue qu'à un appelant identifié. Le lui
              dire vaut mieux que de le laisser croire l'affiche morte. */}
          {!session ? <p className="text-fu-muted mt-6 text-xs">{t('poster.inactive.signedOut')}</p> : null}
        </section>
      )}
    </section>
  )
}
