import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RealtimeValue } from '@/components/ui/realtime-value'

function Wrapper({ value, label }: { value: number; label?: string }) {
  return (
    <RealtimeValue value={value} announce={label}>
      <span>{`${value} waiting`}</span>
    </RealtimeValue>
  )
}

describe('RealtimeValue', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('does NOT highlight the first value it is given', () => {
    // A page that lights up every number on arrival has taught the viewer
    // that the highlight means nothing, and by the time a real change lands
    // they have stopped seeing it.
    const { container } = render(<Wrapper value={3} />)
    expect(container.querySelector('[data-realtime-changed]')).toBeNull()
  })

  it('highlights when the value actually changes, then settles back', () => {
    const { container, rerender } = render(<Wrapper value={3} />)

    rerender(<Wrapper value={4} />)
    expect(container.querySelector('[data-realtime-changed="true"]')).not.toBeNull()

    // §20: it settles. A highlight that stays is a highlight that stops
    // meaning "just now".
    act(() => {
      vi.advanceTimersByTime(1300)
    })
    expect(container.querySelector('[data-realtime-changed]')).toBeNull()
  })

  it('does not highlight on a re-render that changes nothing', () => {
    const { container, rerender } = render(<Wrapper value={3} />)
    rerender(<Wrapper value={3} />)
    expect(container.querySelector('[data-realtime-changed]')).toBeNull()
  })

  it('announces the change only when the caller says it is worth interrupting for', () => {
    const { rerender } = render(<Wrapper value={3} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    rerender(<Wrapper value={4} label="Queue changed" />)
    expect(screen.getByRole('status')).toHaveTextContent('Queue changed')
  })

  it('stays silent for a value with no announcement', () => {
    const { rerender } = render(<Wrapper value={3} />)
    rerender(<Wrapper value={9} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
