import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useReducedMotion } from 'motion/react'
import { cn } from '@/lib/cn'

/**
 * The FadeUp product film.
 *
 * One ~33s silent film replaces the fourteen-slide walkthrough this page used
 * to be. It is a rendered video asset, not a DOM animation: animating dozens
 * of production elements on a marketing page to recreate it would cost more
 * on every visit than downloading a compressed film once.
 *
 * Three loading rules, in order of how much they matter:
 *
 *   1. `prefers-reduced-motion` — the video is never mounted at all. The
 *      poster and the prose stand alone, and they say the same thing.
 *   2. Not yet near the viewport — nothing but the poster is fetched
 *      (`preload="none"` plus a deferred `<source>`), so a visitor who never
 *      scrolls this far pays zero video bytes.
 *   3. Near the viewport — sources attach, and playback starts muted.
 *
 * The film is decorative in the strict sense: every beat it shows is also
 * written in the sections below it. Nothing in the product argument is only
 * available to someone who can watch a video.
 */

const BASE = '/marketing/for-business/fadeup-product-film'

export function ProductFilm({ className }: { className?: string }) {
  const { t } = useTranslation('landing')
  const reduced = useReducedMotion()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [active, setActive] = useState(false)

  /*
   * Attach sources only once the section is within one viewport of being
   * seen. rootMargin does the "near" part; `once` semantics come from
   * disconnecting on the first hit, because a film that unloads itself when
   * scrolled past would just re-download on the way back up.
   */
  useEffect(() => {
    if (reduced) return
    const node = containerRef.current
    if (!node) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          setActive(true)
          observer.disconnect()
        }
      },
      { rootMargin: '100% 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [reduced])

  /*
   * Autoplay is a request, not a guarantee — a browser may refuse it even
   * muted (Low Power Mode, data saver). A rejected promise is not an error
   * worth surfacing: the poster stays, which is exactly the reduced-motion
   * experience, and the page still reads.
   *
   * `play()` only returns a promise in browsers that implement the modern
   * signature; older ones — and jsdom under test — return undefined, so the
   * result is checked before `.catch` is reached rather than assumed.
   */
  useEffect(() => {
    if (!active) return
    const video = videoRef.current
    if (!video) return
    video.load?.()
    const played: unknown = video.play?.()
    if (played instanceof Promise) played.catch(() => {})
  }, [active])

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/*
        No frame. The film used to sit inside a frosted panel with padding
        around it, which made the page's most important object look like a
        thumbnail pinned to a card. It is now the object itself: clipped to a
        generous radius, resting on its own shadow, with nothing drawn around
        it. No glass box, no laptop mockup, no browser chrome.
      */}
      <div
        className={cn(
          'relative isolate overflow-hidden rounded-[var(--pro-r-showcase)]',
          'bg-[var(--pro-sunken)] shadow-[0_50px_100px_-40px_rgb(0_0_0/0.85)]',
        )}
      >
        {/* 16:9 box reserved up front so the page never reflows on load. */}
        <div className="relative aspect-video w-full">
          {reduced ? (
            <img
              src={`${BASE}-poster.jpg`}
              alt={t('business.film.alt')}
              className="absolute inset-0 h-full w-full object-cover"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <video
              ref={videoRef}
              className="absolute inset-0 h-full w-full object-cover"
              poster={`${BASE}-poster.jpg`}
              muted
              loop
              playsInline
              autoPlay
              preload="none"
              aria-label={t('business.film.alt')}
            >
              {active ? (
                <>
                  <source src={`${BASE}.webm`} type="video/webm" />
                  <source src={`${BASE}.mp4`} type="video/mp4" />
                </>
              ) : null}
              {t('business.film.alt')}
            </video>
          )}
        </div>
      </div>
    </div>
  )
}
