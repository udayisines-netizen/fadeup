import { describe, expect, it } from 'vitest'
import {
  deriveCalledCountdown,
  deriveTrackingView,
  displayableWaitMinutes,
  formatCountdown,
  peopleAheadLabelKey,
  type TrackedEntryLike,
} from '@/features/queue/lib/tracking'

const entry = (over: Partial<TrackedEntryLike> = {}): TrackedEntryLike => ({
  status: 'waiting',
  removed_automatically: false,
  ...over,
})

describe('formatCountdown — jamais une valeur négative', () => {
  it('sans échéance, il n’y a rien à afficher', () => {
    expect(formatCountdown(null)).toBeNull()
    expect(formatCountdown(Number.NaN)).toBeNull()
  })

  it('échéance atteinte ou dépassée = null (l’écran bascule, il ne compte pas à l’envers)', () => {
    expect(formatCountdown(0)).toBeNull()
    expect(formatCountdown(-1)).toBeNull()
    expect(formatCountdown(-600_000)).toBeNull()
  })

  it('formate en m:ss, secondes sur deux chiffres', () => {
    expect(formatCountdown(5_000)).toBe('0:05')
    expect(formatCountdown(65_400)).toBe('1:05')
    expect(formatCountdown(600_000)).toBe('10:00')
    expect(formatCountdown(599_999)).toBe('9:59')
  })
})

describe('deriveCalledCountdown — l’échéance d’appel', () => {
  const now = new Date('2026-09-08T12:00:00.000Z')

  it('aucune échéance publiée : l’appel reste visible SANS minutes', () => {
    expect(deriveCalledCountdown(null, now)).toEqual({ kind: 'none' })
    expect(deriveCalledCountdown(undefined, now)).toEqual({ kind: 'none' })
  })

  it('une date illisible n’invente pas un délai écoulé', () => {
    expect(deriveCalledCountdown('pas-une-date', now)).toEqual({ kind: 'none' })
  })

  it('échéance à venir : le compte à rebours', () => {
    expect(deriveCalledCountdown('2026-09-08T12:03:20.000Z', now)).toEqual({
      kind: 'countdown',
      label: '3:20',
    })
  })

  it('échéance passée : bascule sur « délai écoulé »', () => {
    expect(deriveCalledCountdown('2026-09-08T11:58:00.000Z', now)).toEqual({ kind: 'passed' })
    expect(deriveCalledCountdown('2026-09-08T12:00:00.000Z', now)).toEqual({ kind: 'passed' })
  })
})

describe('deriveTrackingView — un état d’écran par état réel', () => {
  it('« disparue » prime sur toute donnée déjà reçue', () => {
    expect(deriveTrackingView(entry(), true)).toEqual({ kind: 'gone' })
    expect(deriveTrackingView(null, true)).toEqual({ kind: 'gone' })
  })

  it('première réponse pas encore arrivée : rien n’est affirmé', () => {
    expect(deriveTrackingView(null, false)).toEqual({ kind: 'loading' })
  })

  it('les états vivants', () => {
    expect(deriveTrackingView(entry({ status: 'waiting' }), false)).toEqual({ kind: 'waiting' })
    expect(deriveTrackingView(entry({ status: 'called' }), false)).toEqual({ kind: 'called' })
    expect(deriveTrackingView(entry({ status: 'in_service' }), false)).toEqual({ kind: 'in_service' })
  })

  it('les états terminaux, chacun avec sa clé', () => {
    expect(deriveTrackingView(entry({ status: 'completed' }), false)).toEqual({
      kind: 'ended',
      key: 'completed',
    })
    expect(deriveTrackingView(entry({ status: 'cancelled' }), false)).toEqual({
      kind: 'ended',
      key: 'left',
    })
  })

  it('sortie automatique et clôture par le salon ne disent PAS la même chose', () => {
    expect(deriveTrackingView(entry({ status: 'no_show', removed_automatically: true }), false)).toEqual({
      kind: 'ended',
      key: 'removedAuto',
    })
    expect(deriveTrackingView(entry({ status: 'no_show', removed_automatically: false }), false)).toEqual({
      kind: 'ended',
      key: 'removedManual',
    })
  })
})

describe('displayableWaitMinutes — aucune minute inventée', () => {
  it('pas d’estimation fiable = rien', () => {
    expect(displayableWaitMinutes(null, 3)).toBeNull()
    expect(displayableWaitMinutes(undefined, 3)).toBeNull()
    expect(displayableWaitMinutes(-4, 3)).toBeNull()
  })

  it('personne devant = rien (le chiffre de position dit déjà tout)', () => {
    expect(displayableWaitMinutes(12, 0)).toBeNull()
    expect(displayableWaitMinutes(12, null)).toBeNull()
    expect(displayableWaitMinutes(12, undefined)).toBeNull()
  })

  it('estimation fiable ET du monde devant : le pas de cinq minutes s’applique', () => {
    expect(displayableWaitMinutes(12, 3)).toBe(15)
    expect(displayableWaitMinutes(20, 1)).toBe(20)
  })
})

describe('peopleAheadLabelKey — zéro a sa propre phrase', () => {
  it('zéro pointe la clé « Vous êtes le prochain »', () => {
    expect(peopleAheadLabelKey(0)).toBe('queue.track.peopleAhead_zero')
  })

  it('un nombre positif garde la clé pluralisée', () => {
    expect(peopleAheadLabelKey(1)).toBe('queue.track.peopleAhead')
    expect(peopleAheadLabelKey(7)).toBe('queue.track.peopleAhead')
  })

  it('nombre inconnu = aucune ligne', () => {
    expect(peopleAheadLabelKey(null)).toBeNull()
    expect(peopleAheadLabelKey(undefined)).toBeNull()
    expect(peopleAheadLabelKey(Number.NaN)).toBeNull()
  })
})
