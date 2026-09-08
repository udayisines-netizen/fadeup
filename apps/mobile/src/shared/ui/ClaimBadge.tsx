import { useTranslation } from 'react-i18next'
import { Badge } from '@/shared/ui/Badge'

/**
 * Revendication — un profil non revendiqué reste NEUTRE : « Pas encore géré
 * sur FadeUp », jamais de rouge, jamais une alerte (loi produit §2).
 */
export function ClaimBadge({ short = false }: { short?: boolean }) {
  const { t } = useTranslation('v2')
  return (
    <Badge
      variant="neutral"
      label={short ? t('states.claim.unclaimedShort') : t('states.claim.unclaimed')}
    />
  )
}
