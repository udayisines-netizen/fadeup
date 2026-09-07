/**
 * Ré-export de compatibilité — F2 a déplacé QueueList vers shared/ui pour
 * que le profil salon (organization-profile) l'affiche sans importer
 * features/queue (interdit par le lint). Même motif que les ré-exports F1
 * (organisation, waitTime, queueLink).
 */
export { QueueList, queueDisplayName } from '@/shared/ui/QueueList'
