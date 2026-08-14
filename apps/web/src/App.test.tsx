import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '@/App'

describe('App', () => {
  it('renders the consumer landing at /, leading with finding a barber', async () => {
    render(<App />)

    // The home route is code-split (lazy), so the heading isn't available
    // synchronously after render — wait for the chunk to load.
    const heading = await screen.findByRole('heading', { level: 1 })
    expect(heading.textContent).toContain('Find the barber')
  })
})
