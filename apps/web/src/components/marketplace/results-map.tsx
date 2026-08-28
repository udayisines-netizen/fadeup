import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useTranslation } from 'react-i18next'
import type { MarketplaceProfessionalResult } from '@/lib/queries/marketplace'

/**
 * ============================================================================
 * THE MAP HALF OF THE MARKETPLACE
 * ============================================================================
 *
 * Raster OpenStreetMap tiles, the same source the acquisition map already uses
 * — no paid token, and the attribution the OSM usage policy requires comes
 * from the style source rather than being drawn by hand.
 *
 * THIS FILE IS ONLY EVER IMPORTED LAZILY. maplibre is ~950kB before gzip, and
 * the overwhelming majority of marketplace sessions never switch to the map.
 * `marketplace-results.tsx` reaches it through `React.lazy`, which is what
 * keeps it out of the initial bundle (§35).
 *
 * ============================================================================
 * A MAP IS NOT AN ACCESSIBLE SURFACE, SO IT IS NEVER THE ONLY ONE
 * ============================================================================
 *
 * A canvas of markers cannot be read by a screen reader, cannot be tabbed
 * through meaningfully, and cannot be used at all without a pointer. §30
 * requires a "map alternative through list view" — and the alternative here is
 * not a fallback, it is the DEFAULT: the marketplace opens as a list and the
 * map is something the customer switches to. The toggle is a real control with
 * a real label, so getting back is one keypress.
 *
 * The list beneath is also still rendered on desktop, so on a wide viewport
 * the two are simultaneous rather than exclusive.
 *
 * ============================================================================
 * A SHOP WITH NO COORDINATES IS NOT DROPPED SILENTLY
 * ============================================================================
 *
 * Not every location has been geocoded. Plotting only what can be plotted and
 * saying nothing would mean the map shows six shops where the list shows nine,
 * and the customer has no way to discover the difference. The count of
 * unplottable results is stated under the map.
 */
/**
 * The OSM tile usage policy requires visible attribution.
 *
 * Deliberately NOT translated: it names a project and links to that project's
 * own copyright page. "OpenStreetMap" is a proper noun in every locale, on the
 * same footing as "FadeUp", and `find-hardcoded-strings.mjs` exempts both for
 * the same stated reason.
 */
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'

export function ResultsMap({
  results,
  onSelect,
  className,
}: {
  results: MarketplaceProfessionalResult[]
  /** Tapping a marker selects that result in the list beside/below the map. */
  onSelect: (result: MarketplaceProfessionalResult) => void
  className?: string
}) {
  const { t } = useTranslation('marketplace')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])

  // `onSelect` is recreated each render; holding it in a ref keeps the marker
  // effect keyed on the RESULTS alone, so panning does not rebuild every pin.
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
            // Required by the OSM tile usage policy, and deliberately NOT
            // translated: it is an attribution to a named project, not product
            // copy. The i18n gate is told so at the top of this file.
            attribution: OSM_ATTRIBUTION,
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: [2.35, 48.86],
      zoom: 4,
    })
    map.addControl(new maplibregl.NavigationControl(), 'top-right')
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

    // maplibre writes the marker colour onto the generated SVG as a
    // presentation attribute, where a `var(--color-accent-600)` would simply
    // be invalid and silently fall back to its default blue. Resolving the
    // token to a concrete value here is what keeps the pins on-brand and
    // theme-correct — the map is remounted on a theme change, so dark mode
    // gets dark mode's accent rather than light mode's.
    const accent =
      getComputedStyle(document.documentElement).getPropertyValue('--color-accent-600').trim() || '#0d9b5f'

    for (const result of plottable) {
      const marker = new maplibregl.Marker({ color: accent })
        .setLngLat([result.longitude, result.latitude])
        .addTo(map)

      // The marker itself is the button. A popup would be a second thing to
      // dismiss before the customer can do the thing they wanted.
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
      // `maxZoom` so a single result does not slam the camera to street level,
      // which reads as broken rather than as precise.
      map.fitBounds(bounds, { padding: 48, maxZoom: 14, animate: false })
    }
    // Keyed on the plottable set only — see the ref note above.
  }, [plottable])

  return (
    <div className={className}>
      <div
        ref={containerRef}
        // Not focusable and not labelled as a region: the markers inside carry
        // the semantics, and announcing the canvas itself as content would
        // promise a screen-reader user something it cannot deliver.
        aria-hidden="true"
        className="h-[26rem] w-full overflow-hidden rounded-2xl border border-border sm:h-[32rem]"
      />
      {unplottable > 0 ? (
        <p role="status" className="mt-2 text-caption text-ink-500">
          {t('map.notPlotted', { count: unplottable })}
        </p>
      ) : null}
    </div>
  )
}
