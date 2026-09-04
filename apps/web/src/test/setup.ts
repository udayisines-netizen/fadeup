import '@testing-library/jest-dom/vitest'
import { initI18n } from '@/i18n'
import { registerV2Bundles } from '@/shared/i18n'

// jsdom doesn't implement matchMedia — src/lib/theme.tsx reads it to
// resolve the "system" theme option.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList
}

// jsdom defines Element.scrollIntoView as a stub-less property, so calling it
// throws. The DateStrip uses it to keep the chosen day on screen; the scroll
// itself is untestable in jsdom, but its absence must not fail a render.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

// jsdom has no IntersectionObserver, which Motion's `whileInView` requires.
// The stub reports every observed element as immediately intersecting, so
// scroll-revealed marketing content is present and assertable in tests — the
// same outcome a reduced-motion user gets in a real browser.
if (!('IntersectionObserver' in globalThis)) {
  class TestIntersectionObserver {
    readonly root = null
    readonly rootMargin = ''
    readonly thresholds: readonly number[] = []
    private readonly callback: IntersectionObserverCallback

    // Assigned in the body rather than via a parameter property: the project
    // compiles with `erasableSyntaxOnly`.
    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback
    }

    observe(target: Element): void {
      this.callback(
        [{ isIntersecting: true, target, intersectionRatio: 1 } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      )
    }

    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
  }

  // Cast rather than `implements`: the DOM lib's interface gains members over
  // time (scrollMargin, ...) that a test double has no reason to model.
  const stub = TestIntersectionObserver as unknown as typeof IntersectionObserver
  globalThis.IntersectionObserver = stub
  window.IntersectionObserver = stub
}

// Components use react-i18next's useTranslation() unconditionally, which
// throws if i18next hasn't initialized yet — in the real app main.tsx
// awaits this before the first render, so tests must too.
await initI18n()
// The V2 (P1b) namespace rides the same instance — registered exactly like
// main.tsx does.
registerV2Bundles()
