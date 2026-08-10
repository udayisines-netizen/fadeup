import '@testing-library/jest-dom/vitest'
import { initI18n } from '@/i18n'

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

// Components use react-i18next's useTranslation() unconditionally, which
// throws if i18next hasn't initialized yet — in the real app main.tsx
// awaits this before the first render, so tests must too.
await initI18n()
