import { useLocalSearchParams } from 'expo-router'

import { BookingFlowScreen } from '@/features/booking/BookingFlowScreen'
import { InterestRequestScreen } from '@/features/booking/InterestRequestScreen'

/**
 * M1b — la porte de la réservation.
 *
 * Deux destinations derrière UNE route, parce que la cible décide :
 *
 *  - cible normale (organisation active) → LE tunnel (`BookingFlowScreen`),
 *    dont l'état vit dans les paramètres `s`, `b`, `d`, `t`, `l` ;
 *  - cible NON revendiquée → la demande d'intérêt (`?pro=<handle>`), qui ne
 *    retient aucun créneau et n'affirme aucune disponibilité (F4 §6, B2).
 *    Le web y entre par sa propre route `/request/:handle` ; en natif le
 *    paramètre suffit et évite d'ouvrir une seconde route publique hors du
 *    périmètre de ce lot.
 */
export default function BookRoute() {
  const { pro } = useLocalSearchParams<{ pro?: string }>()
  const handle = (Array.isArray(pro) ? pro[0] : pro) ?? ''
  if (handle !== '') return <InterestRequestScreen handle={handle} />
  return <BookingFlowScreen />
}
