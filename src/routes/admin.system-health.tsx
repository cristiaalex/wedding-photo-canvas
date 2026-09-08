import { createFileRoute } from "@tanstack/react-router";
import { AdminPlaceholder } from "@/components/admin/admin-shell";

export const Route = createFileRoute("/admin/system-health")({
  head: () => ({
    meta: [
      { title: "System Health — Mosaic Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: () => (
    <AdminPlaceholder
      title="System Health"
      note="Worker, storage and job-queue health checks will be connected in a later implementation step."
    />
  ),
});
