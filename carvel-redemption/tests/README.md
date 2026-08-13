# Tests

Two Playwright scripts that drive the staff screen the way a Carvel employee does, and
then check the database to confirm the screen told the truth. They exist because the
expensive failures here are physical — an ice cream given away twice cannot be
un-given — so "it looked green" is not evidence on its own.

| Script | Covers |
|---|---|
| `staff-flow.mjs` | BUILD_BRIEF §11: valid, already-used, unknown, sample coupon, test mode, auto-reset, override, airplane mode |
| `location.mjs` | §12: at-store / off-site / no-fix classification, and geofence enforcement |
| `screenshots.mjs` | Writes screenshots of each screen, for the field guide |

## Running them

They need the app running against a database. The quickest way is the throwaway
harness — Postgres + PostgREST standing in for Supabase:

```bash
./tests/local-harness/start.sh          # prints the env vars to use
# in another shell, with those env vars:
npm run dev
# then:
node tests/staff-flow.mjs
node tests/location.mjs
```

`start.sh` loads `supabase/01` → `07` into a scratch database, so it also serves as a
check that the SQL files apply cleanly in order.

## What these do NOT cover

- **The camera.** Headless Chromium has no barcode to look at. The decode loop is
  exercised (ZXing loads and runs; a fake video device is attached), but that a real
  crumpled coupon decodes in shop lighting can only be settled on a real phone. That
  check stays on the printed acceptance list.
- **Admin sign-in.** The harness has no Supabase Auth. Signed-out redirects are
  verified; anything past the login screen needs a real project.
- **iOS Safari.** Chromium is not Safari. The ZXing fallback path is the one iOS
  takes, and it is what runs here — but run the checklist on an actual iPhone.

The DB assertions shell out to `psql` against the local harness, so they only run
against it, not against a deployed Supabase.
