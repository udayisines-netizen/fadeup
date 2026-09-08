/**
 * D1 — Imagerie de DÉMONSTRATION des établissements.
 *
 * Aucun contrat d'imagerie d'établissement n'existe en base (aucune colonne
 * sur organizations/locations — mesuré en D1). Les bannières du jeu de
 * démonstration vivent donc dans `public/demo-media/banners/` et sont
 * résolues ici, STRICTEMENT pour les slugs `demo-*` (la convention de
 * marquage QA_DATA §5) : une organisation réelle ne peut jamais recevoir
 * une image de démonstration par ce chemin.
 *
 * Retrait : supprimer `public/demo-media/` et ce module (les appelants
 * traitent `null` comme « pas de média », l'état de première classe).
 *
 * Écart déclaré pour M1a : le vrai contrat d'imagerie d'établissement
 * (colonne + bucket + RPC) reste à créer ; ce registre est un pont de
 * démonstration, pas une architecture.
 */

const DEMO_BANNER_SLUGS = new Set([
  'demo-maison-kais',
  'demo-salon-saint-germain',
  'demo-atelier-fadel',
  'demo-sofian-cuts',
  'demo-barber-corner',
  'demo-kingsman-levallois',
  'demo-studio-nassim',
  'demo-braids-fades-defense',
])

/** Bannière de démonstration d'une organisation, sinon `null` (cas normal). */
export function demoBanner(organizationSlug: string | null | undefined): string | null {
  if (!organizationSlug?.startsWith('demo-')) return null
  return DEMO_BANNER_SLUGS.has(organizationSlug)
    ? `/demo-media/banners/${organizationSlug}.jpg`
    : null
}
