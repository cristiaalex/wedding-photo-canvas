import { createFileRoute } from "@tanstack/react-router";
import { AdminPlaceholder } from "@/components/admin/admin-shell";

export const Route = createFileRoute("/admin/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Mosaic Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: () => (
    <AdminPlaceholder
      title="Settings"
      note="Admin configuration lives in server environment settings for now. Editable internal settings will be added in a later implementation step."
    />
  ),
});
