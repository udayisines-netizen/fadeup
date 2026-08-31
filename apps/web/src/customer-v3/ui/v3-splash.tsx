/**
 * FadeUp V3 — the global boot splash: the mark on the product ground,
 * shown only for bootstrap-class waits (router HydrateFallback). One
 * restrained pulse; reduced motion collapses it to a static mark.
 */
import { FadeUpMark } from '@/components/brand/fadeup-mark'
import '@/ui-v3/ui-v3.css'

export function V3Splash() {
  return (
    <div
      data-fu-v3
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--v3-ground)',
      }}
      aria-hidden="true"
    >
      <span className="v3-live-dot" style={{ display: 'none' }} />
      <span style={{ inlineSize: 56, blockSize: 56, animation: 'v3-live 2.4s var(--v3-ease) infinite' }}>
        <FadeUpMark />
      </span>
    </div>
  )
}
