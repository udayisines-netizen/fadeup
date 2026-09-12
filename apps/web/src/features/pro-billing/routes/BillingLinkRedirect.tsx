import { Navigate, useLocation } from 'react-router-dom'

/**
 * OS-3 — `/pro/billing` n'a jamais été servi par une route, et pourtant il
 * circule DÉJÀ : les relances de grâce de B3 le mettent dans leur corps
 * (`payload.billing_url = https://fade-up.com/pro/billing`) et les URL de
 * retour par défaut de la fonction Edge Stripe pointent dessus. Un
 * professionnel qui cliquait dans son e-mail d'échec de paiement tombait sur
 * une page « pas encore construite ».
 *
 * La redirection préserve la CHAÎNE DE REQUÊTE : sans elle,
 * `?checkout=success` serait perdu au retour du Checkout et l'écran ne saurait
 * pas rafraîchir. Corrigé ici plutôt que dans le gabarit d'e-mail, parce que
 * les e-mails déjà envoyés portent l'ancien lien pour toujours.
 */
export function BillingLinkRedirect() {
  const location = useLocation()
  return <Navigate to={{ pathname: '/dashboard/billing', search: location.search }} replace />
}
