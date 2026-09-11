import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

type Size = { name: string; print: string };
const OPTIONS: Record<"landscape" | "portrait" | "square", Size[]> = {
  landscape: [
    { name: "Studio", print: '16 x 12 in / 40 x 30 cm' },
    { name: "Gallery", print: '24 x 18 in / 60 x 45 cm' },
    { name: "Grand", print: '36 x 24 in / 90 x 60 cm' },
  ],
  portrait: [
    { name: "Studio", print: '12 x 16 in / 30 x 40 cm' },
    { name: "Gallery", print: '18 x 24 in / 45 x 60 cm' },
    { name: "Grand", print: '24 x 36 in / 60 x 90 cm' },
  ],
  square: [
    { name: "Studio", print: '12 x 12 in / 30 x 30 cm' },
    { name: "Gallery", print: '20 x 20 in / 50 x 50 cm' },
    { name: "Grand", print: '30 x 30 in / 75 x 75 cm' },
  ],
};

export default defineTool({
  name: "list_print_options",
  title: "List print options",
  description:
    "List the Mosaic Pet orientations (landscape, portrait, square) and the three print sizes available for each.",
  inputSchema: {
    orientation: z
      .enum(["landscape", "portrait", "square"])
      .optional()
      .describe("Limit the result to one orientation."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: ({ orientation }) => {
    const result = orientation ? { [orientation]: OPTIONS[orientation] } : OPTIONS;
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: { options: result },
    };
  },
});
