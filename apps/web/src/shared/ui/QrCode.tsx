import { useEffect, useState } from 'react'
import { cn } from '@/shared/lib/cn'

/**
 * Rendu d'un QR code en image (lib `qrcode`, importée paresseusement — elle
 * ne rejoint jamais le chunk d'entrée consumer). Le QR est toujours encre
 * sur blanc, quel que soit le thème : c'est un objet à scanner et à
 * imprimer, pas un élément d'interface à thémer.
 */

export interface QrCodeProps {
  /** La valeur encodée — pour la file, l'URL /q/:slug?l=…&t=…. */
  value: string
  /** Libellé accessible de l'image. */
  label: string
  className?: string
}

export function QrCode({ value, label, className }: QrCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // L'encre vient du token (--fu-accent-fg = encre dans TOUS les thèmes,
    // gardé par check-fu-palette) ; le papier est blanc — un QR se scanne et
    // s'imprime, il n'est pas thémé.
    const ink = getComputedStyle(document.body).getPropertyValue('--fu-accent-fg').trim() || '#000'
    void import('qrcode').then(async (QRCode) => {
      const url = await QRCode.toDataURL(value, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 768,
        color: { dark: ink, light: '#fff' },
      })
      if (!cancelled) setDataUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [value])

  if (!dataUrl) {
    return <div aria-hidden="true" className={cn('aspect-square animate-pulse rounded-[var(--radius-media)] bg-[var(--fu-surface-hover)]', className)} />
  }

  return <img src={dataUrl} alt={label} className={cn('fu-poster aspect-square rounded-[var(--radius-media)]', className)} />
}
