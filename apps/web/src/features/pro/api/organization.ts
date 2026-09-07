/**
 * Déplacé vers `shared/data/organization.ts` en F1 : le contexte
 * organisation est consommé par le shell ET plusieurs features pro, et une
 * feature n'importe jamais une autre feature. Ré-export de compatibilité.
 */
export {
  useProOrganization,
  useProEntitlements,
  type ProOrganization,
  type ProEntitlements,
} from '@/shared/data/organization'
