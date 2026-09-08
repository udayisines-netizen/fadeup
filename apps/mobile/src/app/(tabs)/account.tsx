import { AccountScreen } from '@/features/account/AccountScreen'

/**
 * Compte — l'écran vit dans `features/account` comme les autres surfaces
 * (accueil, recherche, profils) ; la route n'est que le point de montage.
 * Le sélecteur de langue de M1a est PRÉSERVÉ, à sa place dans l'ordre de
 * l'écran, et reste réglable sans compte.
 */
export default function AccountTab() {
  return <AccountScreen />
}
