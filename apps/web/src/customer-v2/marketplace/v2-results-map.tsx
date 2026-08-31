import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useTranslation } from 'react-i18next'
import type { MarketplaceProfessionalResult } from '@/lib/queries/marketplace'
import { MAP_TILE_SOURCE } from '@/customer-v2/marketplace/map-config'

/**
 * The map half of the marketplace — desktop LIST + MAP, and the mobile Map
 * view (Design Pass A.1 §1/§2/§5).
 *
 * Modeled on the proven `components/marketplace/results-map.tsx` (markers
 * that are real buttons, fitBounds capped, aria-hidden canvas with semantics
 * on the markers), with the Pass A.1 refinements:
 *
 * PINS ARE FADEUP MARKERS, NOT TEARDROPS. A result whose contract carries a
 * REAL `starting_price_cents` renders as a compact price pill ("€25"); one
 * without renders as a minimal green dot. Nothing else is drawn. Selection
 * turns the pill green-filled / deepens the dot — the exact vocabulary the
 * list row's `.v2-row-active` uses, so pin and card visibly agree.
 *
 * COORDINATION IS TWO-WAY. `activeId` highlights the matching pin;
 * `onSelect` reports a pin tap so the page can highlight/scroll/dock its
 * card. Price formatting arrives via `priceLabelFor` because money needs
 * the page's locale context and markers are plain DOM.
 *
 * TILE SOURCE lives in `map-config.ts` alone (§8) — this file knows the
 * renderer, never the URL.
 *
 * ONLY EVER IMPORTED LAZILY: maplibre is ~950kB pre-gzip.
 *
 * TRUTH RULES. Pins exist only for results with real coordinates; nothing is
 * geocoded or guessed client-side; non-geocoded results are counted under
 * the map so list and map can never silently disagree.
 */

export function V2ResultsMap({
  results,
  activeId,
  onSelect,
  priceLabelFor,
  className,
}: {
  results: MarketplaceProfessionalResult[]
  /** The location id of the result currently emphasized by the page. */
  activeId: string | null
  /** A pin was chosen — the page highlights/docks the matching result. */
  onSelect: (result: MarketplaceProfessionalResult) => void
  /** Real formatted starting price, or null when the contract has none. */
  priceLabelFor: (result: MarketplaceProfessionalResult) => string | null
  className?: string
}) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map())

  // Recreated-per-render callbacks live in refs so marker effects key on data.
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const priceLabelRef = useRef(priceLabelFor)
  priceLabelRef.current = priceLabelFor

  const plottable = results.filter(
    (result): result is MarketplaceProfessionalResult & { latitude: number; longitude: number } =>
      result.latitude != null && result.longitude != null,
  )
  const unplottable = results.length - plottable.length

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: { osm: { type: 'raster', ...MAP_TILE_SOURCE } },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: [2.35, 48.86],
      zoom: 4,
      dragRotate: false,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  /* Markers: rebuilt when the RESULT SET changes; selection is a cheap
     attribute flip handled by the effect below. */
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    for (const marker of markersRef.current.values()) marker.remove()
    markersRef.current = new Map()

    for (const result of plottable) {
      const price = priceLabelRef.current(result)
      const element = document.createElement('button')
      element.type = 'button'
      element.className = price ? 'v2-pin' : 'v2-pin v2-pin-dot'
      if (price) element.textContent = price
      element.setAttribute('aria-label', result.organizationName)
      element.addEventListener('click', (event) => {
        event.stopPropagation()
        onSelectRef.current(result)
      })

      const marker = new maplibregl.Marker({ element })
        .setLngLat([result.longitude, result.latitude])
        .addTo(map)
      markersRef.current.set(result.locationId, marker)
    }

    if (plottable.length > 0) {
      const bounds = new maplibregl.LngLatBounds()
      for (const result of plottable) bounds.extend([result.longitude, result.latitude])
      map.fitBounds(bounds, { padding: 56, maxZoom: 14, animate: false })
    }
  }, [plottable])

  /* Selection flip — no marker rebuild, no camera movement. */
  useEffect(() => {
    for (const [locationId, marker] of markersRef.current) {
      marker.getElement().setAttribute('data-selected', String(locationId === activeId))
    }
  }, [activeId, plottable])

  return (
    <div className={className}>
      <div
        ref={containerRef}
        aria-hidden="true"
        className="h-full min-h-[20rem] w-full overflow-hidden rounded-v2-3 border border-v2-hairline"
      />
      {unplottable > 0 ? (
        <p role="status" className="mt-2 text-v2-caption text-v2-ink-mute">
          {t('customer-app:v2.marketplace.notPlotted', { count: unplottable })}
        </p>
      ) : null}
    </div>
  )
}

export default V2ResultsMap
