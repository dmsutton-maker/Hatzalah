"use client";

import { useEffect, useState } from "react";
import type { RedeemOutcome } from "@/lib/redeem";
import { formatSerial } from "@/lib/serial";
import { formatStamp } from "@/lib/format";

/**
 * The whole answer, full-bleed, in one glance from across a counter.
 * Colour carries the meaning; the words confirm it.
 */

type Tone = "valid" | "invalid" | "caution" | "testing";

const TONE_BG: Record<Tone, string> = {
  valid: "bg-valid",
  invalid: "bg-invalid",
  caution: "bg-caution",
  testing: "bg-testing",
};

export default function ResultPanel({
  outcome,
  autoDismissMs,
  onDismiss,
}: {
  outcome: RedeemOutcome;
  autoDismissMs: number;
  onDismiss: () => void;
}) {
  const { tone, headline, sub } = describe(outcome);
  const [remaining, setRemaining] = useState(Math.ceil(autoDismissMs / 1000));

  useEffect(() => {
    const dismiss = setTimeout(onDismiss, autoDismissMs);
    const tick = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => {
      clearTimeout(dismiss);
      clearInterval(tick);
    };
  }, [autoDismissMs, onDismiss]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      // The raw result code, for field debugging and end-to-end tests. Next's own
      // route announcer is also role="alert", so this is the reliable hook.
      data-result={outcome.result}
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center px-6 text-center text-white ${TONE_BG[tone]}`}
    >
      <p className="text-[clamp(3rem,16vw,7rem)] font-black uppercase leading-none tracking-tight">
        {headline}
      </p>

      {sub.map((line, i) => (
        <p
          key={i}
          className={
            i === 0
              ? "mt-6 text-[clamp(1.5rem,7vw,2.5rem)] font-bold leading-tight"
              : "mt-2 text-[clamp(1.125rem,5vw,1.75rem)] font-medium leading-tight opacity-90"
          }
        >
          {line}
        </p>
      ))}

      <button
        type="button"
        onClick={onDismiss}
        className="mt-12 w-full max-w-sm rounded-2xl border-4 border-white/70 bg-white/10 px-6 py-6 text-2xl font-bold uppercase tracking-wide active:bg-white/25"
      >
        Scan next
        {remaining > 0 ? <span className="ml-2 opacity-70">({remaining})</span> : null}
      </button>
    </div>
  );
}

function describe(outcome: RedeemOutcome): {
  tone: Tone;
  headline: string;
  sub: string[];
} {
  const serial = outcome.serial != null ? `No. ${formatSerial(outcome.serial)}` : null;

  switch (outcome.result) {
    case "ok":
      return {
        tone: "valid",
        headline: "Valid",
        sub: [serial ?? "", "Serve one Kiddie Cup — keep the coupon"].filter(Boolean),
      };

    case "already_used": {
      const stamp = formatStamp(outcome.redeemedAt);
      return {
        tone: "invalid",
        headline: "Already used",
        sub: [stamp ? `Redeemed ${stamp}` : "This coupon was already redeemed", serial ?? ""].filter(
          Boolean,
        ),
      };
    }

    case "out_of_range":
      return {
        tone: "invalid",
        headline: "Not valid",
        sub: ["Not part of this program", serial ?? ""].filter(Boolean),
      };

    case "not_found":
      return {
        tone: "invalid",
        headline: "Not valid",
        sub: ["Unknown coupon number", serial ?? ""].filter(Boolean),
      };

    case "bad_format":
      return {
        tone: "caution",
        headline: "Check number",
        sub: ["Enter the 6 digits under the barcode"],
      };

    case "test":
      return {
        tone: "testing",
        headline: "Test — valid",
        sub: [serial ?? "", "Nothing was recorded"].filter(Boolean),
      };

    case "offline":
      return {
        tone: "caution",
        headline: "No connection",
        sub: ["Try again — nothing was recorded", "Do not serve until this shows VALID"],
      };

    case "override":
      return {
        tone: "valid",
        headline: "Valid",
        sub: [
          "Serve one Kiddie Cup — keep the coupon",
          serial
            ? `Manual override · counted as ${serial}`
            : "Manual override · counted against the total",
          outcome.remaining != null ? `${outcome.remaining} coupons left` : "",
        ].filter(Boolean),
      };

    case "exhausted":
      return {
        tone: "invalid",
        headline: "None left",
        sub: ["Every coupon in this program is already redeemed", "Do not serve"],
      };

    case "wrong_location":
      return {
        tone: "invalid",
        headline: "Wrong location",
        sub: [
          "This coupon can only be redeemed at the store",
          outcome.distanceM != null ? `${describeDistance(outcome.distanceM)} away` : "",
        ].filter(Boolean),
      };
  }
}

function describeDistance(metres: number): string {
  if (metres < 1000) return `About ${Math.round(metres / 10) * 10} m`;
  return `About ${(metres / 1609).toFixed(metres < 16090 ? 1 : 0)} miles`;
}
