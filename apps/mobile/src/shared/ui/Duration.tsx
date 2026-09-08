import { useTranslation } from 'react-i18next'
import { formatDuration } from '@/shared/lib/format'
import { MonoText, type MonoTextProps } from '@/shared/ui/MonoText'

/** Durée de service — mono, « 45 min » / « 1 h 15 », jamais « 75 min ». */
export interface DurationProps extends Omit<MonoTextProps, 'children'> {
  minutes: number
}

export function Duration({ minutes, ...rest }: DurationProps) {
  const { i18n } = useTranslation('v2')
  return (
    <MonoText tone="secondary" {...rest}>
      {formatDuration(minutes, i18n.language)}
    </MonoText>
  )
}
