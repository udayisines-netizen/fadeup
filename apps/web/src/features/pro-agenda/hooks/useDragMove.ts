import { useCallback, useEffect, useRef, useState } from 'react'
import { clampMinutes, snapMinutes, type DayKey } from '@/features/pro-agenda/lib/time'

/**
 * OS-1 — LE geste central : glisser un rendez-vous dans le temps et entre
 * barbers. Pointer Events, sans bibliothèque.
 *
 * - Souris / stylet : le glisser démarre après 4 px de mouvement.
 * - Toucher : APPUI LONG (280 ms) sans bouger, puis glisser ; un doigt qui
 *   bouge avant l'échéance est un défilement, on le laisse au navigateur.
 *   Une fois actif, `touchmove` est neutralisé (écouteur non passif) pour
 *   que le navigateur ne vole pas le pointeur — c'est ce qui rend le geste
 *   utilisable sur mobile ; le repli « Déplacer » de la fiche existe quand
 *   même (menu).
 * - La cible se lit dans le DOM : l'élément sous le pointeur qui porte
 *   `data-drop-barber` (+ `data-drop-day`, et `data-drop-kind="time"` pour
 *   une colonne horaire où la position verticale donne l'heure).
 * - Aucune animation n'est nécessaire au geste : le fantôme suit le
 *   pointeur par une position directe, `prefers-reduced-motion` n'y change
 *   rien.
 */

export interface DragItem {
  id: string
  /** Minutes locales de début — conservées quand la cible n'a pas d'axe horaire (vue semaine). */
  startMinutes: number
  durationMinutes: number
  barberId: string
  dayKey: DayKey
  label: string
}

export interface DropTarget {
  barberId: string
  dayKey: DayKey
  minutes: number
}

export interface DragState {
  item: DragItem
  target: DropTarget | null
  /** Position courante du pointeur (viewport) — pour le fantôme. */
  x: number
  y: number
  /** Décalage pointeur → coin de l'élément saisi, pour que le fantôme ne saute pas. */
  offsetX: number
  offsetY: number
  width: number
  height: number
  active: boolean
}

export interface UseDragMoveOptions {
  enabled: boolean
  hourHeight: number
  startHour: number
  endHour: number
  snapStep?: number
  onDrop: (item: DragItem, target: DropTarget) => void
}

const MOUSE_THRESHOLD_PX = 4
const TOUCH_THRESHOLD_PX = 8
const LONG_PRESS_MS = 280
const AUTOSCROLL_EDGE_PX = 48
const AUTOSCROLL_STEP_PX = 14

export function resolveDropTarget(
  x: number,
  y: number,
  item: DragItem,
  geometry: { hourHeight: number; startHour: number; endHour: number; snapStep: number },
  /** Le HAUT du fantôme (pointeur moins la prise) : c'est lui qui donne l'heure, pas le doigt. */
  ghostTop: number = y,
): DropTarget | null {
  const under = document.elementFromPoint(x, y)
  const zone = under?.closest<HTMLElement>('[data-drop-barber]')
  if (!zone) return null
  const barberId = zone.dataset.dropBarber
  const dayKey = zone.dataset.dropDay
  if (!barberId || !dayKey) return null
  if (zone.dataset.dropKind === 'time') {
    const rect = zone.getBoundingClientRect()
    const rawMinutes = geometry.startHour * 60 + ((ghostTop - rect.top) / geometry.hourHeight) * 60
    const maxStart = geometry.endHour * 60 - item.durationMinutes
    const minutes = clampMinutes(snapMinutes(rawMinutes, geometry.snapStep), geometry.startHour * 60, Math.max(geometry.startHour * 60, maxStart))
    return { barberId, dayKey, minutes }
  }
  return { barberId, dayKey, minutes: item.startMinutes }
}

function sameTarget(item: DragItem, target: DropTarget): boolean {
  return item.barberId === target.barberId && item.dayKey === target.dayKey && item.startMinutes === target.minutes
}

