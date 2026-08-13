# BUILD BRIEF — Carvel Coupon Redemption

**Read `README.md` first for context and setup order.** This file is the implementation
spec. Build it in the order given in §9.

---

## 1. The job

Jersey Shore Hatzalah printed **500 serialized coupons** (`000001`–`000500`) for one free
Carvel Kiddie Cup, given to kids caught wearing bike helmets. Each coupon has a **Code 128
barcode encoding its plain 6-digit serial**.

Build two things:

1. **Staff redemption page** — a Carvel employee opens a URL from a QR code taped by the
   register, scans a coupon, and gets a large GREEN or RED answer in about a second.
   No login. No app install. No training.
2. **Admin dashboard** — David sees redeemed / remaining counts, a redemption log, and
   **what Hatzalah owes Carvel** (redeemed × unit cost).

The single hard requirement: **a coupon can never be redeemed twice.**

---

## 2. Stack

Match what already exists in David's world — the PAG Vendor Portal is Next.js + Supabase,
and the Hatzalah shift-schedule app is on Netlify.

| Layer | Choice |
|---|---|
| Framework | Next.js, App Router, TypeScript |
| DB + auth | Supabase (Postgres) |
| Hosting | Netlify or Vercel |
| Styling | Tailwind |
| Scanning | `BarcodeDetector` native API, ZXing (`@zxing/browser`) fallback |

### Known trap from prior Supabase work

Previous builds repeatedly hit **RLS policy errors and schema-cache relationship failures
on nested/joined selects**. The pattern that worked was *separate queries for related
data* rather than nested selects.

This design sidesteps it on the hot path entirely: redemption goes through a
`SECURITY DEFINER` RPC, not a client-side table write. Anon has zero table access.
Keep it that way.

---

## 3. File tree

```
app/
  layout.tsx
  page.tsx                    → redirect to /admin
  s/[token]/page.tsx          → STAFF SCANNER (the only screen Carvel sees)
  admin/page.tsx              → dashboard
  admin/login/page.tsx        → Supabase email auth
  admin/log/page.tsx          → full scan log + CSV export
  admin/settings/page.tsx     → range editor, unit cost, stores
components/
  Scanner.tsx                 → camera + decode loop
  ResultPanel.tsx             → the big green/red
  ManualEntry.tsx             → 6-digit fallback keypad
  TestBanner.tsx
lib/
  supabase/client.ts
  supabase/server.ts
  redeem.ts                   → single wrapper around the RPC
  sound.ts                    → WebAudio beeps + navigator.vibrate
supabase/                     → SQL, already written, run in order
```

---

## 4. Environment

`.env.local` (and the same in Netlify/Vercel dashboard):

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

The anon key is safe to ship publicly **only because** `04_rls.sql` leaves anon with no
table access and a single executable function. If you loosen RLS, this stops being true.

---

## 5. Staff scanner — `/s/[token]`

This screen is used by a teenager, one-handed, in a loud shop, with a line of customers.
Design accordingly.

### Behaviour

1. **Camera starts on load.** If permission was granted before, no tap required. If
   denied or unavailable, fall through to manual entry with no dead end.
2. **Decode loop** — try `BarcodeDetector` (`['code_128']`) first; if the constructor is
   missing (iOS Safari), lazy-load ZXing. Throttle to ~10 fps.
3. On decode: parse to integer, call `redeem()`, show the result panel.
4. **Debounce identical scans for 3 s** so one coupon held in frame doesn't fire twice.
5. Auto-return to the camera after **4 s**, plus a persistent "Scan next" button.

### Result panel — full-bleed, one glance

