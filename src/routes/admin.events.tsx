import { createFileRoute } from "@tanstack/react-router";
import { AdminPlaceholder } from "@/components/admin/admin-shell";

export const Route = createFileRoute("/admin/events")({
  head: () => ({
    meta: [
      { title: "Events — Mosaic Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: () => (
    <AdminPlaceholder
      title="Events"
      note="The wedding event directory, per-event photo and mosaic status will be connected to the live database in a later implementation step."
    />
  ),
});