export function useDragMove(options: UseDragMoveOptions) {
  const { enabled, hourHeight, startHour, endHour, snapStep = 5 } = options
  const [drag, setDrag] = useState<DragState | null>(null)
  const latest = useRef(options)
  latest.current = options
  const dragRef = useRef<DragState | null>(null)
  const pendingRef = useRef<{
    pointerId: number
    item: DragItem
    startX: number
    startY: number
    offsetX: number
    offsetY: number
    width: number
    height: number
    pointerType: string
    timer: number | null
  } | null>(null)

  const update = useCallback((next: DragState | null) => {
    dragRef.current = next
    setDrag(next)
  }, [])

  const preventTouchMove = useCallback((event: TouchEvent) => {
    if (dragRef.current?.active) event.preventDefault()
  }, [])

  const cleanup = useCallback(() => {
    const pending = pendingRef.current
    if (pending?.timer !== null && pending?.timer !== undefined) window.clearTimeout(pending.timer)
    pendingRef.current = null
    document.removeEventListener('touchmove', preventTouchMove)
    document.body.style.removeProperty('user-select')
    document.body.style.removeProperty('-webkit-user-select')
    update(null)
  }, [preventTouchMove, update])

  const activate = useCallback(
    (x: number, y: number) => {
      const pending = pendingRef.current
      if (!pending) return
      if (pending.timer !== null) window.clearTimeout(pending.timer)
      pending.timer = null
      document.addEventListener('touchmove', preventTouchMove, { passive: false })
      document.body.style.setProperty('user-select', 'none')
      document.body.style.setProperty('-webkit-user-select', 'none')
      const geometry = { hourHeight, startHour, endHour, snapStep }
      update({
        item: pending.item,
        target: resolveDropTarget(x, y, pending.item, geometry, y - pending.offsetY),
        x,
        y,
        offsetX: pending.offsetX,
        offsetY: pending.offsetY,
        width: pending.width,
        height: pending.height,
        active: true,
      })
    },
    [endHour, hourHeight, preventTouchMove, snapStep, startHour, update],
  )

  useEffect(() => {
    if (!enabled) return
    const onMove = (event: PointerEvent) => {
      const pending = pendingRef.current
      if (!pending || event.pointerId !== pending.pointerId) return
      const dx = event.clientX - pending.startX
      const dy = event.clientY - pending.startY
      const distance = Math.hypot(dx, dy)
      const current = dragRef.current
      if (!current?.active) {
        if (pending.pointerType === 'touch') {
          // Bouger avant l'appui long = défilement : on abandonne.
          if (distance > TOUCH_THRESHOLD_PX) cleanup()
          return
        }
        if (distance >= MOUSE_THRESHOLD_PX) activate(event.clientX, event.clientY)
        return
      }
      const geometry = { hourHeight, startHour, endHour, snapStep }
      update({
        ...current,
        x: event.clientX,
        y: event.clientY,
        target: resolveDropTarget(event.clientX, event.clientY, current.item, geometry, event.clientY - current.offsetY),
      })
      // Défilement automatique de la fenêtre près des bords.
      if (event.clientY < AUTOSCROLL_EDGE_PX) window.scrollBy(0, -AUTOSCROLL_STEP_PX)
      else if (event.clientY > window.innerHeight - AUTOSCROLL_EDGE_PX) window.scrollBy(0, AUTOSCROLL_STEP_PX)
    }
    const onUp = (event: PointerEvent) => {
      const pending = pendingRef.current
      if (!pending || event.pointerId !== pending.pointerId) return
      const current = dragRef.current
      if (current?.active) {
        // Le clic qui suit un relâchement de glisser n'est pas un clic : il
        // n'ouvre pas la fiche. Avalé une seule fois, en phase de capture.
        const swallow = (click: Event) => {
          click.stopPropagation()
          click.preventDefault()
        }
        window.addEventListener('click', swallow, { capture: true, once: true })
        window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 300)
        if (current.target && !sameTarget(current.item, current.target)) {
          latest.current.onDrop(current.item, current.target)
        }
      }
      cleanup()
    }
    const onCancel = (event: PointerEvent) => {
      const pending = pendingRef.current
      if (!pending || event.pointerId !== pending.pointerId) return
      cleanup()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && pendingRef.current) cleanup()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey)
      cleanup()
    }
  }, [activate, cleanup, enabled, endHour, hourHeight, snapStep, startHour, update])

  /** À poser sur l'élément saisissable (`onPointerDown`). */
  const startDrag = useCallback(
    (event: React.PointerEvent<HTMLElement>, item: DragItem) => {
      if (!enabled) return
      if (event.button !== 0 && event.pointerType === 'mouse') return
      const rect = event.currentTarget.getBoundingClientRect()
      cleanup()
      const pending = {
        pointerId: event.pointerId,
        item,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        width: rect.width,
        height: rect.height,
        pointerType: event.pointerType,
        timer: null as number | null,
      }
      pendingRef.current = pending
      if (event.pointerType === 'touch') {
        pending.timer = window.setTimeout(() => activate(pending.startX, pending.startY), LONG_PRESS_MS)
      }
    },
    [activate, cleanup, enabled],
  )

  return { drag, startDrag }
}
