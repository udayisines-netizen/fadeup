import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Switch } from '@/components/ui/switch'
import { TabBar } from '@/components/ui/tab-bar'
import { MemoryRouter } from 'react-router-dom'
import { Compass, User } from 'lucide-react'

/**
 * The two components that CANNOT be fixed by a logical property.
 *
 * `translateX` has no logical form — it always means "toward the physical
 * right" — so the segmented control's sliding indicator and the switch's thumb
 * carry the direction as a multiplier, `calc(var(--fu-dir) * …)`, defined
 * once in index.css as 1 / -1.
 *
 * These assert on the multiplier being present rather than on a computed
 * pixel offset, because jsdom does not apply a stylesheet: what can be proven
 * here is that the components ask for a direction-aware distance instead of a
 * hardcoded one. The value of `--fu-dir` itself is a two-line CSS rule keyed
 * on `[dir='rtl']`, and `<html dir>` is covered by i18n/direction.test.ts.
 *
 * The failure this guards is the quiet one: a `var(--fu-dir, 1)` fallback with
 * no definition behind it looks correct in every left-to-right language and
 * slides the wrong way only in Arabic.
 */
describe('direction-aware motion', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('dir')
  })

  it('moves the segmented indicator by a direction-aware distance', () => {
    const { container } = render(
      <SegmentedControl
        options={[
          { value: 'a', label: 'Morning' },
          { value: 'b', label: 'Afternoon' },
        ]}
        value="b"
        onChange={() => {}}
        ariaLabel="Time of day"
      />,
    )

    const indicator = container.querySelector('[aria-hidden="true"]') as HTMLElement
    expect(indicator.style.transform).toContain('var(--fu-dir)')
    // And no inline fallback: a fallback would mask the token going missing.
    expect(indicator.style.transform).not.toContain('var(--fu-dir, 1)')
    // The offset still tracks the selected index.
    expect(indicator.style.transform).toContain('100%')
  })

  it('anchors the segmented indicator to the inline start, not the left', () => {
    const { container } = render(
      <SegmentedControl
        options={[
          { value: 'a', label: 'Day' },
          { value: 'b', label: 'Week' },
        ]}
        value="a"
        onChange={() => {}}
        ariaLabel="View"
      />,
    )

    const indicator = container.querySelector('[aria-hidden="true"]') as HTMLElement
    expect(indicator.style.insetInlineStart).toBe('0.25rem')
    expect(indicator.style.left).toBe('')
  })

  it('travels the switch thumb toward the inline end', () => {
    const { container } = render(<Switch label="Open now" />)

    const thumb = container.querySelector('.rounded-full.bg-paper-0') as HTMLElement
    expect(thumb.className).toContain('start-0.5')
    expect(thumb.className).toContain('var(--fu-dir)')
    // The physical anchor would put the thumb on the wrong end in Arabic.
    expect(thumb.className).not.toMatch(/(?<![\w-])left-/)
  })

  it('keeps the tab bar a real list of links in both directions', () => {
    // The tab bar is pure flex, which mirrors on its own — this is here so a
    // future absolute-positioned badge or indicator has to prove itself.
    const { container } = render(
      <MemoryRouter>
        <TabBar
          ariaLabel="Primary"
          items={[
            { to: '/a', label: 'Discover', icon: Compass },
            { to: '/b', label: 'Profile', icon: User },
          ]}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
    expect(container.querySelectorAll('a')).toHaveLength(2)
    const physical = container.innerHTML.match(/class="[^"]*(?<![\w-])(?:left|right)-\d/)
    expect(physical, 'the tab bar must not pin anything to a physical edge').toBeNull()
  })
})
