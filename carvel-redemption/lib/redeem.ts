"use client";

import { createClient } from "@/lib/supabase/client";
import { parseSerial } from "@/lib/serial";
import { currentFix } from "@/lib/geo";

/** Results the RPC can return, plus two the client decides on its own. */
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

/** Where the server decided the scan happened. See 07_geo.sql. */
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

type RedeemRow = {
  result: string;
  redeemed_at: string | null;
  serial: number | null;
  geo_status: GeoStatus;
  distance_m: number | null;
};

/** A slow network is indistinguishable from no network at a register. Fail closed at 8s. */
const TIMEOUT_MS = 8000;

/**
 * The single wrapper around the redeem() RPC. Nothing else in the app writes.
 *
 * Fails CLOSED: any network or server error returns `offline`, never an approval.
 * BUILD_BRIEF §5 — a wrongly approved duplicate has already given away the ice cream,
 * and that error cannot be undone in the physical world.
 */
export async function redeem(
  raw: string,
  storeToken: string,
  testMode: boolean,
): Promise<RedeemOutcome> {
  const parsed = parseSerial(raw);

  if (!parsed) {
    return { result: "bad_format", serial: null, redeemedAt: null, raw };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // Whatever fix is on hand right now. Never waited for — see lib/geo.ts.
    const fix = currentFix();

    const supabase = createClient();
    const { data, error } = await supabase
      .rpc("redeem", {
        p_serial: parsed.serial,
        p_store: storeToken,
        p_test: testMode,
        p_device: deviceHint(),
        p_lat: fix?.lat ?? null,
        p_lon: fix?.lon ?? null,
        p_acc: fix?.acc ?? null,
      })
      .abortSignal(controller.signal);

    if (error) {
      // Could be offline, could be a server fault. Either way we do not know whether the
      // coupon was claimed, so we refuse rather than guess.
      console.error("redeem() failed", error);
      return { result: "offline", serial: parsed.serial, redeemedAt: null, raw };
    }

    const row = (Array.isArray(data) ? data[0] : data) as RedeemRow | undefined;
    if (!row) {
      return { result: "offline", serial: parsed.serial, redeemedAt: null, raw };
    }

    return {
      result: asRedeemResult(row.result),
      serial: row.serial ?? parsed.serial,
      redeemedAt: row.redeemed_at,
      raw,
      geoStatus: row.geo_status,
      distanceM: row.distance_m,
    };
  } catch (err) {
    console.error("redeem() threw", err);
    return { result: "offline", serial: parsed.serial, redeemedAt: null, raw };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Redeem without a serial, for a coupon whose barcode AND printed number are both
 * unreadable — torn, soaked, or a bad print.
 *
 * This cannot inflate the giveaway. The RPC claims one real, unclaimed coupon row
 * from the active range, so scans and overrides draw from the same finite 500. When
 * none are left it returns `exhausted` and serves nothing. See 05_override.sql.
 */
export async function redeemOverride(
  reason: string,
  storeToken: string,
  testMode: boolean,
): Promise<RedeemOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const fix = currentFix();

    const supabase = createClient();
    const { data, error } = await supabase
      .rpc("redeem_override", {
        p_store: storeToken,
        p_reason: reason,
        p_test: testMode,
        p_device: deviceHint(),
        p_lat: fix?.lat ?? null,
        p_lon: fix?.lon ?? null,
        p_acc: fix?.acc ?? null,
      })
      .abortSignal(controller.signal);

    if (error) {
      console.error("redeem_override() failed", error);
      return { result: "offline", serial: null, redeemedAt: null, raw: reason };
    }

    const row = (Array.isArray(data) ? data[0] : data) as
      | {
          result: string;
          serial: number | null;
          remaining: number | null;
          geo_status: GeoStatus;
          distance_m: number | null;
        }
      | undefined;

    if (!row) {
      return { result: "offline", serial: null, redeemedAt: null, raw: reason };
    }

    return {
      result: asRedeemResult(row.result),
      serial: row.serial ?? null,
      redeemedAt: null,
      raw: reason,
      remaining: row.remaining,
      geoStatus: row.geo_status,
      distanceM: row.distance_m,
    };
  } catch (err) {
    console.error("redeem_override() threw", err);
    return { result: "offline", serial: null, redeemedAt: null, raw: reason };
  } finally {
    clearTimeout(timer);
  }
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
