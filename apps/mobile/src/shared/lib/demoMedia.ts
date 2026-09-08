import type { ImageSourcePropType } from 'react-native'

/**
 * D1 — Imagerie de DÉMONSTRATION des établissements (adaptation mobile).
 *
 * Copie ADAPTÉE de apps/web/src/shared/lib/demoMedia.ts (garde anti-dérive :
 * scripts/check-shared-drift.mjs). Différence mesurée et assumée : le web de
 * production ne sert PAS /demo-media (la build déployée est antérieure à
 * D1 — son URL répond le repli HTML de la SPA), et un fichier statique
 * distant n'existe pour aucun média de démonstration. Les fichiers sont
 * donc EMBARQUÉS (assets/demo-media, ~500 Ko), strictement pour les slugs
 * `demo-*` (QA_DATA §5) : une organisation réelle ne peut jamais recevoir
 * une image de démonstration par ce chemin.
 *
 * Retrait : supprimer assets/demo-media/ et ce module (les appelants
 * traitent `null` comme « pas de média », l'état de première classe).
 *
 * Écart re-déclaré : le vrai contrat d'imagerie d'établissement
 * (colonne + bucket + RPC) reste à créer — pont de démonstration, pas une
 * architecture.
 */

const DEMO_BANNERS: Record<string, ImageSourcePropType> = {
  'demo-maison-kais': require('../../../assets/demo-media/banners/demo-maison-kais.jpg'),
  'demo-salon-saint-germain': require('../../../assets/demo-media/banners/demo-salon-saint-germain.jpg'),
  'demo-atelier-fadel': require('../../../assets/demo-media/banners/demo-atelier-fadel.jpg'),
  'demo-sofian-cuts': require('../../../assets/demo-media/banners/demo-sofian-cuts.jpg'),
  'demo-barber-corner': require('../../../assets/demo-media/banners/demo-barber-corner.jpg'),
  'demo-kingsman-levallois': require('../../../assets/demo-media/banners/demo-kingsman-levallois.jpg'),
  'demo-studio-nassim': require('../../../assets/demo-media/banners/demo-studio-nassim.jpg'),
  'demo-braids-fades-defense': require('../../../assets/demo-media/banners/demo-braids-fades-defense.jpg'),
}

/** Les DEUX portraits de démonstration (D1 §2 — deux visages, pas plus). */
const DEMO_AVATARS: Record<string, ImageSourcePropType> = {
  'demo.kais.bellamine.jpg': require('../../../assets/demo-media/avatars/demo.kais.bellamine.jpg'),
  'demo.moussa.diakite.jpg': require('../../../assets/demo-media/avatars/demo.moussa.diakite.jpg'),
}

/** Bannière de démonstration d'une organisation, sinon `null` (cas normal). */
export function demoBanner(organizationSlug: string | null | undefined): ImageSourcePropType | null {
  if (!organizationSlug?.startsWith('demo-')) return null
  return DEMO_BANNERS[organizationSlug] ?? null
}

/**
 * Résout une `avatar_url` de la base vers une source d'image native.
 * La base porte des chemins RELATIFS AU WEB (`/demo-media/avatars/…`) pour
 * le jeu de démonstration : ils sont mappés vers les assets embarqués.
 * Une URL absolue passe telle quelle ; tout autre chemin relatif est
 * irrésoluble depuis l'app → `null`, le monogramme (jamais une URL devinée).
 */
export function resolveMediaSource(url: string | null | undefined): ImageSourcePropType | null {
  if (!url) return null
  const demoAvatar = /^\/demo-media\/avatars\/(.+)$/.exec(url)
  if (demoAvatar?.[1]) return DEMO_AVATARS[demoAvatar[1]] ?? null
  if (/^https?:\/\//.test(url)) return { uri: url }
  return null
}
