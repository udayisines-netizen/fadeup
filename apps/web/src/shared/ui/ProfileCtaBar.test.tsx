import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ProfileCtaBar } from '@/shared/ui/ProfileCtaBar'
import type { ProfileCtaState } from '@/shared/lib/serviceState'

function renderBar(cta: ProfileCtaState, extra: Partial<Parameters<typeof ProfileCtaBar>[0]> = {}) {
  return render(
    <MemoryRouter>
      <ProfileCtaBar
        cta={cta}
        name="Kaïs Bellamine"
        bookTo="/book/x"
        queueTo="/q/x"
        timezone="Europe/Paris"
        following={false}
        onToggleFollow={vi.fn()}
        {...extra}
      />
    </MemoryRouter>,
  )
}

describe('ProfileCtaBar — Book dominant, Follow secondaire, état RÉEL', () => {
  it('bookable : RÉSERVER actif, vert plein (variant primary)', () => {
    renderBar({ kind: 'bookable', queueOpen: false, temporaryUntil: null })
    const book = screen.getByTestId('profile-book-cta')
    expect(book).toBeEnabled()
    // Le vert plein encre est la classe du variant primary (indice color: —
    // sans lui tailwind-merge écrasait la couleur, voir Button.tsx).
    expect(book.className).toContain('bg-[var(--fu-accent)]')
    expect(book.className).toContain('text-[color:var(--fu-accent-fg)]')
  })

  it('Follow n’est JAMAIS vert plein — l’écart est structurel', () => {
    renderBar({ kind: 'bookable', queueOpen: true, temporaryUntil: null })
    const follow = screen.getByTestId('profile-follow-cta')
    expect(follow.className).not.toContain('bg-[var(--fu-accent)]')
    expect(follow.className).toContain('border')
  })

  it('file seule ouverte : l’alternative réelle « Rejoindre la file »', () => {
    renderBar({ kind: 'queue-only', queueOpen: true, temporaryUntil: null })
    const book = screen.getByTestId('profile-book-cta')
    expect(book).toBeEnabled()
    expect(book.textContent).toMatch(/queue|file/i)
  })

  it('fermé : RÉSERVER désactivé, la note dit l’état réel', () => {
    renderBar({ kind: 'closed', queueOpen: false, temporaryUntil: null })
    expect(screen.getByTestId('profile-book-cta')).toBeDisabled()
    expect(screen.getByTestId('cta-note')).toBeInTheDocument()
  })

  it('état inconnu : désactivé, jamais un état inventé', () => {
    renderBar({ kind: 'unknown', queueOpen: false, temporaryUntil: null })
    expect(screen.getByTestId('profile-book-cta')).toBeDisabled()
    expect(screen.getByTestId('cta-note').textContent).toMatch(/could not be checked|n'a pas pu/i)
  })

  it('mode temporaire : l’échéance est affichée dans le fuseau du lieu', () => {
    renderBar({ kind: 'bookable', queueOpen: false, temporaryUntil: '2026-09-08T16:00:00Z' })
    expect(screen.getByTestId('cta-note').textContent).toMatch(/until|jusqu/i)
  })

  it('la note du cas non revendiqué remplace la note dérivée', () => {
    renderBar(
      { kind: 'closed', queueOpen: false, temporaryUntil: null },
      { noteOverride: 'Booking opens once claimed' },
    )
    expect(screen.getByTestId('cta-note').textContent).toContain('Booking opens once claimed')
  })

  it('suivi : le bouton reflète l’état et reste secondaire', () => {
    renderBar({ kind: 'bookable', queueOpen: false, temporaryUntil: null }, { following: true })
    const follow = screen.getByTestId('profile-follow-cta')
    expect(follow).toHaveAttribute('aria-pressed', 'true')
    expect(follow.className).not.toContain('bg-[var(--fu-accent)]')
  })
})
