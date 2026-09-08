
# True Photo Mosaic — Redesign

Replace the current "cover image overlay" generator with a real color-matched tile mosaic (Mosaically-style) plus an interactive zoomable viewer.

## Scope

### 1. New generator (`src/lib/mosaic-generator.ts` — rewrite)

- Grid: configurable, default **100×100** cells (10,000 tiles).
- Output: **6000×6000 px** PNG (tile = 60px).
- Pipeline:
  1. Load cover portrait, draw at grid resolution, sample **average LAB color per cell**.
  2. For every guest photo: load → downscale to small canvas → compute **average LAB color** + cache a **60px square cover-cropped thumbnail**.
  3. For each cell, pick the guest photo with the **smallest ΔE (CIE76)** distance to the cell color. Photos may be reused.
  4. Optional light **color correction per tile**: blend tile with target cell color at ~25% opacity to preserve portrait clarity from a distance while keeping guest photo visible.
  5. Compose full 6000px canvas, encode PNG, return blob + a **tiles manifest** (`{x,y,sourceUrl,sourceId}[]`).
- Concurrency-limited image loading (reuse current pattern).
- Progress callbacks for: analyzing-cover, analyzing-photos, matching, composing, encoding.

### 2. Storage & DB

- Existing `mosaics` table already has `mosaic_image_url`, `tiles_json`, `photo_count`, `tile_count`, `status`. Use them:
  - `mosaic_image_url` → 6000px PNG in `mosaics` bucket (existing).
  - `tiles_json` → tile manifest (grid size + array of `{x,y,src}` using signed photo paths recomputed on view).
  - `tile_count` → 10000, `photo_count` → unique guest photos used.
- No schema migration needed.

### 3. Interactive viewer (`src/components/mosaic-viewer.tsx` — new)

- Use **OpenSeadragon** with the **single-image** source pointing at the signed mosaic PNG URL — gives smooth pinch/scroll zoom, mobile-friendly, progressive rendering out of the box. (No Deep Zoom pyramid needed for v1; OSD handles a single large image fine and we already store one big PNG.)
- Overlay layer: on zoom-in past threshold, hit-test pointer against tile manifest and show a small tooltip with the guest photo (signed URL) and uploader name.
- Click a tile → modal with full-size guest photo.
- Lazy-load OpenSeadragon (`bun add openseadragon` + `@types/openseadragon`).

### 4. Mosaic page integration

- `src/components/mosaic-panel.tsx`: keep "Generate / Regenerate" button, swap call to new generator, show "Open interactive viewer" button + existing "Download PNG".
- New route `src/routes/_authenticated.mosaic.$eventId.tsx` (full-screen viewer) OR a dialog in the dashboard. Prefer a dedicated route for mobile fullscreen.

### 5. Print-ready download

- Same 6000px PNG already serves as print-ready (≈20"×20" at 300 DPI). Download button unchanged.

## Technical notes (for reviewer)

- ΔE CIE76 is good enough and fast; CIEDE2000 is overkill for 100×100 in browser.
- Average-color cache for guest photos is computed once per generation run; not persisted (cheap to redo, avoids schema change).
- Memory: 10,000 tiles × 60px thumbs ≈ 144MB in worst case. We'll keep a **pool of unique guest thumbnails** (typically ≤ a few hundred) and only store references in the grid — peak memory stays small.
- OpenSeadragon single-image mode loads the PNG progressively via the browser; works on iOS Safari.
- No backend/edge function needed — everything runs client-side, same as today.

## Out of scope (v1)

- Deep Zoom tile pyramid (DZI). Can add later if 6000px PNG becomes too heavy.
- Server-side rendering of mosaic.
- Face-aware tile placement.

## Files

- rewrite `src/lib/mosaic-generator.ts`
- new `src/components/mosaic-viewer.tsx`
- new `src/routes/_authenticated.mosaic.$eventId.tsx`
- edit `src/components/mosaic-panel.tsx` (wire new generator + viewer link)
- `bun add openseadragon @types/openseadragon`
