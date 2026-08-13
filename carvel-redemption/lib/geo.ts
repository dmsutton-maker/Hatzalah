"use client";

/**
 * Where the phone is when a coupon is checked.
 *
 * The one rule that shapes this file: **acquiring a fix must never delay a scan.**
 * A GPS lock can take 10+ seconds indoors, and a register with a line does not have
 * 10 seconds. So the page starts a watch on load and keeps the most recent fix in
 * memory; a scan sends whatever is on hand at that moment, or nothing.
 *
 * Sending nothing is a normal outcome, not an error — the server records it as
 * `no_fix` and (by default) still redeems. See 07_geo.sql for why flagging beats
 * blocking here.
 */

export type Fix = { lat: number; lon: number; acc: number };

export type GeoState = "idle" | "waiting" | "ok" | "denied" | "unavailable";

let latest: Fix | null = null;
let watchId: number | null = null;
let watchers = 0;

/** The freshest fix, or null. Never blocks. */
export function currentFix(): Fix | null {
  return latest;
}

/**
 * Start watching. Returns a stop function. Reference-counted, so several components
 * can call it without fighting over the single browser watch.
 */
export function startWatching(onState: (s: GeoState) => void): () => void {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    onState("unavailable");
    return () => {};
  }

  watchers += 1;
  onState(latest ? "ok" : "waiting");

  if (watchId === null) {
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        latest = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          acc: pos.coords.accuracy,
        };
        onState("ok");
      },
      (err) => {
        // PERMISSION_DENIED is a decision, not a fault. Everything still works.
        onState(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable");
      },
      {
        enableHighAccuracy: true,
        // A register does not move. A half-minute-old fix is as good as a new one,
        // and reusing it saves the radio.
        maximumAge: 30_000,
        timeout: 20_000,
      },
    );
  }

  return () => {
    watchers = Math.max(0, watchers - 1);
    if (watchers === 0 && watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  };
}

/** One-shot fix, for the admin "use my current location" button. */
export function getFixOnce(timeoutMs = 15_000): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("This browser cannot report a location."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          acc: pos.coords.accuracy,
        }),
      (err) => reject(new Error(err.message || "Could not get a location.")),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}
