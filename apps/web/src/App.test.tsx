import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '@/App'

describe('App', () => {
  it('renders the FadeUp marketing home page at /', async () => {
    render(<App />)

    // The home route is code-split (lazy), so the heading isn't available
    // synchronously after render — wait for the chunk to load.
    expect(
      await screen.findByRole('heading', { name: 'The operating system for modern barbershops.' }),
    ).toBeInTheDocument()
  })
})
