import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { MarketplaceHomePage } from '@/pages/marketplace-home-page'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

function renderPage() {
  return render(
    <MemoryRouter>
      <MarketplaceHomePage />
    </MemoryRouter>,
  )
}

describe('MarketplaceHomePage', () => {
  it('renders the consumer-first discovery hero, not a SaaS pitch', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Find your next barber.' })).toBeInTheDocument()
  })

  it('submits a city search and navigates to /search with the query encoded in the URL', () => {
    renderPage()

    fireEvent.change(screen.getByLabelText('Where?'), { target: { value: 'Paris' } })
    fireEvent.click(screen.getByRole('button', { name: 'Find a barber' }))

    expect(mockNavigate).toHaveBeenCalledWith('/search?city=Paris')
  })

  it('submits a popular-service shortcut immediately without requiring the form button', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Fade' }))

    expect(mockNavigate).toHaveBeenCalledWith('/search?q=Fade')
  })
})
