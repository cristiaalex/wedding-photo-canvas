import { createFileRoute } from "@tanstack/react-router";
import { AdminPlaceholder } from "@/components/admin/admin-shell";

export const Route = createFileRoute("/admin/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — Mosaic Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: () => (
    <AdminPlaceholder
      title="Analytics"
      note="Deeper cohort, funnel and acquisition analytics will be connected in a later implementation step. Headline metrics live on Overview."
    />
  ),
});
