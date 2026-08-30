# R5R.1A browser QA harness

Two Playwright scripts that produce the artefacts in
`docs/frontend/artifacts/r5r1a/`. They exist in the repository rather than in a
scratch directory because the R5R.0 audit's browser numbers were unreproducible
by its own reviewer, which is how a "1330px" measurement and a set of load times
survived into a first draft before being retracted.

## Running them

```
npm run dev -- --port 5199 --host 127.0.0.1
node e2e/r5r1a/sweep.mjs      # 5 routes x 3 viewports, probes + screenshots
node e2e/r5r1a/states.mjs     # loading / empty / error / search / RTL / reduced motion
```

Both scripts honour `QA_BASE` and `QA_OUT`; `sweep.mjs` also honours `QA_LOCALE`.

`states.mjs` did NOT honour `QA_OUT` until R5R.1A-R1, despite this file saying it
did — running that lot's captures with the variable set therefore overwrote
thirteen of the first pass's state screenshots, which were untracked and are
gone. Fixed at the source; recorded here because the README's claim is what made
it safe-looking.

Language is pinned per capture through `fadeup-locale-explicit`, not through the
browser `locale`. FadeUp resolves language from `locale-detect`'s server-side
country first, so a context locale alone does not change the page: the RTL
capture was rendering a left-to-right French page under an Arabic name. Every
capture now records the `lang` and `dir` it actually rendered at.

The dev server must point at a Supabase the browser can reach. `apps/web/.env.local`
is the file that decides this and it is untracked — if `search_public_professionals`
returns 401, that key is stale relative to the running stack, not a code fault.

## What the probes assert

`sweep.mjs` prints, per route and viewport: horizontal overflow, console errors
and warnings, failed requests, 4xx/5xx responses, clipped leaf text, sub-44px
touch targets, controls with no accessible name, images without `alt`, the `h1`
count, the widest interactive control, and the number of shadowed elements.

Two details in it are load-bearing and easy to get wrong:

- **Visually-hidden text is skipped.** `sr-only` is a 1px clipped box by design
  and trips any `scrollWidth` test, which would bury the real truncations.
- **Touch targets are measured at the hit area, not the element.** A card-link
  overlay (`::after { position:absolute; inset:0 }`) makes the positioned
  ancestor clickable, so measuring the 22px title anchor would report a defect
  that does not exist.

`states.mjs` drives the states real data cannot produce on demand — it routes
the marketplace RPC to stall or abort, seeds `fadeup-country-explicit` to reach
a country with listings and one without, and runs the page in Arabic and under
`prefers-reduced-motion`. It also walks the tab order recording each focus ring,
and clicks a result away from both the title and the Book button to prove the
whole band navigates.
