import { useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * ============================================================================
 * REARRANGING THE SHOP'S DASHBOARD
 * ============================================================================
 *
 * §24 asks for drag/reorder, a stable layout, saved state, failure handling,
 * an ACCESSIBLE KEYBOARD ALTERNATIVE, and no accidental reorder on a simple
 * click or touch. Those last two are the requirements that decide the design.
 *
 * ============================================================================
 * WHY THERE IS AN EXPLICIT "REARRANGE" MODE
 * ============================================================================
 *
 * A dashboard whose cards are draggable all the time has two problems. On a
 * phone, every attempt to scroll past a card is a potential drag — which is
 * precisely the "accidental reorder on simple touch" §24 forbids. And the
 * cards contain real controls: an always-draggable panel puts a drag surface
 * on top of the button somebody was reaching for.
 *
 * So the dashboard is static until an authorized member turns rearranging on.
 * In that mode the cards stop being operational and become objects you can
 * move; leaving the mode saves. This also gives the save a natural moment,
 * rather than one write per drop.
 *
 * ============================================================================
 * THE KEYBOARD PATH IS NOT AN ALTERNATIVE, IT IS THE SAME PATH
 * ============================================================================
 *
 * Every card in rearrange mode carries two real buttons — move up, move down —
 * with real accessible names. They are not a fallback bolted on beside the
 * drag: they are the only mechanism, and the pointer drag calls exactly the
 * same `move` function. That is what makes it impossible for the two to drift,
 * which is the usual fate of an "accessible alternative" nobody uses.
 *
 * The HTML5 drag-and-drop API is used rather than a pointer-event
 * reimplementation because it is what the platform provides, it gets the
 * cursor and the drag image for free, and it does not fight touch scrolling —
 * on touch, the buttons are the interaction, which is the right answer there
 * anyway.
 */

export interface DashboardItem {
  key: string
  /** The card's own title, used to name its move controls for a screen reader. */
  label: string
  content: ReactNode
  /** Spans both columns on a wide viewport. */
  wide?: boolean
}

export function DashboardGrid({
  items,
  order,
  editing,
  onReorder,
}: {
  items: DashboardItem[]
  order: string[]
  /** Rearrange mode. Only ever true for a member allowed to save. */
  editing: boolean
  onReorder: (nextOrder: string[]) => void
}) {
  const { t } = useTranslation('app')
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  // Announced on every move, so a screen reader user hears where the card
  // landed rather than silence.
  const [announcement, setAnnouncement] = useState('')
  const byKey = useRef(new Map<string, DashboardItem>())
  byKey.current = new Map(items.map((item) => [item.key, item]))

  const ordered = order.flatMap((key) => {
    const item = byKey.current.get(key)
    return item ? [item] : []
  })

  function move(fromIndex: number, toIndex: number) {
    if (toIndex < 0 || toIndex >= ordered.length || fromIndex === toIndex) return
    const next = ordered.map((item) => item.key)
    const [moved] = next.splice(fromIndex, 1)
    if (!moved) return
    next.splice(toIndex, 0, moved)
    onReorder(next)
    setAnnouncement(
      t('dashboard.movedTo', {
        card: byKey.current.get(moved)?.label ?? moved,
        position: toIndex + 1,
        total: next.length,
      }),
    )
  }

  return (
    <>
      {/* One live region for the whole grid. Per-card regions would announce
          the moved card twice — once as it leaves, once as it arrives. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        {ordered.map((item, index) => (
          <section
            key={item.key}
            draggable={editing}
            onDragStart={() => setDraggingKey(item.key)}
            onDragEnd={() => setDraggingKey(null)}
            onDragOver={(event) => {
              if (!editing || draggingKey === null) return
              // Without this the drop is refused by the browser and the whole
              // interaction silently does nothing.
              event.preventDefault()
            }}
            onDrop={(event) => {
              if (!editing || draggingKey === null) return
              event.preventDefault()
              move(ordered.findIndex((candidate) => candidate.key === draggingKey), index)
              setDraggingKey(null)
            }}
            className={cn(
              'min-w-0',
              item.wide && 'lg:col-span-2',
              editing && 'rounded-xl outline-2 outline-dashed outline-offset-2 outline-border-strong',
              editing && draggingKey === item.key && 'opacity-50',
            )}
          >
            {editing ? (
              <div className="mb-2 flex items-center gap-1 px-1">
                <GripVertical className="h-4 w-4 shrink-0 text-ink-500" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-caption font-medium text-ink-700">{item.label}</span>

                {/*
                  Named for the CARD, not "Move up". A screen reader user
                  tabbing through six pairs of identically-named buttons has no
                  way to tell which pair belongs to which card.
                */}
                <button
                  type="button"
                  onClick={() => move(index, index - 1)}
                  disabled={index === 0}
                  aria-label={t('dashboard.moveUp', { card: item.label })}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-700 hover:bg-paper-100 disabled:text-ink-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                >
                  <ChevronUp className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, index + 1)}
                  disabled={index === ordered.length - 1}
                  aria-label={t('dashboard.moveDown', { card: item.label })}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-700 hover:bg-paper-100 disabled:text-ink-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
                >
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ) : null}

            {/*
              In rearrange mode the card's own controls are inert. A dashboard
              where you can accidentally complete an appointment while trying
              to pick the card up is worse than one you cannot rearrange.
              `inert` also removes everything inside from the tab order, so the
              only focusable things are the two move buttons.
            */}
            <div inert={editing ? true : undefined} className={cn(editing && 'pointer-events-none select-none')}>
              {item.content}
            </div>
          </section>
        ))}
      </div>
    </>
  )
}
