import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '@/shared/ui/Button'

describe('Button', () => {
  it('rend les quatre variantes', () => {
    for (const variant of ['primary', 'secondary', 'tertiary', 'destructive'] as const) {
      const { unmount } = render(<Button variant={variant}>Go</Button>)
      expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument()
      unmount()
    }
  })

  it('loading implique disabled — l’inverse est faux', () => {
    const { rerender } = render(<Button loading>Go</Button>)
    expect(screen.getByRole('button')).toBeDisabled()
    rerender(<Button disabled>Go</Button>)
    const disabledOnly = screen.getByRole('button')
    expect(disabledOnly).toBeDisabled()
    expect(disabledOnly).not.toHaveAttribute('data-loading')
  })

  it('en chargement, le libellé garde sa boîte (largeur stable) et le spinner recouvre', () => {
    render(<Button loading>Réserver</Button>)
    const button = screen.getByRole('button')
    // Le libellé reste dans le DOM (invisible), donc la largeur ne saute pas.
    expect(button).toHaveTextContent('Réserver')
    expect(button.querySelector('svg')).not.toBeNull()
  })

  it('clic bloqué quand disabled, actif au clavier sinon', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const { rerender } = render(<Button onClick={onClick} disabled>Go</Button>)
    await user.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()

    rerender(<Button onClick={onClick}>Go</Button>)
    screen.getByRole('button').focus()
    await user.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('type par défaut = button (jamais submit implicite)', () => {
    render(<Button>Go</Button>)
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
  })

  it('expose ref comme prop normale (React 19)', () => {
    const ref = { current: null as HTMLButtonElement | null }
    render(<Button ref={(node) => { ref.current = node }}>Go</Button>)
    expect(ref.current).toBeInstanceOf(HTMLButtonElement)
  })
})
