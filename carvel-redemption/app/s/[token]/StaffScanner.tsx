"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Scanner from "@/components/Scanner";
import ManualEntry from "@/components/ManualEntry";
import ResultPanel from "@/components/ResultPanel";
import TestBanner from "@/components/TestBanner";
import OverrideEntry from "@/components/OverrideEntry";
import { redeem, redeemOverride, type RedeemOutcome } from "@/lib/redeem";
import { playFailure, playNeutral, playSuccess, unlockAudio } from "@/lib/sound";
import { startWatching, type GeoState } from "@/lib/geo";

/** One coupon held in frame must not fire twice. BUILD_BRIEF §5. */
const DEBOUNCE_MS = 3000;

/** How long the answer stays up before the camera comes back. */
const AUTO_RETURN_MS = 4000;

const MUTE_KEY = "carvel.muted";

export default function StaffScanner({
  storeToken,
  testMode,
}: {
  storeToken: string;
  testMode: boolean;
}) {
  const [outcome, setOutcome] = useState<RedeemOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [geo, setGeo] = useState<GeoState>("idle");

  const lastScan = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const busyRef = useRef(false);

  // Persisted so a staffer who mutes it at 8pm does not have to mute it again at 8:05.
  useEffect(() => {
    try {
      setMuted(localStorage.getItem(MUTE_KEY) === "1");
    } catch {
      // Private mode. Default to sound on.
    }
  }, []);

  function toggleMute() {
    setMuted((m) => {
      const next = !m;
      try {
        localStorage.setItem(MUTE_KEY, next ? "1" : "0");
      } catch {
        // Nothing to do; the toggle still holds for this session.
      }
      return next;
    });
  }

  // Start looking for a location the moment the page opens, so a scan never waits on
  // a GPS lock. Whatever fix exists at scan time is what gets sent — possibly none.
  useEffect(() => startWatching(setGeo), []);

  // iOS refuses to make sound from an AudioContext that was never touched by a gesture.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  /** Shared tail for both paths: announce it, show it, release the lock. */
  const finish = useCallback(
    (result: RedeemOutcome) => {
      if (result.result === "ok" || result.result === "test" || result.result === "override") {
        playSuccess(muted);
      } else if (result.result === "bad_format" || result.result === "offline") {
        playNeutral(muted);
      } else {
        playFailure(muted);
      }

      setOutcome(result);
      busyRef.current = false;
      setBusy(false);
    },
    [muted],
  );

  const check = useCallback(
    async (raw: string) => {
      const now = Date.now();

      if (busyRef.current) return;
      if (raw === lastScan.current.code && now - lastScan.current.at < DEBOUNCE_MS) return;

      lastScan.current = { code: raw, at: now };
      busyRef.current = true;
      setBusy(true);

      finish(await redeem(raw, storeToken, testMode));
    },
    [finish, storeToken, testMode],
  );

  const override = useCallback(
    async (reason: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);

      finish(await redeemOverride(reason, storeToken, testMode));
    },
    [finish, storeToken, testMode],
  );

  const dismiss = useCallback(() => {
    setOutcome(null);
    // Let the same coupon be re-checked deliberately right after dismissing.
    lastScan.current = { code: "", at: 0 };
  }, []);

  return (
    <main className="no-select mx-auto flex min-h-screen w-full max-w-xl flex-col">
      {testMode ? <TestBanner /> : null}

      <header className="flex items-baseline justify-between px-4 pb-2 pt-4">
        <h1 className="text-xl font-black uppercase tracking-wide">Coupon check</h1>
        <button
          type="button"
          onClick={toggleMute}
          aria-pressed={muted}
          className="rounded-full border border-white/25 px-3 py-1 text-sm font-semibold text-white/80 active:bg-white/10"
        >
          {muted ? "Sound off" : "Sound on"}
        </button>
      </header>

      <div className="px-4">
        <Scanner onDecode={check} paused={busy || outcome !== null} />
      </div>

      <div className="px-4 pt-5">
        <ManualEntry onSubmit={check} busy={busy} />
      </div>

      <div className="px-4 pt-4">
        <OverrideEntry onOverride={override} busy={busy} />
      </div>

      <ol className="mt-6 space-y-1 px-4 pb-8 text-base text-white/60">
        <li>1. Scan or type the number.</li>
        <li>2. Green means serve one Kiddie Cup.</li>
        <li>3. Keep the coupon.</li>
      </ol>

      <footer className="mt-auto space-y-1 px-4 pb-6 text-xs text-white/30">
        <p className="uppercase tracking-wide">{storeToken} · Jersey Shore Hatzalah</p>
        {/* Staff should know the phone's location is recorded. It is never a reason a
            scan fails by default — see 07_geo.sql. */}
        <p>
          {geo === "ok"
            ? "Location recorded with each scan."
            : geo === "denied"
              ? "Location off — scans still work, they are just not location-stamped."
              : geo === "unavailable"
                ? "Location unavailable on this device — scans still work."
                : "Finding location… scans work either way."}
        </p>
      </footer>

      {busy ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 text-2xl font-bold">
          Checking…
        </div>
      ) : null}

      {outcome ? (
        <ResultPanel outcome={outcome} autoDismissMs={AUTO_RETURN_MS} onDismiss={dismiss} />
      ) : null}
    </main>
  );
}
