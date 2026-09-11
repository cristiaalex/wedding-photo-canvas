import { defineTool } from "@lovable.dev/mcp-js";

const GUIDE = `Mosaic Pet turns a collection of your pet photos into one high-resolution photographic mosaic.

How it works
1. Upload your photos (individually or as a ZIP archive). JPEG, PNG, HEIC and RAW files are supported.
2. Choose an orientation: landscape, portrait or square.
3. Choose one of three print sizes for that orientation.
4. Pick the main photo — the hero image the whole mosaic will form.
5. Preview the mosaic and zoom into the individual tiles.
6. Pay once, then download the print-ready high-resolution mosaic.

Getting the best result
- More photos means richer detail; several hundred works beautifully.
- Variety of colour and brightness matters more than perfect sharpness.
- The hero photo should be well lit with a clear, recognisable subject.
- Photos are used only to build your mosaic and are removed once your finished mosaic is downloaded.
- The finished mosaic is a large print-ready file and stays available for you to download again.`;

export default defineTool({
  name: "get_mosaic_guide",
  title: "How Mosaic Pet works",
  description:
    "Explain the Mosaic Pet process end to end, plus advice on choosing photos for the best mosaic result.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: () => ({ content: [{ type: "text", text: GUIDE }] }),
});
