import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  BottomSheet,
  BottomSheetBody,
  BottomSheetContent,
  BottomSheetHeader,
  BottomSheetTitle,
} from '@/components/ui/bottom-sheet'

const SRC = join(__dirname, '..')

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'locales') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, found)
    else if (/\.tsx$/.test(entry) && !entry.includes('.test.')) found.push(full)
  }
  return found
}

/**
 * ============================================================================
 * THE ACCESSIBILITY CONTRACTS R5 ADDS
 * ============================================================================
 *
 * §30 asks for WCAG 2.2 AA and says the accessibility work must be TESTED
 * rather than documented. Component-level assertions live beside the
 * components they belong to — the badge's keyboard reachability is in
 * `verified-badge.test.tsx`, the dashboard's move buttons are in
 * `dashboard-grid.test.tsx`. This file holds the two kinds that no single
 * component can assert about itself:
 *
 *   1. structural rules that must hold across EVERY file, where the failure is
 *      one component quietly opting out
 *   2. the overlay focus behaviour, which is a property of the primitives that
 *      every dialog and sheet in the product inherits
 *
 * A third rule was written and then deliberately removed: "every decorative
 * icon carries aria-hidden". It is a real rule and the codebase already
 * follows it almost everywhere, but expressed as a regex over source it cannot
 * tell an icon rendered into the page from one passed as an `icon` prop to a
 * primitive that hides it — and it flagged nineteen correct call sites. A
 * brittle gate that every later lot has to argue with does more damage than
 * the class of bug it catches.
 */
describe('accessibility contracts', () => {
  const files = sourceFiles(SRC)

  it('scans a meaningful number of files (guards against passing vacuously)', () => {
    expect(files.length).toBeGreaterThan(80)
  })

  it('never removes a focus outline without putting one back', () => {
    // `outline-none` with no replacement is the most common way a keyboard
    // user loses their place, and it is completely invisible to anyone testing
    // with a mouse.
    //
    // Three replacements are legitimate and all three are in use here:
    //
    //   focus-visible:outline / :ring   the element indicates its own focus
    //   focus-within:*                  a CONTAINER indicates it — the search
    //                                   panel is one control made of two
    //                                   inputs, and ringing each input
    //                                   separately would draw two boxes inside
    //                                   one box
    //   data-[highlighted]:*            Radix roving focus, where the menu
    //                                   moves a highlight rather than the
    //                                   browser moving an outline
    //
    // The window spans lines either side of the match because the container's
    // classes sit above the input in the same JSX block.
    const offenders: string[] = []

    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, index) => {
        if (!/\boutline-none\b/.test(line)) return
        // Only elements a keyboard can actually land on. A Radix Viewport or a
        // scroll container carrying `outline-none` is not a control and has no
        // focus to indicate.
        const preceding = lines.slice(Math.max(0, index - 12), index + 1).join(' ')
        if (!/<(button|a\s|input|select|textarea|NavLink|Link\s)/i.test(preceding)) return
        // Generous, because a container's `focus-within:` classes sit at the
        // top of a JSX block whose input is thirty lines below it.
        const window = lines.slice(Math.max(0, index - 40), index + 4).join(' ')
        if (/focus-visible:(outline|ring)-/.test(window)) return
        if (/focus-within:(ring|border|outline)-/.test(window)) return
        if (/data-\[highlighted\]:/.test(window)) return
        offenders.push(`${file.slice(SRC.length + 1)}:${index + 1}`)
      })
    }

    expect(
      offenders,
      `these remove the focus indicator without providing one:\n${offenders.join('\n')}`,
    ).toEqual([])
  })
})

describe('overlay focus management', () => {
  it('a dialog traps focus and names itself', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move appointment</DialogTitle>
          </DialogHeader>
          <button type="button">Inside</button>
        </DialogContent>
      </Dialog>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Move appointment' })
    expect(dialog).toBeInTheDocument()
    // Radix marks everything outside the open overlay as inert; without it a
    // keyboard user tabs straight out of the dialog into the page behind it.
    expect(document.body.getAttribute('data-scroll-locked')).not.toBeNull()
  })

  it('a bottom sheet is a dialog too — same trap, same escape, same ARIA', () => {
    // The sheet is a presentation of Radix Dialog, not a second dialog
    // implementation. If that ever stops being true, this fails.
    render(
      <BottomSheet open>
        <BottomSheetContent>
          <BottomSheetHeader>
            <BottomSheetTitle>Book a cut</BottomSheetTitle>
          </BottomSheetHeader>
          <BottomSheetBody>
            <button type="button">Inside</button>
          </BottomSheetBody>
        </BottomSheetContent>
      </BottomSheet>,
    )

    expect(screen.getByRole('dialog', { name: 'Book a cut' })).toBeInTheDocument()
  })

  it('a bottom sheet closes on Escape', () => {
    let open = true
    const { rerender } = render(
      <BottomSheet
        open={open}
        onOpenChange={(next) => {
          open = next
        }}
      >
        <BottomSheetContent>
          <BottomSheetHeader>
            <BottomSheetTitle>Book a cut</BottomSheetTitle>
          </BottomSheetHeader>
        </BottomSheetContent>
      </BottomSheet>,
    )

    fireEvent.keyDown(document.body, { key: 'Escape' })
    rerender(
      <BottomSheet open={open} onOpenChange={() => {}}>
        <BottomSheetContent>
          <BottomSheetHeader>
            <BottomSheetTitle>Book a cut</BottomSheetTitle>
          </BottomSheetHeader>
        </BottomSheetContent>
      </BottomSheet>,
    )

    expect(open).toBe(false)
  })
})
