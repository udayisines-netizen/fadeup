# Artlist MCP — Capability Inventory (V3 Visual Reset)

Date: 2026-08-31 · Inspected live via the connected Artlist MCP. No credits spent.

## Account state — THE governing constraint

The connected account is a **free trial with no AI-credit plan**:

- **2 free image generations remaining** (one-time; they never renew)
- **1 free video generation remaining** (one-time)
- 0 credits; every further generation requires an Artlist subscription

This makes the originally envisioned "generate ~4 still directions, then refine
the winner, then a hero video loop" **impossible on this account**. The V3
creative exploration is adapted (documented in `FADEUP_VISUAL_V3_DIRECTION.md`):

1. The four creative directions (A Editorial Precision, B Urban Premium,
   C Product Cinema, D Abstract Brand World) are explored **on paper** as full
   art-direction briefs with complete prompts, and the winner is selected by
   creative-director reasoning against the mobile/desktop/readability criteria.
2. The **2 image generations are reserved for the chosen direction only** —
   ideally 1 desktop hero master (wide, with protected negative space for the
   real HTML search UI) and 1 held in reserve for either a mobile-crop
   derivative or one retry if the first output fails casting/hands/hair checks.
3. The **1 video generation stays unspent** unless the still direction is
   approved and a hero loop is judged clearly stronger than the still
   (per brief §26, still-first). A 5–8s silent loop via image-to-video from the
   approved hero still would be the only justified spend.

Cost quoting: `get_generation_cost` gives exact per-generation quotes; on this
account the relevant "cost" is simply one of the remaining free slots.

## Available operations (verified tool surface)

| Area | Tools | Notes |
| --- | --- | --- |
| Image generation | `generate_image` | text-to-image and image-to-image (editing/reference) |
| Image models | `list_models kind=image` | 120+ models incl. Flux 2.0 (Dev/Pro/Turbo/Flash, 1K–2K), Google Nano Banana Pro / NB2 (1K–4K), Seedream 4.5/5.0 (2K–4K), Kling o1/o3 image, GPT Image 1.5/2.0, ImagineArt, Ideogram V4, Qwen Image 3, Grok Imagine, Luma Uni-1 (4K), Artlist Original LoRAs (Professional/Cinematic/Indie/Commercial), Topaz Upscale (paid only) |
| Video generation | `generate_video` | text-to-video and image-to-video |
| Video models | `list_models kind=video` | Kling 1.6→v3 (up to 4K, audio variants), Veo 3.1 / Fast / Lite, Seedance 1.5/2.0/2.5, LTX 2.0–2.5, Wan 2.6–3.0, Luma Ray 3.2, Hailuo 2.3, Grok Imagine Video; `freeGeneration:true` I2V options include Kling 1.6 Std/Pro, Kling 2.5 Turbo Pro, Seedance 2.0 Mini |
| Model configuration | `get_model_config` | per-model settings: aspect ratios, resolution, quality tiers |
| Cost quoting | `get_generation_cost` | exact read-only quote before any spend |
| Status / history | `get_generation_status`, `list_generations` | async polling + asset history |
| Style kits | `create_style_kit`, `get/list_style_kits`, `add/update/delete_style_kit_item` | brand kits with palette, guidelines, reference images; **none saved yet** |
| Reference uploads | `upload_image`, `upload_video`, `upload_audio`, `upload_widget`, `record_uploads`, `confirm_upload`, `get_recent_uploads` | user assets usable as generation references |
| Music | `generate_music` | text-to-music; not needed for V3 (product ships no audio) |
| Voiceover | `generate_voiceover`, `list_voices`, `clone_voice` | TTS/S2S; not needed for V3 |
| Balance | `get_balance` | plan + remaining free generations |

## Practical implications for V3

- **Image-to-image editing is supported**, so the second free image slot can be
  an edit/recomposition of the first hero rather than a from-scratch attempt.
- **Style kit creation costs nothing** and can encode the FadeUp palette and
  written art direction for consistency if/when the account gains credits.
- Free-generation-eligible models include top-tier stills (Seedream 5.0,
  Nano Banana Pro 2K/4K, Flux 2.0 Pro) — the two free slots can produce
  full-quality 2K+ masters, not degraded previews.
- Everything beyond the 3 free slots (additional editorial imagery for Culture /
  Independent / Onboarding sections, per-breakpoint derivatives, campaign
  variants) is **blocked on an Artlist subscription** — recorded as an open
  product-owner decision. The V3 layout system is therefore designed to be
  excellent with typography, real product surfaces, color fields and SVG/CSS
  material first, with photography slots that light up when assets exist —
  mirroring the product's own truthful-absence rule at the brand level.
