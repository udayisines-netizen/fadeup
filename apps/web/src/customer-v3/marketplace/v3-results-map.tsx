/**
 * The map half of the V3 marketplace — desktop LIST + MAP and mobile Map view.
 *
 * Wiring follows the proven pattern (markers are real buttons, fitBounds
 * capped, aria-hidden canvas, two-way pin↔row coordination); the pins speak
 * V3: a result with a REAL starting price renders a compact ink price pill
 * that turns green when selected; one without renders a minimal dot. Nothing
 * else is drawn — no fake pins, no client-side geocoding, and non-plottable
 * results are counted out loud under the map.
 *
 * ONLY EVER IMPORTED LAZILY: maplibre is ~950kB pre-gzip.
 * The tile source lives in the shared map-config (nonvisual infrastructure,
 * reused per the V3 reuse ledger; relocates to lib/ in Phase V10).
 */
import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useTranslation } from 'react-i18next'

import type { MarketplaceProfessionalResult } from '@/lib/queries/marketplace'
import { MAP_TILE_SOURCE } from '@/customer-v2/marketplace/map-config'

export function V3ResultsMap({
  results,
  activeId,
  onSelect,
  priceLabelFor,
  className,
}: {
  results: MarketplaceProfessionalResult[]
  activeId: string | null
  onSelect: (result: MarketplaceProfessionalResult) => void
  priceLabelFor: (result: MarketplaceProfessionalResult) => string | null
  className?: string
}) {
  const { t } = useTranslation('v3')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map())

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

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    for (const marker of markersRef.current.values()) marker.remove()
    markersRef.current = new Map()

    for (const result of plottable) {
      const price = priceLabelRef.current(result)
      const element = document.createElement('button')
      element.type = 'button'
      element.className = price ? 'v3-pin' : 'v3-pin v3-pin-dot'
      if (price) element.textContent = price
      element.setAttribute('aria-label', result.locationName)
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

  useEffect(() => {
    for (const [locationId, marker] of markersRef.current) {
      marker.getElement().setAttribute('data-selected', String(locationId === activeId))
    }
  }, [activeId, plottable])

  return (
    <div className={className}>
      <div ref={containerRef} aria-hidden="true" />
      {unplottable > 0 ? (
        <p role="status" className="v3-meta" style={{ padding: '0.5rem 0.75rem' }}>
          {t('app.market.notPlotted', { count: unplottable })}
        </p>
      ) : null}
    </div>
  )
}

export default V3ResultsMap
