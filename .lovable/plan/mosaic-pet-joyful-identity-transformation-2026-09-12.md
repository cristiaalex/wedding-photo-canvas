# Mosaic Pet joyful identity transformation

## Goal
Replace the current serious editorial presentation with an original, joyful Mosaic Pet identity inspired by the selected organic-collage direction. Keep all upload, security, payment, and mosaic-generation behavior unchanged.

## Visual system
- Use the selected Sky & Peach palette: warm off-white foundation, sky blue, peach/coral, sunshine yellow, and mint.
- Replace Cormorant Garamond and Inter with Sora for playful display moments and Manrope for body and interface text.
- Introduce rounded, tactile controls; soft colorful shadows; lively borders; organic shapes; polished paw, heart, sparkle, and photo-memory details.
- Build a distinctive paw-integrated Mosaic Pet wordmark and derive the favicon from the same mark.
- Apply restrained motion to photos, buttons, progress states, and decorative marks, with reduced-motion support.

## Customer journey
1. **Landing and navigation**
   - Recompose the first screen around a joyful pet-photo collage that clearly shows many memories becoming one mosaic.
   - Add simple navigation for How it works, Examples, Reviews, and FAQ plus a prominent Create your mosaic action.
   - Add colorful bento sections for the four-step journey, examples, emotional proof, reassurance, and FAQs.
2. **Sign-in and setup**
   - Restyle sign-in as a friendly continuation step rather than a formal account screen.
   - Turn onboarding into a clear four-step mobile-first flow with colorful progress, visual orientation cards, exactly three size choices, and a special main-photo selection moment.
3. **Upload and photo review**
   - Preserve the existing multi-file, mobile, drag/drop, ZIP, HEIC/HEIF, RAW/DNG, resumable, retry, duplicate, thumbnail, and error behavior.
   - Restyle the drop area, progress dialog, completion states, errors, and photo collection as a cheerful memory-gathering experience.
4. **Customer workspace**
   - Rework the shell, mobile tabs, dashboard, gallery, loading states, and empty states into a friendly “My Pet Mosaic” space rather than a dashboard.
5. **Preview, purchase, and final result**
   - Preserve generation, progress updates, deep zoom, and the detailed viewer.
   - Turn preview into a celebratory reveal with warm progress copy and clear ways to adjust photos or choices.
   - Restyle the one-time purchase summary and paid final-download state without changing payment setup or adding credentials.
   - Keep the final high-resolution mosaic as the only purchased download.
6. **Customer-facing cleanup**
   - Update metadata, not-found/error states, and auth callback presentation.
   - Remove remaining visible Wedding and luxury/editorial language from active customer surfaces; retain safe redirects and leave admin untouched.

## Technical details
- Update semantic design tokens in `src/styles.css` and font links in the root route; use those tokens throughout rather than hardcoded component colors.
- Refactor shared brand, shell, upload, and decorative presentation components where needed; reuse existing Button and dialog primitives.
- Keep backend calls, database shape, migrations, storage rules, route security, upload engine, worker integration, image processing, and mosaic viewer logic intact.
- Do not connect services, add secrets, configure payments, deploy infrastructure, or implement cleanup.

## Verification
- Check every active customer route at mobile and desktop sizes, including no horizontal overflow and clear touch targets.
- Exercise public landing/sign-in and authenticated screens where the available session permits.
- Check console/runtime signals, customer-facing wording, metadata, and absence of Wedding branding.
- Confirm the preview build succeeds after the changes.
