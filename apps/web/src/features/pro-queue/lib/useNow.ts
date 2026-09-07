/**
 * Déplacé vers shared/hooks (F1b) : la face client a désormais son propre
 * compte à rebours (échéance d'appel) et `features/X` n'importe jamais
 * `features/Y`. Ré-export de compatibilité.
 */
export { useNow } from '@/shared/hooks/useNow'
