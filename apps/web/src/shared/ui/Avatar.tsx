import * as RadixAvatar from '@radix-ui/react-avatar'
import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'

export interface AvatarProps {
  name: string
  src?: string | null
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

const SIZES = { sm: 'size-8 text-fu-xs', md: 'size-10 text-fu-sm', lg: 'size-14 text-fu-base', xl: 'size-20 text-fu-lg' } as const

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.charAt(0) ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : ''
  return (first + last).toUpperCase() || '•'
}

/**
 * Déterministe : la même personne a toujours le même fond. Palette dérivée
 * des tokens (surface douce / bordure), pas de silhouette générique.
 */
function hueOf(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % 360
}

export function Avatar({ name, src, size = 'md', className }: AvatarProps) {
  const { t } = useTranslation('v2')
  const hue = hueOf(name)
  return (
    <RadixAvatar.Root
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-[var(--radius-avatar)] align-middle',
        SIZES[size],
        className,
      )}
    >
      {src ? <RadixAvatar.Image src={src} alt={name} className="size-full object-cover" /> : null}
      <RadixAvatar.Fallback
        aria-label={t('states.avatar.fallback', { name })}
        // --fu-accent-fg est l'encre dans les trois thèmes — lisible sur le
        // pastel clair même en Pro sombre.
        className="flex size-full items-center justify-center font-semibold text-[var(--fu-accent-fg)]"
        style={{ backgroundColor: `oklch(0.92 0.05 ${hue})` }}
      >
        {initialsOf(name)}
      </RadixAvatar.Fallback>
    </RadixAvatar.Root>
  )
}
