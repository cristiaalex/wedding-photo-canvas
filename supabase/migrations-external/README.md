# Mosaic Pet — database migrations

These files define the Mosaic Pet database. They are **not** applied by the
Lovable Cloud workspace automatically; they are meant to be run, in ascending
filename order, against the **Pet Supabase project only**.

> Never run these against any other project. The project ref is intentionally
> left as the placeholder `<PET_PROJECT_REF>` in every file — no real project
> id is stored in this repository.

## Order

1. `20260601_pet_baseline_schema.sql` — creates the core tables and the three
   storage buckets on an empty project. Run first.
2. Every remaining file in ascending filename order. They are idempotent
   (`IF NOT EXISTS`, `DROP POLICY IF EXISTS`) and build the mature RLS model,
   worker columns, download archives, billing, admin audit log and discount
   codes.

## Storage design

| Bucket    | Visibility | Retention                                            |
| --------- | ---------- | ---------------------------------------------------- |
| `covers`  | public     | long-lived                                           |
| `photos`  | private    | **temporary** customer source photos, purgeable      |
| `mosaics` | private    | **permanent** final mosaics, prints, tiles, archives |

Bucket names are configurable in the app via `VITE_PET_*_BUCKET`.

## Status

Nothing has been executed yet. No Pet project exists at the time of writing.
