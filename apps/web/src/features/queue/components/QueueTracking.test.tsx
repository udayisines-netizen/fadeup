import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { QueueTracking } from '@/features/queue/components/QueueTracking'
import type { QueueEntryTracking } from '@/features/queue/api/publicQueue'

const noop = () => {}

function entryOf(overrides: Partial<QueueEntryTracking>): QueueEntryTracking {
  return {
    id: 'e1',
    status: 'waiting',
    barber_id: null,
    barber_display_name: null,
    queue_position: null,
    people_ahead: null,
    called_deadline_at: null,
    estimated_wait_minutes: null,
    removed_automatically: false,
    ...overrides,
  }
}

function renderTracking(entry: QueueEntryTracking | null, extra: Partial<Parameters<typeof QueueTracking>[0]> = {}) {
  return render(
    <QueueTracking
      entry={entry}
      gone={false}
      organizationName="Side Agency"
      queues={[]}
      busy={false}
      onLeave={noop}
      onChangeBarber={noop}
      onDismiss={noop}
      {...extra}
    />,
  )
}

describe('QueueTracking — suivre sa place (F1b)', () => {
  it('montre la position exacte dans SA file et le nombre devant, jamais l’identité des autres', () => {
    renderTracking(entryOf({ queue_position: 3, people_ahead: 2 }))
    expect(screen.getByTestId('queue-track-position')).toHaveTextContent('3')
    expect(screen.getByText(/2 personnes devant|2 people ahead/i)).toBeInTheDocument()
  })

  it('position 1 = « vous êtes le prochain »', () => {
    renderTracking(entryOf({ queue_position: 1, people_ahead: 0 }))
    expect(screen.getByText(/prochain|you are next/i)).toBeInTheDocument()
  })

  it('l’estimation ne s’affiche QUE si la base en fournit une (jamais inventée), arrondie à 5', () => {
    renderTracking(entryOf({ queue_position: 3, people_ahead: 2, estimated_wait_minutes: null }))
    expect(screen.queryByTestId('queue-track-wait')).not.toBeInTheDocument()
  })

  it('estimation fournie : affichée au pas de cinq minutes', () => {
    renderTracking(entryOf({ queue_position: 3, people_ahead: 2, estimated_wait_minutes: 22 }))
    expect(screen.getByTestId('queue-track-wait')).toHaveTextContent('25')
  })

  it('l’appel est le moment orchestré : panneau dédié, assertif, impossible à manquer', () => {
    renderTracking(entryOf({ status: 'called' }))
    const called = screen.getByTestId('queue-track-called')
    expect(called).toHaveAttribute('aria-live', 'assertive')
    expect(called.className).toContain('fu-called')
    expect(screen.getAllByText(/votre tour|your turn/i).length).toBeGreaterThan(0)
  })

  it('AUCUNE minute sans échéance : appelé sans called_deadline_at = pas de compte à rebours', () => {
    renderTracking(entryOf({ status: 'called', called_deadline_at: null }))
    expect(screen.queryByTestId('queue-track-deadline')).not.toBeInTheDocument()
    expect(screen.queryByTestId('queue-track-deadline-passed')).not.toBeInTheDocument()
  })

  it('échéance à venir : compte à rebours affiché', () => {
    renderTracking(entryOf({ status: 'called', called_deadline_at: new Date(Date.now() + 4 * 60_000).toISOString() }))
    expect(screen.getByTestId('queue-track-deadline')).toBeInTheDocument()
  })

  it('échéance DÉPASSÉE : jamais de valeur négative — « le salon décide »', () => {
    renderTracking(entryOf({ status: 'called', called_deadline_at: new Date(Date.now() - 60_000).toISOString() }))
    expect(screen.queryByTestId('queue-track-deadline')).not.toBeInTheDocument()
    expect(screen.getByTestId('queue-track-deadline-passed')).toBeInTheDocument()
    expect(screen.getByTestId('queue-track-deadline-passed').textContent).not.toMatch(/-\d/)
  })

  it('sortie AUTOMATIQUE (balayage) : message sans reproche, distinct du retrait manuel', () => {
    renderTracking(entryOf({ status: 'no_show', removed_automatically: true }))
    const ended = screen.getByTestId('queue-track-ended-removedAuto')
    expect(ended.textContent).toMatch(/délai|window/i)
    expect(ended.textContent).not.toMatch(/pas venu|did not show|no-show/i)
  })

  it('retrait manuel : formulation différente de la sortie automatique', () => {
    renderTracking(entryOf({ status: 'no_show', removed_automatically: false }))
    expect(screen.getByTestId('queue-track-ended-removedManual')).toBeInTheDocument()
  })

  it('quitter la file = état honnête avec une action, pas un cul-de-sac', () => {
    renderTracking(entryOf({ status: 'cancelled' }))
    expect(screen.getByTestId('queue-track-ended-left')).toBeInTheDocument()
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('« Changer de barber » n’apparaît QUE s’il y a plusieurs files — et jamais en proposition automatique', () => {
    renderTracking(entryOf({ queue_position: 2, people_ahead: 1 }))
    expect(screen.queryByTestId('queue-track-change')).not.toBeInTheDocument()
  })

  it('avec plusieurs files : le bouton existe, à l’initiative du client', () => {
    renderTracking(entryOf({ queue_position: 2, people_ahead: 1 }), {
      queues: [
        { barber_id: null, display_name: null, avatar_url: null, waiting_count: 1, busy: false, estimated_wait_minutes: null },
        { barber_id: 'b2', display_name: 'Amine', avatar_url: null, waiting_count: 0, busy: false, estimated_wait_minutes: null },
      ],
    })
    expect(screen.getByTestId('queue-track-change')).toBeInTheDocument()
  })

  it('déplacé par le salon : l’écran le dit, avec le nom de la nouvelle file', () => {
    const props = {
      gone: false,
      organizationName: 'Side Agency',
      queues: [],
      busy: false,
      onLeave: noop,
      onChangeBarber: noop,
      onDismiss: vi.fn(),
    }
    const { rerender } = render(
      <QueueTracking {...props} entry={entryOf({ queue_position: 2, people_ahead: 1, barber_id: null })} />,
    )
    rerender(
      <QueueTracking
        {...props}
        entry={entryOf({ queue_position: 1, people_ahead: 0, barber_id: 'b2', barber_display_name: 'Amine' })}
      />,
    )
    expect(screen.getByTestId('queue-track-moved')).toHaveTextContent(/Amine/)
  })

  it('entrée disparue = état honnête avec une action', () => {
    const onDismiss = vi.fn()
    render(
      <QueueTracking
        entry={null}
        gone
        organizationName="Side Agency"
        queues={[]}
        busy={false}
        onLeave={noop}
        onChangeBarber={noop}
        onDismiss={onDismiss}
      />,
    )
    expect(screen.getByTestId('queue-track-gone')).toBeInTheDocument()
    screen.getByRole('button').click()
    expect(onDismiss).toHaveBeenCalled()
  })
})