| RPC result | Colour | Headline | Sub |
|---|---|---|---|
| `ok` | green | **VALID** | `No. 000123` · "Serve one Kiddie Cup" |
| `already_used` | red | **ALREADY USED** | "Redeemed Aug 4, 2026 at 3:14 PM" |
| `out_of_range` | red | **NOT VALID** | "Not part of this program" |
| `not_found` | red | **NOT VALID** | "Unknown coupon number" |
| `bad_format` | amber | **CHECK NUMBER** | "Enter the 6 digits under the barcode" |
| `test` | blue | **TEST — VALID** | "Nothing was recorded" |

Headline at least 48 px. Readable across a counter.

### Feedback

- `navigator.vibrate(60)` on success, `[80,60,80]` on failure.
- WebAudio: rising two-tone on success, low buzz on failure. Staff won't be looking.
- Respect a mute toggle, persisted in component state (**not** localStorage — and note
  this app is a normal deployed site, so localStorage *is* available here; that
  restriction applies only to chat artifacts. Use it if you want the toggle to stick.)

### Manual entry

Always visible below the camera. Numeric inputmode, 6-digit max, big submit. Barcodes get
crumpled and greasy — this is not an edge case, it is Tuesday.

### Offline

If `fetch` fails, show amber **NO CONNECTION — try again**. Do **not** optimistically
approve, and do **not** queue for later sync: a queued redemption that later turns out to
be a duplicate has already given away the ice cream. Failing closed is correct here.

---

## 6. Test mode

Two independent mechanisms. Both are needed and they do different jobs.

**`?test=1` on the staff URL** — full UI, real validation, writes nothing to `coupons`.
This is what David uses to demo to the Carvel manager. Show a thick diagonal-striped
banner reading `TEST MODE — NOTHING IS BEING RECORDED`. It must be impossible to confuse
with live mode.

**Test serials `900001`–`900010`** — seeded with `is_test = true` and deliberately
outside the active range. In *live* mode they return `NOT VALID`.

These combine usefully: the SAMPLE coupon printed on the register sign carries `900001`,
so an accidental scan of the sign is harmless, and a deliberate one demonstrates the
rejection path live.

---

## 7. Admin — `/admin`

Supabase email auth, David only.

- **Cards:** Issued · Redeemed · Remaining · **Amount owed** (from `v_summary`)
- **Chart:** redemptions per day (`v_daily`)
- **Log** (`/admin/log`): sortable, searchable by serial, filter by result.
  **CSV export** — this is the artifact for settling with Carvel, so include serial,
  redeemed_at, store, result.
- **Settings** (`/admin/settings`): edit `serial_min`/`serial_max`, toggle `enabled`, set
  `unit_cost`, manage stores.
- **Un-redeem:** call `unredeem(serial, reason, actor)`. Requires a typed reason. Staff
  will misscan and someone will need to fix it without touching SQL.

---

## 8. Security — read before launch

The barcodes encode **plain sequential serials with no signature**. Anyone who sees one
coupon can infer `000124` probably exists and could print a lookalike.

**The scan prevents reuse, not forgery.** That is an acceptable trade for a community
giveaway of 500 ice creams, *provided staff physically collect the coupon* — which is
step 3 on the printed register sign. The 500 coupons are already printed; do not try to
retrofit this.

If forgery protection is ever needed, the fix is a reprint with a short HMAC appended to
the payload (`000123-7F2A`), verified server-side in `redeem()`. Design the parser now so
it tolerates an optional `-XXXX` suffix, and you can add it later without reprinting the
scanner.

Also: anyone with the register URL can burn coupons. The token is unguessable and the
sign lives behind a counter. If a token leaks, add a row to `stores`, disable the old one,
regenerate the sign (§10). That is the whole rotation story.

---

## 9. Build order

1. Supabase project → run `supabase/01→04` in order → verify the checks at the bottom
   of `04_rls.sql`
2. Next.js skeleton, env wired, `lib/redeem.ts` calling the RPC
3. **Manual entry path first** — prove redemption end to end before touching a camera
4. Result panel + sounds + haptics + auto-reset
5. Camera scanning, `BarcodeDetector` then ZXing fallback
6. `?test=1` mode + banner
7. Admin: auth, cards, chart, log, CSV
8. Settings + un-redeem
9. Deploy, get the real URL, regenerate the sign (§10)
10. Field test (§11)

