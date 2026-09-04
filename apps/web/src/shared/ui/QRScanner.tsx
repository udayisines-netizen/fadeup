import { useEffect, useRef } from 'react'
import { cn } from '@/shared/lib/cn'

export type QRScanError = 'permission-denied' | 'no-camera' | 'not-supported' | 'unknown'

export interface QRScannerProps {
  onScan: (value: string) => void
  onError: (error: QRScanError) => void
  active: boolean
  className?: string
}

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>
}

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => BarcodeDetectorLike
  }
}

const SCAN_INTERVAL_MS = 250

/**
 * Lecteur QR : `BarcodeDetector` natif quand il existe, repli `jsQR`
 * (importé paresseusement) sinon. Le flux caméra est LIBÉRÉ explicitement au
 * démontage et à la désactivation — une caméra restée ouverte se voit par un
 * voyant sur l'appareil. Usage métier (file, Passport) en P2.
 */
export function QRScanner({ onScan, onError, active, className }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const callbacks = useRef({ onScan, onError })
  callbacks.current = { onScan, onError }

  useEffect(() => {
    if (!active) return

    let cancelled = false
    let stream: MediaStream | null = null
    let timer: number | null = null

    const stop = () => {
      if (timer !== null) window.clearInterval(timer)
      timer = null
      // Libération explicite du flux : chaque piste est arrêtée.
      if (stream) {
        for (const track of stream.getTracks()) track.stop()
        stream = null
      }
      const video = videoRef.current
      if (video) video.srcObject = null
    }

    const fail = (error: QRScanError) => {
      if (!cancelled) callbacks.current.onError(error)
      stop()
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        fail('not-supported')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      } catch (error) {
        if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
          fail('permission-denied')
        } else if (error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'OverconstrainedError')) {
          fail('no-camera')
        } else {
          fail('unknown')
        }
        return
      }
      if (cancelled) {
        stop()
        return
      }

      const video = videoRef.current
      if (!video) {
        stop()
        return
      }
      video.srcObject = stream
      await video.play().catch(() => fail('unknown'))

      if (window.BarcodeDetector) {
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
        timer = window.setInterval(() => {
          void (async () => {
            if (cancelled || video.readyState < 2) return
            try {
              const codes = await detector.detect(video)
              const first = codes[0]
              if (first?.rawValue) callbacks.current.onScan(first.rawValue)
            } catch {
              // Une frame illisible n'est pas une erreur de scanner.
            }
          })()
        }, SCAN_INTERVAL_MS)
        return
      }

      // Repli jsQR — importé seulement si BarcodeDetector n'existe pas.
      const { default: jsQR } = await import('jsqr')
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) {
        fail('not-supported')
        return
      }
      timer = window.setInterval(() => {
        if (cancelled || video.readyState < 2) return
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        if (canvas.width === 0 || canvas.height === 0) return
        context.drawImage(video, 0, 0)
        const image = context.getImageData(0, 0, canvas.width, canvas.height)
        const code = jsQR(image.data, image.width, image.height)
        if (code?.data) callbacks.current.onScan(code.data)
      }, SCAN_INTERVAL_MS)
    }

    void start()

    return () => {
      cancelled = true
      stop()
    }
  }, [active])

  return (
    <video
      ref={videoRef}
      muted
      playsInline
      className={cn('aspect-square w-full rounded-[var(--radius-media)] bg-[var(--fu-surface-subtle)] object-cover', className)}
    />
  )
}
