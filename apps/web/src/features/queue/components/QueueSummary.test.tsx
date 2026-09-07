import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { QueueSummary } from '@/features/queue/components/QueueSummary'

describe('QueueSummary — la réponse de /q/:slug', () => {
  it('affiche le nombre réel de personnes en attente', () => {
    render(<QueueSummary waitingCount={4} queueState="open" estimatedWaitMinutes={null} />)
    expect(screen.getByTestId('queue-waiting-count')).toHaveTextContent('4')
  })

  it('une file vide est une file vide — zéro affiché, rien de fabriqué', () => {
    render(<QueueSummary waitingCount={0} queueState="open" estimatedWaitMinutes={null} />)
    expect(screen.getByTestId('queue-waiting-count')).toHaveTextContent('0')
  })

  it('AUCUNE minute affichée quand la base ne fournit pas de temps fiable', () => {
    render(<QueueSummary waitingCount={7} queueState="open" estimatedWaitMinutes={null} />)
    expect(screen.queryByTestId('queue-estimated-wait')).not.toBeInTheDocument()
  })

  it('affiche l’estimation UNIQUEMENT quand elle est fournie et valide', () => {
    render(<QueueSummary waitingCount={7} queueState="open" estimatedWaitMinutes={25} />)
    expect(screen.getByTestId('queue-estimated-wait')).toHaveTextContent('25')
  })

  it('une estimation invalide est traitée comme absente', () => {
    render(<QueueSummary waitingCount={7} queueState="open" estimatedWaitMinutes={Number.NaN} />)
    expect(screen.queryByTestId('queue-estimated-wait')).not.toBeInTheDocument()
  })

  it('état fermé et état inconnu sont distincts — jamais un état inventé', () => {
    const { rerender } = render(<QueueSummary waitingCount={0} queueState="closed" estimatedWaitMinutes={null} />)
    expect(screen.getByText(/fermée|closed/i)).toBeInTheDocument()
    rerender(<QueueSummary waitingCount={0} queueState="unknown" estimatedWaitMinutes={null} />)
    expect(screen.getByText(/partielles|partial/i)).toBeInTheDocument()
  })
})