---

## 10. Regenerating the register sign

The sign is already built and working in `print/`. It takes the URL from an env var, so
once the app is deployed:

```bash
cd print
pip install -r requirements.txt
APP_URL="https://YOUR-REAL-DOMAIN/s/CARVEL-WLB" python3 sign.py Carvel_Register_Sign.pdf
```

That regenerates the QR. Everything else on the sheet stays identical.

The QR is Error Correction Level Q (~25% recoverable) at 2.62 in. **Laminate it** — it
lives next to an ice cream machine.

---

## 11. Acceptance tests

Do not call it done until all of these pass **on a real phone**, not a desktop browser.

- [ ] Scan `000001` → GREEN. Scan it again → RED with the correct original timestamp.
- [ ] Two phones scan the same serial within the same second → exactly one GREEN.
- [ ] Type `000002` manually → GREEN. Type `999999` → NOT VALID.
- [ ] Scan the SAMPLE coupon on the printed sign in live mode → NOT VALID.
- [ ] Same sample with `?test=1` → TEST — VALID, and `coupons` is unchanged.
- [ ] Airplane mode → amber NO CONNECTION, nothing recorded, nothing approved.
- [ ] Dim light and a crumpled coupon → decodes, or manual entry is obviously available.
- [ ] iOS Safari **and** Android Chrome both scan.
- [ ] Admin count matches a hand count of `scan_log` rows with `result = 'ok'`.
- [ ] Amount owed = redeemed × unit_cost, checked with a calculator.
- [ ] Signed out, hitting `/admin` redirects to login; the anon key cannot read `coupons`.

---

## 12. Added after this brief

Two capabilities requested during the build. Both are live; the detail and the
reasoning behind the defaults are in `docs/OVERRIDE_AND_LOCATION.md`.

### Manual override — redeem without a readable number

Barcode won't scan *and* the printed digits are gone. Staff tap **Can't scan or read
the coupon?**, pick one of three reasons, and the coupon is redeemed.

The hard requirement is that this cannot inflate the giveaway. It does not create a
redemption out of nothing: `redeem_override()` **claims one real, unclaimed coupon
row** from the top of the active range, so scans and overrides draw from the same
finite 500. When none are left it returns `exhausted` and serves nothing. The cap is
structural — there are 500 rows — not a counter that can drift.

Every override writes to `override_log` with its reason, and to `scan_log` with result
`override` rather than `ok`, so the record shown to Carvel distinguishes a scanned
coupon from a staff judgement call.

### Location tagging

Every scan records the phone's position, and the server measures it against the
register's own coordinates (`stores.lat/lon`, seeded for 175 Monmouth Rd and
re-settable from the admin screen with one tap while standing at the counter).

**Default is record-and-flag, not block** (`stores.enforce_geofence = false`). Indoor
GPS is routinely 100 m+ out, and a staffer who declines the location prompt has no fix
at all; with blocking on, both become refusals in front of a customer. A scan is only
called `far` when it is outside the radius by **more than its own reported accuracy**.
Flip enforcement on per register once the log shows what real accuracy looks like.

Acquiring a fix never delays a scan: the page starts a location watch on load and each
scan sends whatever is on hand, possibly nothing.

### Extra acceptance tests

- [ ] Override with all 500 claimed → **NONE LEFT**, and `coupons` redeemed count is
      still exactly 500.
- [ ] Two phones override at the same instant → two different serials, neither blocks.
- [ ] Scan from home with enforcement off → GREEN, and the log row reads `off-site`.
- [ ] Same scan with enforcement on → **WRONG LOCATION**, and nothing is claimed.
- [ ] Location permission denied → scans still work, logged `no location`.
