# FadeUp V3 — Generated Asset Provenance

Governance rules: `FADEUP_VISUAL_V3_DIRECTION.md` §11. Every generated asset
ships only as optimized derivatives; masters are archived under
`docs/design/artifacts/v3/`.

## hero-editorial (Landing hero, BG-04)

- **Purpose:** public Landing hero environment — Direction A "Editorial
  Precision". Decorative environment for the hero scene; the real search UI
  and product objects render as HTML over the reserved negative space.
- **Source:** Artlist MCP · Seedream 5.0 Pro T2I 2K (modelId 2615)
- **Generation id:** `01a058d7-1074-7357-a0df-ed5c1fb6fa4d` (output 3 of 4)
- **Generated:** 2026-08-31 · consumed 1 free-trial image generation (0 credits)
- **Prompt:** editorial fashion photograph, modern minimalist barbershop
  studio; young Black man, fresh skin fade with crisp lineup, cream knit;
  barber's hands finishing the nape with a clipper; soft directional window
  light; pale plaster walls, matte sage-green wall plane; left two-thirds calm
  negative space; no text, no logos, no signage, no barber pole.
- **Master:** `docs/design/artifacts/v3/hero-editorial-master-2048.png`
  (2048×1152, PNG, 3.2MB — never shipped)
- **Shipped derivatives** (`apps/web/src/assets/marketing/home/`):
  - Wide 16:9: `hero-editorial-{2048,1600,1080,720}.{avif,webp}` — sharp,
    AVIF q55 / WebP q74; 1600w AVIF = 35KB (budget ≤220KB)
  - Mobile 4:5 art-directed crop (extract x1000–1922, full height —
    subject + barber hands + sage plane):
    `hero-editorial-mobile-{860,640,480}.{avif,webp}`
- **Responsive usage:** `<picture>` — mobile sources below 768px use the
  4:5 crop; wide sources above; AVIF preferred, WebP fallback;
  `fetchpriority="high"` (LCP element of the landing).
- **Alt behavior:** decorative environment — empty `alt=""`; the hero's
  meaning is carried by the real headline and search UI.
- **License/provenance:** AI-generated via the connected Artlist account's
  free-trial generation; no third-party brand or person likeness prompted.
- **Casting/quality review:** fade gradient and lineup believable; natural
  hair texture; clipper grip anatomically correct; no in-scene text or logos;
  passed 2026-08-31 creative review (3 sibling variants archived in Artlist
  history, retrievable via `list_generations`).

## culture-mirror (Landing Culture section, BG-04)

- **Purpose:** the Culture section's editorial scene — a client checking his
  fresh mid skin fade in a hand mirror. Replaces the interim reuse of the
  hero's mobile crop (independent-review finding #6); this is the reserved
  Image-2 spend from the direction's plan (§10).
- **Source:** Artlist MCP · Seedream 5.0 Pro T2I 2K (modelId 2615)
- **Generation id:** `01a0596d-771e-7f8e-9b46-69b91be8cd38` (output 1 of 4)
- **Generated:** 2026-08-31 · consumed the second (final) free-trial image
  generation (0 credits). Free image slots now exhausted; 1 free video
  generation remains unspent by design.
- **Master:** `docs/design/artifacts/v3/culture-mirror-master-1536.png`
  (1536×2048 PNG — never shipped)
- **Shipped derivatives:** `apps/web/src/assets/marketing/home/
  culture-mirror-{860,640,480}.{avif,webp}` (sharp, AVIF q55/WebP q74;
  860w AVIF = 40KB)
- **Usage:** landing Culture section `<img loading="lazy">`, 4:5 media frame.
- **Alt behavior:** meaningful — localized alt describes the scene.
- **Casting/quality review:** believable fade gradient and curl texture,
  natural hand/mirror anatomy, no in-scene text or logos; passed 2026-08-31
  creative review (3 sibling variants retrievable via `list_generations`).
