import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useTranslation } from 'react-i18next'
import type { MarketplaceProfessionalResult } from '@/lib/queries/marketplace'

/**
 * The map half of the Design Pass A marketplace (desktop LIST + MAP).
 *
 * Modeled directly on the proven `components/marketplace/results-map.tsx`:
 * raster OpenStreetMap tiles (no token; attribution via the style source, as
 * the OSM usage policy requires), markers that are real buttons, fitBounds
 * capped so one result never slams to street level. Restyled to the v2
 * language — FadeUp-green pins, hairline chrome (see customer-v2.css).
 *
 * ONLY EVER IMPORTED LAZILY: maplibre is ~950kB pre-gzip and the map renders
 * only on desktop viewports that actually have plottable results.
 *
 * The map is never the only surface — the list beside it is the default and
 * stays rendered; a canvas of markers is not readable by a screen reader, so
 * the container is aria-hidden and the semantics live on the markers.
 *
 * TRUTH RULES. Pins exist for results whose `latitude`/`longitude` are real;
 * nothing is geocoded client-side, nothing is guessed. Results the backend
 * has not geocoded are counted under the map so the list and the map can
 * never silently disagree.
 */

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'

export function V2ResultsMap({
  results,
  onSelect,
  className,
}: {
  results: MarketplaceProfessionalResult[]
  /** Tapping a pin selects that result in the list beside the map. */
  onSelect: (result: MarketplaceProfessionalResult) => void
  className?: string
}) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])

  // `onSelect` is recreated per render; a ref keeps the marker effect keyed on
  // the results alone so panning never rebuilds every pin.
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

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
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: OSM_ATTRIBUTION,
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: [2.35, 48.86],
      zoom: 4,
      // Restrained chrome: zoom only, added below; no rotation affordance.
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

    for (const marker of markersRef.current) marker.remove()
    markersRef.current = []

    // maplibre writes the colour onto the generated SVG as a presentation
    // attribute, where a var() would silently fall back to default blue —
    // resolve the token to its concrete value.
    const green =
      getComputedStyle(document.documentElement).getPropertyValue('--color-v2-green').trim() ||
      '#0a7c4c'

    for (const result of plottable) {
      const marker = new maplibregl.Marker({ color: green, scale: 0.85 })
        .setLngLat([result.longitude, result.latitude])
        .addTo(map)

      const element = marker.getElement()
      element.setAttribute('role', 'button')
      element.setAttribute('tabindex', '0')
      element.setAttribute('aria-label', result.organizationName)
      element.style.cursor = 'pointer'
      element.addEventListener('click', () => onSelectRef.current(result))
      element.addEventListener('keydown', (event) => {
        if (event instanceof KeyboardEvent && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onSelectRef.current(result)
        }
      })

      markersRef.current.push(marker)
    }

    if (plottable.length > 0) {
      const bounds = new maplibregl.LngLatBounds()
      for (const result of plottable) bounds.extend([result.longitude, result.latitude])
      map.fitBounds(bounds, { padding: 56, maxZoom: 14, animate: false })
    }
  }, [plottable])

  return (
    <div className={className}>
      <div
        ref={containerRef}
        aria-hidden="true"
        className="h-full min-h-[28rem] w-full overflow-hidden rounded-v2-3 border border-v2-hairline"
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
