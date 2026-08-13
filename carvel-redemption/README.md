# Carvel Coupon Redemption — Jersey Shore Hatzalah

Everything needed to build and run the redemption system for the Helmet Safety Reward
ice cream coupons, start to finish.

**Hand this whole folder to Claude Code and say: "Build this. Start with `BUILD_BRIEF.md`."**

---

## The situation

500 serialized coupons (`000001`–`000500`) are **already printed** — one free Carvel
Kiddie Cup each, expiring 12/31/2026, handed out to kids caught wearing bike helmets.
Every coupon carries a Code 128 barcode encoding its plain 6-digit serial.

What's missing is the system around them:

- Carvel staff need to check a coupon is real and unused, in seconds, with no training.
- David needs to know how many were used, how many are left, and what to pay Carvel.
- A coupon must never be redeemable twice.

---

## What's in this folder

| Path | Status | What it is |
|---|---|---|
| `BUILD_BRIEF.md` | **spec** | Full implementation brief. Claude Code's main input. |
| `supabase/01_schema.sql` | **ready** | Tables and indexes |
| `supabase/02_seed.sql` | **ready** | Seeds serials 1–500, demo serials, store, range |
| `supabase/03_functions.sql` | **ready** | `redeem()` RPC, `unredeem()`, reporting views |
| `supabase/04_rls.sql` | **ready** | RLS + grants. Anon gets one function, zero tables. |
| `supabase/05_override.sql` | **ready** | Manual override for unreadable coupons, capped at the printed allotment |
| `supabase/06_admin_grants.sql` | **ready** | The extra grants the settings screen needs |
| `supabase/07_geo.sql` | **ready** | Location tagging + geofence. Supersedes the function bodies in 03/05 |
| `print/` | **working** | Coupon + sign generators. Already produce final PDFs. |
| `docs/` | reference | Design decisions, the printed-artwork spec, and the override/location rationale |
| `app/`, `components/`, `lib/` | **built** | The Next.js app |
| `tests/` | **built** | Playwright acceptance scripts + a throwaway local backend |

---

## Order of operations

### 1. Supabase (15 min)

Create a project. In the SQL editor run, **in order**:
`01_schema.sql` → `02_seed.sql` → `03_functions.sql` → `04_rls.sql` →
`05_override.sql` → `06_admin_grants.sql` → `07_geo.sql`

Order matters: `07` drops and recreates `redeem()` and `redeem_override()` with their
location parameters, and reapplies their grants.

Then run the verification block at the bottom of `04_rls.sql`. Anon must **not** be able
to `select * from coupons`, and **must** be able to execute `redeem()`.

> ⚠️ In `02_seed.sql`, `unit_cost` is seeded at **0.00**. Set it to the real per-cup price
> negotiated with Carvel or the admin dashboard will report $0 owed.

### 2. The app

Built. `npm install`, copy `.env.local.example` to `.env.local`, fill in the two
Supabase values, `npm run dev`.

- `/s/CARVEL-WLB` — the staff screen (add `?test=1` to demo it safely)
- `/admin` — dashboard, log, settings

### 3. Deploy

Netlify or Vercel. Set the two env vars from `BUILD_BRIEF.md` §4. `netlify.toml` at the
repo root already points at this subdirectory.

Then create David's admin user in **Supabase → Authentication → Users**. There is no
sign-up screen, deliberately.

### 4. Regenerate the sign with the real URL

```bash
cd print
pip install -r requirements.txt
APP_URL="https://YOUR-REAL-DOMAIN/s/CARVEL-WLB" python3 sign.py Carvel_Register_Sign.pdf
```

Print on letter, **laminate**, tape by the register.

### 5. Field test

Work through the checklist in `BUILD_BRIEF.md` §11 on a real phone. Two of those tests
have caught real bugs in similar systems: simultaneous scans from two phones, and
airplane mode.

---

## The print pipeline (already done, kept for reprints)

```bash
cd print
pip install -r requirements.txt

# 500 coupons, 18 per 13x19 sheet, 28 pages
python3 gen_grid.py 1 500 Coupons.pdf

# register sign
APP_URL="https://..." python3 sign.py Sign.pdf
```

**Coupon:** 4.1667 × 3.0833 in, 3 across × 6 down on 13 × 19, 0.25 in margins, cut ticks
in the margins. Barcode is Code 128 with 24 mil narrow bars — verified decoding down to
150 dpi.

**Sign:** letter, 2.62 in QR at EC level Q, plus a SAMPLE coupon **at exact actual size**
carrying test serial `900001`.

To change the serial range, expiry, or store address, edit `gen_grid.py` and
`layout50.json` — layout values are in a 180 pt-wide coordinate space and scale linearly,
so a different N-up size needs only `COLS`/`ROWS` changed at the top of `gen_grid.py`.

---

## Three things to set before launch

**1. Per-cup cost.** Needed for the "amount owed" figure. Set it in `02_seed.sql` or via
the admin settings screen.

**2. The register's real coordinates.** The store position is seeded from a geocode,
which can be tens of metres off. Stand at the register once and press **Settings →
Registers → Use my current location**. Location is recorded but does *not* block a
redemption unless you switch enforcement on — see `docs/OVERRIDE_AND_LOCATION.md` for
why that default is the way round it is.

**3. Forgery, knowingly accepted.** The barcodes encode plain sequential serials with no
signature. The system prevents a coupon being used *twice*; it does not prevent someone
printing a lookalike with an unused number. That's an acceptable trade for 500 community
ice creams **as long as staff physically collect the coupon** — which the sign instructs.
See `BUILD_BRIEF.md` §8 for the upgrade path if it ever matters.
