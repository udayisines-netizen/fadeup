# FadeUp marketing motion

Render-only tooling for the `/for-business` product film. **Not a dependency of
`apps/web`** — the production page loads the rendered video, nothing else.

## Why it is a separate package

Remotion pulls in a headless browser and a renderer. Adding that to `apps/web`
would put hundreds of megabytes of build tooling behind a marketing page. This
package renders assets; the app consumes them.

It also has a hard boundary: **no Supabase client, no API calls, no auth, no
database**. Every value in `src/brand.ts` is a presentational constant, and the
demo identity (Malik R., Fade City) mirrors the fictional world already defined
in `apps/web/src/components/for-business/scenes.ts`.

## Render

```bash
npm install
npm run render:webm     # → apps/web/public/marketing/for-business/*.webm
npm run render:mp4      # → …/*.mp4
```

The poster is a still, converted to JPEG:

```bash
npx remotion still src/index.ts ProductFilm /tmp/poster.png --frame=600
npx remotion ffmpeg -i /tmp/poster.png -vf scale=1280:-1 -q:v 4 \
  ../../apps/web/public/marketing/for-business/fadeup-product-film-poster.jpg
```

Frame 600 is the Chair Mode beat — the film's strongest single image.

## Two constraints worth knowing before you edit

**Fonts must be embedded, not named.** The render container has no fontconfig
and no system fonts, so a CSS font *stack* resolves to nothing and every string
renders invisible. `src/brand.ts` loads Plus Jakarta Sans through
`@remotion/google-fonts`. Satoshi is the charter face but is not licensed in
this repository; Plus Jakarta Sans is the closest open-licensed (OFL)
geometric-humanist match. Replace that one import when a licensed Satoshi asset
lands.

**The poster is JPEG, not WebP.** Remotion's bundled ffmpeg has no WebP muxer.
At 1280px the JPEG is ~51 kB, which is small enough that the format is not worth
adding a dependency for.

## Copy is French

Baked-in video text cannot follow the page's locale switch. FadeUp's first
market is France, the surrounding section is fully translated into all ten
locales, and the film is decorative — every beat it shows is also written as
prose on the page — so a non-French visitor loses atmosphere, not argument.
