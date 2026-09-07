import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { QueueTracking } from '@/features/queue/components/QueueTracking'

describe('QueueTracking — suivre sa place', () => {
  it('montre la position exacte et le nombre devant, jamais l’identité des autres', () => {
    render(
      <QueueTracking
        entry={{ id: 'e1', status: 'waiting', queuePosition: 3 }}
        gone={false}
        organizationName="Side Agency"
        onDismiss={() => {}}
      />,
    )
    expect(screen.getByTestId('queue-track-position')).toHaveTextContent('3')
    expect(screen.getByText(/2 personnes devant|2 people ahead/i)).toBeInTheDocument()
  })

  it('position 1 = « vous êtes le prochain »', () => {
    render(
      <QueueTracking
        entry={{ id: 'e1', status: 'waiting', queuePosition: 1 }}
        gone={false}
        organizationName="Side Agency"
        onDismiss={() => {}}
      />,
    )
    expect(screen.getByText(/prochain|you are next/i)).toBeInTheDocument()
  })

  it('l’appel est le moment orchestré : panneau dédié, assertif, impossible à manquer', () => {
    render(
      <QueueTracking
        entry={{ id: 'e1', status: 'called', queuePosition: null }}
        gone={false}
        organizationName="Side Agency"
        onDismiss={() => {}}
      />,
    )
    const called = screen.getByTestId('queue-track-called')
    expect(called).toHaveAttribute('aria-live', 'assertive')
    expect(called.className).toContain('fu-called')
    expect(screen.getAllByText(/votre tour|your turn/i).length).toBeGreaterThan(0)
  })

  it('sortie de file = état honnête avec une action, pas un cul-de-sac', () => {
    const onDismiss = vi.fn()
    render(<QueueTracking entry={null} gone organizationName="Side Agency" onDismiss={onDismiss} />)
    expect(screen.getByTestId('queue-track-gone')).toBeInTheDocument()
    screen.getByRole('button').click()
    expect(onDismiss).toHaveBeenCalled()
  })
})
