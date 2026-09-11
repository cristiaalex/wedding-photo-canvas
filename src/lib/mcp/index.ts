import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listPrintOptions from "./tools/list-print-options";
import getMosaicGuide from "./tools/get-mosaic-guide";
import listMyMosaics from "./tools/list-my-mosaics";

// The OAuth issuer must be the direct Supabase host; the project ref is the only
// value that survives publish unchanged.
const projectRef = import.meta.env['VITE_SUPABASE_PROJECT_ID'] ?? "project-ref-unset";

export default defineMcp({
  name: "mosaic-pet",
  title: "Mosaic Pet",
  version: "0.1.0",
  instructions:
    "Tools for Mosaic Pet, which turns a customer's pet photos into one high-resolution photographic mosaic. Use `get_mosaic_guide` to explain the process, `list_print_options` for orientations and print sizes, and `list_my_mosaics` to look up the signed-in customer's own mosaics.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [getMosaicGuide, listPrintOptions, listMyMosaics],
});
