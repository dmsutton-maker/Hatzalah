"use client";

import { parseSerial } from "@/lib/serial";
import { currentFix } from "@/lib/geo";

/** Results the backend can return, plus `offline`, which the client decides on its own. */
export type RedeemResult =
  | "ok"
  | "already_used"
  | "out_of_range"
  | "not_found"
  | "bad_format"
  | "test"
  | "offline"
  /** A manual override claimed a coupon. */
  | "override"
  /** An override was refused: every coupon in the range is already claimed. */
  | "exhausted"
  /** Refused because the scan was off-site, on a register with enforcement on. */
  | "wrong_location";

/** Where the backend decided the scan happened. */
export type GeoStatus = "ok" | "far" | "no_fix" | "unset" | null;

export type RedeemOutcome = {
  result: RedeemResult;
  /** Serial as parsed, or the serial an override consumed. Null if neither. */
  serial: number | null;
  /** For `already_used`, when it was originally redeemed. */
  redeemedAt: string | null;
  /** Whatever the scanner or keypad actually produced. Shown on bad_format. */
  raw: string;
  /** Coupons left in the active range. Set by the override path only. */
  remaining?: number | null;
  geoStatus?: GeoStatus;
  /** Metres from the register's recorded coordinates. */
  distanceM?: number | null;
};

type Reply = {
  result: string;
  redeemed_at?: string | null;
  serial?: number | null;
  remaining?: number | null;
  geo_status?: GeoStatus;
  distance_m?: number | null;
};

/**
 * A slow network is indistinguishable from no network at a register, so we fail closed.
 * Longer than it used to be: a Google Apps Script web app that has been idle needs a
 * second or two to wake up, and a scan that queues behind another one waits its turn.
 */
const TIMEOUT_MS = 12000;

/**
 * The one place the app talks to the backend: a Google Apps Script web app that owns
 * the Sheet. Nothing else in the app writes.
 *
 * The request is deliberately a "simple" one — POST with no Content-Type header, so the
 * browser sends text/plain. That avoids a CORS preflight, which Apps Script cannot answer.
 * Apps Script replies with a redirect; fetch follows it by default.
 *
 * Fails CLOSED: any network or server error returns `offline`, never an approval.
 * A wrongly approved duplicate has already given away the ice cream, and that cannot be
 * undone in the physical world.
 */
async function call(payload: Record<string, unknown>): Promise<Reply | null> {
  const url = process.env.NEXT_PUBLIC_REDEEM_URL;
  if (!url) {
    console.error("NEXT_PUBLIC_REDEEM_URL is not set");
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // Whatever fix is on hand right now. Never waited for — see lib/geo.ts.
    const fix = currentFix();

    const res = await fetch(url, {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        device: deviceHint(),
        lat: fix?.lat ?? null,
        lon: fix?.lon ?? null,
        acc: fix?.acc ?? null,
      }),
      signal: controller.signal,
      redirect: "follow",
      cache: "no-store",
    });

    if (!res.ok) {
      console.error("backend returned", res.status);
      return null;
    }

    const reply = (await res.json()) as Reply;
    // The backend reports its own failures (lock timeout, bad request) as "error".
    return reply && typeof reply.result === "string" ? reply : null;
  } catch (err) {
    // Could be offline, could be a server fault. Either way we do not know whether the
    // coupon was claimed, so we refuse rather than guess.
    console.error("backend call failed", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function redeem(
  raw: string,
  storeToken: string,
  testMode: boolean,
): Promise<RedeemOutcome> {
  const parsed = parseSerial(raw);

  if (!parsed) {
    return { result: "bad_format", serial: null, redeemedAt: null, raw };
  }

  const reply = await call({
    action: "redeem",
    serial: parsed.serial,
    store: storeToken,
    test: testMode,
  });

  if (!reply) return { result: "offline", serial: parsed.serial, redeemedAt: null, raw };

  return {
    result: asRedeemResult(reply.result),
    serial: reply.serial ?? parsed.serial,
    redeemedAt: reply.redeemed_at ?? null,
    raw,
    geoStatus: reply.geo_status ?? null,
    distanceM: reply.distance_m ?? null,
  };
}

/**
 * Redeem without a serial, for a coupon whose barcode AND printed number are both
 * unreadable — torn, soaked, or a bad print.
 *
 * This cannot inflate the giveaway. The backend claims one real, unclaimed coupon row
 * from the active range, so scans and overrides draw from the same finite 500. When
 * none are left it returns `exhausted` and serves nothing.
 */
export async function redeemOverride(
  reason: string,
  storeToken: string,
  testMode: boolean,
): Promise<RedeemOutcome> {
  const reply = await call({
    action: "override",
    reason,
    store: storeToken,
    test: testMode,
  });

  if (!reply) return { result: "offline", serial: null, redeemedAt: null, raw: reason };

  return {
    result: asRedeemResult(reply.result),
    serial: reply.serial ?? null,
    redeemedAt: null,
    raw: reason,
    remaining: reply.remaining ?? null,
    geoStatus: reply.geo_status ?? null,
    distanceM: reply.distance_m ?? null,
  };
}

const KNOWN: RedeemResult[] = [
  "ok",
  "already_used",
  "out_of_range",
  "not_found",
  "bad_format",
  "test",
  "override",
  "exhausted",
  "wrong_location",
];

function asRedeemResult(value: string): RedeemResult {
  return (KNOWN as string[]).includes(value) ? (value as RedeemResult) : "offline";
}

/**
 * A short, non-identifying tag so the scan log can tell two registers apart when a
 * redemption is disputed. Random id + browser family. No fingerprinting.
 */
function deviceHint(): string {
  let id = "";
  try {
    id = localStorage.getItem("carvel.device") ?? "";
    if (!id) {
      id = Math.random().toString(36).slice(2, 8);
      localStorage.setItem("carvel.device", id);
    }
  } catch {
    id = "nostore";
  }

  const ua = navigator.userAgent;
  const family = /iPhone|iPad|iPod/.test(ua)
    ? "ios"
    : /Android/.test(ua)
      ? "android"
      : "other";

  return `${id}/${family}`;
}
