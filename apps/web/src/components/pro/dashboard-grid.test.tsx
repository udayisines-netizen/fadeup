import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DashboardGrid, type DashboardItem } from '@/components/pro/dashboard-grid'
import {
  DASHBOARD_MODULES,
  canEditDashboardLayout,
  reconcileLayout,
} from '@/lib/queries/dashboard-layout'

const items: DashboardItem[] = [
  { key: 'focus', label: 'Now & next', content: <button type="button">complete</button> },
  { key: 'queue', label: 'Queue', content: <p>queue</p> },
  { key: 'social', label: 'Social performance', content: <p>social</p> },
]

function renderGrid(overrides: Partial<Parameters<typeof DashboardGrid>[0]> = {}) {
  return render(
    <DashboardGrid
      items={items}
      order={['focus', 'queue', 'social']}
      editing={false}
      onReorder={vi.fn()}
      {...overrides}
    />,
  )
}

describe('reconcileLayout', () => {
  it('falls back to the product default when a shop has never rearranged anything', () => {
    expect(reconcileLayout(null)).toEqual([...DASHBOARD_MODULES])
  })

  it('drops a stored key this build no longer has', () => {
    // A module renamed or removed in a later lot leaves every shop that had
    // arranged it holding a key nothing renders.
    const result = reconcileLayout(['queue', 'a_module_that_was_removed', 'focus'])
    expect(result).not.toContain('a_module_that_was_removed')
    expect(result.slice(0, 2)).toEqual(['queue', 'focus'])
  })

  it('appends a module that did not exist when the layout was saved', () => {
    // Otherwise a shop that arranged its dashboard last year would never see
    // anything added since, and would have no way to discover why.
    const result = reconcileLayout(['queue'])
    expect(result[0]).toBe('queue')
    for (const module of DASHBOARD_MODULES) expect(result).toContain(module)
  })

  it('never yields a duplicate, whatever the stored array says', () => {
    const result = reconcileLayout(['queue', 'queue', 'focus'])
    expect(new Set(result).size).toBe(result.length)
  })
})

describe('canEditDashboardLayout', () => {
  it('is owner and manager only — the roles that own shop configuration', () => {
    expect(canEditDashboardLayout('owner')).toBe(true)
    expect(canEditDashboardLayout('manager')).toBe(true)
    expect(canEditDashboardLayout('receptionist')).toBe(false)
    expect(canEditDashboardLayout('barber')).toBe(false)
    expect(canEditDashboardLayout(undefined)).toBe(false)
  })
})

describe('DashboardGrid', () => {
  it('renders modules in the shop’s saved order, not the source order', () => {
    renderGrid({ order: ['social', 'focus', 'queue'] })
    const sections = document.querySelectorAll('section')
    expect(sections[0]?.textContent).toContain('social')
    expect(sections[1]?.textContent).toContain('complete')
  })

  it('is completely static until rearranging is turned on', () => {
    // §24: no accidental reorder on a simple click or touch. Outside the mode
    // there is nothing to grab and nothing to press.
    renderGrid()
    expect(screen.queryByRole('button', { name: /move/i })).not.toBeInTheDocument()
    expect(document.querySelector('[draggable="true"]')).toBeNull()
  })

  it('gives every card a real keyboard path, named for THAT card', () => {
    // Six pairs of buttons all called "Move up" is unusable with a screen
    // reader — there is no way to tell which pair belongs to which card.
    renderGrid({ editing: true })
    expect(screen.getByRole('button', { name: 'Move Queue up' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move Social performance down' })).toBeInTheDocument()
  })

  it('cannot move the first card up or the last card down', () => {
    renderGrid({ editing: true })
    expect(screen.getByRole('button', { name: 'Move Now & next up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Social performance down' })).toBeDisabled()
  })

  it('reorders through the same function the drag uses', () => {
    const onReorder = vi.fn()
    renderGrid({ editing: true, onReorder })

    fireEvent.click(screen.getByRole('button', { name: 'Move Queue up' }))

    expect(onReorder).toHaveBeenCalledWith(['queue', 'focus', 'social'])
  })

  it('announces where the card landed', () => {
    // Silence after a keyboard move leaves a screen reader user with no idea
    // whether anything happened.
    renderGrid({ editing: true })
    fireEvent.click(screen.getByRole('button', { name: 'Move Queue up' }))
    expect(screen.getByText('Queue moved to position 1 of 3')).toBeInTheDocument()
  })

  it('makes card contents inert while rearranging', () => {
    // A dashboard where you can accidentally complete an appointment while
    // trying to pick a card up is worse than one you cannot rearrange.
    const { container } = renderGrid({ editing: true })
    const inertWrapper = container.querySelector('[inert]')
    expect(inertWrapper).not.toBeNull()
    expect(inertWrapper?.textContent).toContain('complete')
  })
})
