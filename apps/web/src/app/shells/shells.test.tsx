import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from '@/shared/theme/ThemeProvider'
import { MarketingShell } from '@/app/shells/MarketingShell'
import { PlatformShell } from '@/app/shells/PlatformShell'

/**
 * Les shells Consumer et Pro sont vérifiés en vrai navigateur (Playwright,
 * données réelles) ; ici on prouve que les deux shells « éditoriaux »
 * rendent, avec le BON thème posé sur <body> — PlatformShell n'étant monté
 * sur aucune route de production tant que P5 n'existe pas.
 */
function mount(shell: React.ReactElement) {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <Routes>
          <Route element={shell}>
            <Route index element={<p>contenu</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  )
}

afterEach(() => {
  document.body.removeAttribute('data-theme')
})

describe('shells', () => {
  it('MarketingShell rend avec le thème editorial', () => {
    mount(<MarketingShell />)
    expect(document.body.getAttribute('data-theme')).toBe('editorial')
    expect(screen.getByText('contenu')).toBeInTheDocument()
  })

  it('PlatformShell rend avec le thème editorial et son en-tête', () => {
    mount(<PlatformShell />)
    expect(document.body.getAttribute('data-theme')).toBe('editorial')
    expect(screen.getByText('contenu')).toBeInTheDocument()
  })

  it('le thème est retiré du <body> quand le shell se démonte (retour au legacy)', () => {
    // Le provider reste monté (comme dans l'app réelle) — seul le shell part.
    const { rerender } = render(
      <ThemeProvider>
        <MemoryRouter>
          <Routes>
            <Route element={<MarketingShell />}>
              <Route index element={<p>contenu</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    )
    expect(document.body.getAttribute('data-theme')).toBe('editorial')
    rerender(
      <ThemeProvider>
        <MemoryRouter>
          <p>vide</p>
        </MemoryRouter>
      </ThemeProvider>,
    )
    expect(document.body.getAttribute('data-theme')).toBeNull()
  })
})
