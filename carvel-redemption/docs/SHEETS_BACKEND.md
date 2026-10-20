# Google Sheets backend

Replaces Supabase. The Sheet is the ledger **and** the admin; a Google Apps Script web app
(`gas/Code.gs`) is the only thing the staff screen talks to.

```
phone  ──POST──▶  Apps Script web app  ──▶  Google Sheet
                  (takes a lock, claims          tabs: Summary · Coupons · Log
                   one row, answers)                   Overrides · Settings
```

## What changed for staff: nothing
Same screen, same colours, same sounds, same override button. Scans can take a second or
two longer — Apps Script is slower than a database, and a script that has sat idle needs a
moment to wake up. The client waits up to 12 s before it fails closed.

## What changed for David

| Before (Supabase) | Now |
|---|---|
| `/admin` dashboard with a login | **The Sheet.** `/admin` forwards to it. Access is your Google account. |
| Settings page | **Settings tab.** Edit cells: range, unit cost, kill-switch, register, geofence |
| Scan log + CSV export | **Log tab.** File → Download → CSV |
| Un-redeem page | **Carvel menu → Un-redeem a coupon…** (asks for a reason, logs it) |
| Nightly report via SQL function | Same report, reads `?action=stats` from the script |

The `Hatz7856` login no longer exists — there is no password to guess. Whoever the Sheet is
shared with can open it, nobody else.

## The one rule: a coupon can never be redeemed twice
Every scan runs inside `LockService.getScriptLock()`. Two phones scanning the same coupon in
the same second are queued: the first claims the row, the second then reads it as already
claimed. The sheet is read **after** taking the lock, never before — `tests/sheets-backend.test.mjs`
fails if that ever changes.

This is weaker than the database it replaces in one honest way: a lock serialises *all*
scans, not just scans of the same coupon, so a very busy moment queues up. At one register
that is a non-issue.

## The cap (override)
Override claims one real unclaimed row from the top of the range. There are as many rows as
printed coupons, so scans and overrides share one finite pool and total redemptions cannot
exceed it. When none are left: `exhausted`.

## Editing the Sheet by hand
Safe: Settings cells, the `note` column, un-redeeming via the menu.
**Not safe: typing in `Coupons` columns C–E.** A hand-edited redemption has no log entry.
Use the menu to un-redeem so there is a record.

## Moving, resetting, redeploying
* Editing the code → Apps Script **Deploy → Manage deployments → ✎ → New version**. A *new
  deployment* gets a *new URL*, which means updating `NEXT_PUBLIC_REDEEM_URL` and
  redeploying the site.
* `setup()` refuses to run if the Coupons tab already has data, so it cannot wipe real
  redemptions. To start over, clear the tabs yourself first.

## Tests
```
node tests/sheets-backend.test.mjs       # the rules, against a stand-in for Google (56 checks)
node tests/local-harness/gas-server.mjs  # serve the script locally, incl. Google's POST redirect
NEXT_PUBLIC_REDEEM_URL=http://127.0.0.1:3002/exec npm run dev
node tests/staff-flow.mjs && node tests/location.mjs
```
These prove the rules. Only the deployed script can prove Google's runtime — check a real
scan on a real phone, and check the response headers (`curl -L -i -H 'Origin: https://…'`)
for `Access-Control-Allow-Origin`.

## The old database
`supabase/*.sql` is kept for reference only; nothing reads it. It can be paused or deleted.
