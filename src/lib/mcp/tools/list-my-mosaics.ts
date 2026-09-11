import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_my_mosaics",
  title: "List my mosaics",
  description:
    "List the mosaic projects belonging to the signed-in customer, with their current status and print settings.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not signed in." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("events")
      .select("id, name, orientation, print_size, processing_status, payment_status, created_at")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return {
        content: [
          {
            type: "text",
            text: `Your mosaics are not available right now: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
    if (!data || data.length === 0) {
      return { content: [{ type: "text", text: "You do not have any mosaics yet." }] };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { mosaics: data },
    };
  },
});
