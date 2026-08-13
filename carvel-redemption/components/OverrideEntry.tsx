"use client";

import { useState } from "react";

/**
 * The escape hatch for a coupon that is genuinely real but genuinely unreadable —
 * barcode won't scan AND the printed number is gone.
 *
 * Deliberately two taps and deliberately subordinate: opening it takes one tap,
 * naming a reason takes the second, and the reason is what gets written to
 * override_log. There is no free-text box — a stranger at a busy register will type
 * nothing useful, and three named reasons make the admin log actually readable.
 *
 * The cap is not enforced here. It is enforced in the database, which claims one real
 * coupon row per override and returns `exhausted` when the 500 run out.
 */

const REASONS = [
  "Barcode won't scan",
  "Number unreadable",
  "Coupon torn or wet",
] as const;

export default function OverrideEntry({
  onOverride,
  busy,
}: {
  onOverride: (reason: string) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-xl border border-white/20 px-4 py-4 text-base font-semibold text-white/60 active:bg-white/10"
      >
        Can&rsquo;t scan or read the coupon?
      </button>
    );
  }

  return (
    <div className="rounded-xl border-2 border-caution/70 bg-caution/10 p-4">
      <p className="text-base font-bold text-white">
        Redeem without the number?
      </p>
      <p className="mt-1 text-sm text-white/60">
        Only if you are holding a real coupon. This uses one from the total, and it
        cannot be undone here.
      </p>

      <div className="mt-4 space-y-2">
        {REASONS.map((reason) => (
          <button
            key={reason}
            type="button"
            disabled={busy}
            onClick={() => {
              setOpen(false);
              onOverride(reason);
            }}
            className="w-full rounded-lg bg-white px-4 py-4 text-lg font-bold text-black disabled:opacity-40"
          >
            {reason}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setOpen(false)}
        className="mt-3 w-full rounded-lg px-4 py-3 text-base font-semibold text-white/60"
      >
        Cancel
      </button>
    </div>
  );
}
