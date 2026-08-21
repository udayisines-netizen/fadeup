import React from 'react'
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { BORDER, BORDER_STRONG, BRAND, FONT } from './brand'

/**
 * The film's UI kit.
 *
 * These are visual-only recreations of the product surfaces the marketing page
 * already illustrates — not imports from `apps/web`. Importing the real
 * components would drag the router, i18n and the Supabase client into a video
 * renderer that must never touch any of them (brief §17).
 */

/** Rises and fades in on a spring. The film's single entrance gesture. */
export function Enter({
  at,
  children,
  y = 26,
  damping = 200,
}: {
  at: number
  children: React.ReactNode
  y?: number
  damping?: number
}) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = spring({ frame: frame - at, fps, config: { damping } })

  return (
    <div style={{ opacity: t, transform: `translateY(${interpolate(t, [0, 1], [y, 0])}px)` }}>
      {children}
    </div>
  )
}

export function Panel({
  children,
  style,
  elevated,
}: {
  children: React.ReactNode
  style?: React.CSSProperties
  elevated?: boolean
}) {
  return (
    <div
      style={{
        background: elevated ? BRAND.elevated : BRAND.surface,
        border: `1px solid ${BORDER}`,
        borderRadius: 18,
        padding: 28,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: FONT,
        fontSize: 20,
        fontWeight: 500,
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        color: BRAND.mint,
      }}
    >
      {children}
    </div>
  )
}

export function Title({ children, size = 74 }: { children: React.ReactNode; size?: number }) {
  return (
    <div
      style={{
        fontFamily: FONT,
        fontSize: size,
        fontWeight: 600,
        letterSpacing: '-0.028em',
        lineHeight: 1.02,
        color: BRAND.offwhite,
      }}
    >
      {children}
    </div>
  )
}

/** A person, as an initialled disc. Used for every customer in the film. */
export function Avatar({ initials, size = 52 }: { initials: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `linear-gradient(140deg, ${BRAND.emerald}, ${BRAND.mint})`,
        color: '#04120B',
        fontFamily: FONT,
        fontWeight: 700,
        fontSize: size * 0.38,
        letterSpacing: '0.02em',
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  )
}

/** One barber's lane in the Today view. */
export function Lane({
  name,
  status,
  occupant,
  highlight,
}: {
  name: string
  status: string
  occupant?: string
  highlight?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        padding: '18px 22px',
        borderRadius: 14,
        background: highlight ? 'rgba(23, 163, 106, 0.12)' : 'rgba(255,255,255,0.02)',
        border: `1px solid ${highlight ? BORDER_STRONG : BORDER}`,
      }}
    >
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: 5,
          background: highlight ? BRAND.mint : BRAND.sage,
          opacity: highlight ? 1 : 0.4,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: FONT, fontSize: 24, fontWeight: 600, color: BRAND.offwhite }}>{name}</div>
        <div style={{ fontFamily: FONT, fontSize: 19, color: BRAND.sage, marginTop: 4 }}>{status}</div>
      </div>
      {occupant ? <Avatar initials={occupant} size={44} /> : null}
    </div>
  )
}

/** Label above a value — the film's smallest unit of product UI. */
export function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontFamily: FONT,
          fontSize: 17,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'rgba(182,205,190,0.65)',
        }}
      >
        {label}
      </div>
      <div style={{ fontFamily: FONT, fontSize: 30, fontWeight: 600, color: BRAND.offwhite, marginTop: 8 }}>
        {value}
      </div>
    </div>
  )
}

/**
 * The FadeUp mark, redrawn here for the renderer.
 *
 * Same geometry as `apps/web/src/components/brand/fadeup-mark.tsx`; kept as a
 * local copy so this package has no cross-app import.
 */
export function Mark({ size = 96 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <defs>
        <linearGradient id="fu-film-mark" x1="6" y1="42" x2="42" y2="6" gradientUnits="userSpaceOnUse">
          <stop stopColor={BRAND.emerald} />
          <stop offset="1" stopColor={BRAND.mint} />
        </linearGradient>
      </defs>
      <path d="M8 12a6 6 0 0 1 6-6h6v36a6 6 0 0 1-12 0V12Z" fill="url(#fu-film-mark)" />
      <path d="M20 6h14c5 0 8 2.4 8 6s-3 6-8 6H20V6Z" fill="url(#fu-film-mark)" />
      <path d="M20 21h9c4.4 0 7 2.2 7 5.5S33.4 32 29 32h-9V21Z" fill="url(#fu-film-mark)" opacity={0.86} />
    </svg>
  )
}

/**
 * The transition between beats.
 *
 * A single curved emerald→mint sweep travelling left to right, masked to a
 * soft edge. It is the `F` mark's flow turned into a wipe: continuity and
 * direction, which is what the charter asks motion to communicate. No zooms,
 * no spins, no glitch.
 */
export function Sweep({ at, duration = 22 }: { at: number; duration?: number }) {
  const frame = useCurrentFrame()
  const local = frame - at
  if (local < 0 || local > duration) return null

  const progress = local / duration
  const x = interpolate(progress, [0, 1], [-40, 140])

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '-20%',
          left: `${x}%`,
          width: '46%',
          height: '140%',
          transform: 'skewX(-12deg)',
          background: `linear-gradient(90deg, transparent, ${BRAND.emerald}22 30%, ${BRAND.mint}30 55%, transparent)`,
          filter: 'blur(28px)',
        }}
      />
    </div>
  )
}

/** Full-frame ground with the film's one restrained glow. */
export function Stage({ children, sunken }: { children: React.ReactNode; sunken?: boolean }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: sunken ? BRAND.sunken : BRAND.navy,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(46% 42% at 68% 22%, rgba(23,163,106,0.20), transparent 70%)`,
        }}
      />
      <div style={{ position: 'absolute', inset: 0 }}>{children}</div>
    </div>
  )
}
