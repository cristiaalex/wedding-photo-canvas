# Mosaic Pet customer experience transformation

## Goal
Turn the cloned Wedding customer experience into a mobile-first, premium pet-art journey while preserving the isolated Pet backend, security model, and mature mosaic pipeline.

## What will change

1. **Brand and landing experience**
   - Replace Wedding branding, metadata, navigation, imagery, and copy with Mosaic Pet.
   - Build a photography-first landing page centered on “Your pet. A lifetime of memories. One beautiful mosaic.”
   - Explain upload → configure → preview → purchase → high-resolution mosaic download without technical terminology.
   - Use new pet photography and mosaic artwork assets with the existing ivory, taupe, graphite, and restrained-gold design language.

2. **Customer studio journey**
   - Rework first-time setup into a short Pet project flow instead of wedding onboarding.
   - Create a clear mobile-first studio sequence: upload photos, choose orientation, choose one of exactly three sizes, select the main pet photo, and generate a preview.
   - Reuse existing event/project records and additive Pet fields; do not alter schema or migrations.

3. **Uploads and photo selection**
   - Reuse the mature multi-file, HEIC, RAW/DNG, resumable upload, image-variant, progress, retry, and thumbnail logic.
   - Present source photos as temporary creative inputs, not purchased downloads.
   - Add customer-facing ZIP selection only where the current code can safely support it; otherwise show it as unavailable until server extraction is connected rather than pretending it works.

4. **Preview, purchase, and final artwork**
   - Reuse generation status, preview imagery, deep zoom, and existing mosaic viewer.
   - Let customers return to orientation, size, or main-photo selection before purchase.
   - Replace subscription/Pro presentation with a one-time purchase summary using a configuration-driven price placeholder.
   - Present final download as the purchased high-resolution, print-ready mosaic only; never offer originals as the product download.
   - Keep payment and worker actions honest when their credentials/services are not configured.

5. **Customer-facing cleanup**
   - Replace Wedding terminology in public and customer workspace routes, shared headers/footers, loading/error states, and metadata.
   - Remove guestbook, guest-sharing, wedding timeline, venue/date, couple, and wedding-gallery concepts from the primary Pet journey.
   - Keep admin code and mature infrastructure intact unless customer-visible routing requires a safe label change.

## Technical details
- Keep TanStack Start routing and existing authenticated route gate.
- Preserve current storage access, RLS behavior, worker calls, image generation, deep zoom, print export, billing plumbing, and source lifecycle fields.
- Use existing database columns plus the prepared optional Pet columns; no migration or external database operation.
- Add reusable Pet product constants for the exact three sizes per orientation and display-only purchase pricing.
- Retain magic-link sign-in as the current technical bridge, but place it after the customer understands the product rather than presenting it as a wedding suite.
- Update each changed content route with unique Mosaic Pet metadata.

## Verification
- Check the full journey at mobile and desktop widths.
- Verify uploads/configuration controls, preview links, and final-download presentation do not overlap or expose technical terms.
- Run focused tests/type checking and confirm the preview build succeeds.
- Scan customer-facing code for remaining Wedding terminology and infrastructure identifiers.
- Confirm no migrations, credentials, external connections, Stripe configuration, Railway deployment, or source-cleanup implementation changed.
