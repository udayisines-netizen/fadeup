import { describe, expect, it } from 'vitest'
import { estimateNotice } from './estimate'

/**
 * Les pourcentages utilisés ici sont ceux que la base calcule vraiment
 * (`list_organization_services`) : 100 % sous 5 mesures, puis
 * 100 - round(((n-4)/16)*100) — 94 % à 5 mesures, 50 % à 12, 0 % à 20.
 */
describe('estimateNotice', () => {
  it('aucune mesure : la durée annoncée est ce que le client voit', () => {
    expect(
      estimateNotice({ sampleCount: 0, declaredWeightPercent: 100, declaredMinutes: 30, observedMinutes: null }),
    ).toEqual({ key: 'pro.catalog.estimate.declaredOnly', params: {}, capped: false })
  })

  it("moins de 5 mesures : l'observé ne pèse encore rien", () => {
    expect(
      estimateNotice({ sampleCount: 4, declaredWeightPercent: 100, declaredMinutes: 30, observedMinutes: 33 }),
    ).toEqual({ key: 'pro.catalog.estimate.declaredOnly', params: {}, capped: false })
  })

  it('5 mesures : le mélange commence, et il est chiffré', () => {
    expect(
      estimateNotice({ sampleCount: 5, declaredWeightPercent: 94, declaredMinutes: 30, observedMinutes: 32 }),
    ).toEqual({ key: 'pro.catalog.estimate.blended', params: { count: 5, percent: 94 }, capped: false })
  })

  it('12 mesures : moitié-moitié', () => {
    expect(
      estimateNotice({ sampleCount: 12, declaredWeightPercent: 50, declaredMinutes: 30, observedMinutes: 34 }),
    ).toEqual({ key: 'pro.catalog.estimate.blended', params: { count: 12, percent: 50 }, capped: false })
  })

  it("20 mesures : le client ne voit plus que l'observé", () => {
    expect(
      estimateNotice({ sampleCount: 20, declaredWeightPercent: 0, declaredMinutes: 38, observedMinutes: 40 }),
    ).toEqual({ key: 'pro.catalog.estimate.observedOnly', params: { count: 20 }, capped: false })
  })

  it('observé absent malgré un compteur non nul : rien de mesuré à annoncer', () => {
    expect(
      estimateNotice({ sampleCount: 9, declaredWeightPercent: 69, declaredMinutes: 30, observedMinutes: null }),
    ).toEqual({ key: 'pro.catalog.estimate.declaredOnly', params: {}, capped: false })
  })

  it("écart supérieur à 50 % avec assez de mesures : l'estimation est bornée", () => {
    const notice = estimateNotice({
      sampleCount: 10,
      declaredWeightPercent: 62,
      declaredMinutes: 30,
      observedMinutes: 50,
    })
    expect(notice.key).toBe('pro.catalog.estimate.blended')
    expect(notice.capped).toBe(true)
  })

  it('écart supérieur à 50 % dans les deux sens', () => {
    expect(
      estimateNotice({ sampleCount: 20, declaredWeightPercent: 0, declaredMinutes: 60, observedMinutes: 25 }).capped,
    ).toBe(true)
  })

  it("exactement 50 % d'écart ne borne pas", () => {
    expect(
      estimateNotice({ sampleCount: 20, declaredWeightPercent: 0, declaredMinutes: 30, observedMinutes: 45 }).capped,
    ).toBe(false)
  })

  it('un grand écart sans assez de mesures ne borne pas', () => {
    expect(
      estimateNotice({ sampleCount: 3, declaredWeightPercent: 100, declaredMinutes: 30, observedMinutes: 90 }).capped,
    ).toBe(false)
  })

  it('durée annoncée vide (champ en cours de saisie) : aucun bornage inventé', () => {
    expect(
      estimateNotice({ sampleCount: 20, declaredWeightPercent: 0, declaredMinutes: 0, observedMinutes: 40 }),
    ).toEqual({ key: 'pro.catalog.estimate.observedOnly', params: { count: 20 }, capped: false })
  })

  it('poids de 100 % malgré des mesures : la durée annoncée gouverne encore', () => {
    expect(
      estimateNotice({ sampleCount: 8, declaredWeightPercent: 100, declaredMinutes: 30, observedMinutes: 31 }),
    ).toEqual({ key: 'pro.catalog.estimate.declaredOnly', params: {}, capped: false })
  })
})
