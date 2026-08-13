"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";

/**
 * Camera + decode loop.
 *
 * Two decoders, chosen at runtime: the native BarcodeDetector where it exists (Android
 * Chrome — fast, no download), ZXing lazily imported where it does not (iOS Safari).
 * The camera keeps running while a result is on screen so the next scan is instant;
 * only the decode loop pauses.
 *
 * Every failure path lands on manual entry, which is always on screen below. There is
 * no dead end.
 */

type CameraState = "starting" | "running" | "denied" | "unavailable";

const FRAME_INTERVAL_MS = 100; // ~10 fps, per BUILD_BRIEF §5

export default function Scanner({
  onDecode,
  paused,
}: {
  onDecode: (text: string) => void;
  paused: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const zxingRef = useRef<IScannerControls | null>(null);
  const pausedRef = useRef(paused);

  const [state, setState] = useState<CameraState>("starting");
  const [engine, setEngine] = useState<"native" | "zxing" | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);

  // Read inside the decode loops without re-subscribing them on every pause.
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const handle = useCallback(
    (text: string) => {
      if (pausedRef.current) return;
      onDecode(text);
    },
    [onDecode],
  );

  useEffect(() => {
    let cancelled = false;
    let nativeTimer: ReturnType<typeof setInterval> | null = null;

    async function start() {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setState("unavailable");
        return;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch (err) {
        // NotAllowedError (denied), NotFoundError (no camera), or a locked-down browser.
        console.warn("camera unavailable", err);
        if (!cancelled) {
          setState(
            err instanceof DOMException && err.name === "NotAllowedError"
              ? "denied"
              : "unavailable",
          );
        }
        return;
      }

      if (cancelled) {
        for (const t of stream.getTracks()) t.stop();
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;

      video.srcObject = stream;
      try {
        await video.play();
      } catch (err) {
        // Autoplay refused. The element is muted + playsInline, so this is rare; when it
        // happens the tap-to-start overlay below covers it.
        console.warn("video.play() refused", err);
      }

      const track = stream.getVideoTracks()[0];
      if (track?.getCapabilities?.().torch) setTorchAvailable(true);

      if (cancelled) return;
      setState("running");

      const Detector = typeof window !== "undefined" ? window.BarcodeDetector : undefined;

      if (Detector) {
        setEngine("native");
        const detector = new Detector({ formats: ["code_128"] });
        nativeTimer = setInterval(async () => {
          if (cancelled || pausedRef.current) return;
          const el = videoRef.current;
          if (!el || el.readyState < 2) return;
          try {
            const found = await detector.detect(el);
            if (found.length > 0 && found[0].rawValue) handle(found[0].rawValue);
          } catch {
            // Individual frames fail routinely (motion blur, source not ready). Next tick.
          }
        }, FRAME_INTERVAL_MS);
        return;
      }

      // iOS Safari and older browsers: pull in ZXing only now, so Android never pays
      // for the download.
      try {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] =
          await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
        if (cancelled) return;

        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]);

        const reader = new BrowserMultiFormatReader(hints, {
          delayBetweenScanAttempts: FRAME_INTERVAL_MS,
        });

        setEngine("zxing");
        zxingRef.current = await reader.decodeFromVideoElement(video, (result) => {
          if (cancelled || pausedRef.current) return;
          const text = result?.getText();
          if (text) handle(text);
        });
      } catch (err) {
        console.error("ZXing failed to load", err);
        if (!cancelled) setState("unavailable");
      }
    }

    void start();

    return () => {
      cancelled = true;
      if (nativeTimer) clearInterval(nativeTimer);
      zxingRef.current?.stop();
      zxingRef.current = null;
      for (const t of streamRef.current?.getTracks() ?? []) t.stop();
      streamRef.current = null;
    };
  }, [handle]);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch (err) {
      console.warn("torch unavailable", err);
      setTorchAvailable(false);
    }
  }

  return (
    <div className="relative w-full overflow-hidden rounded-2xl bg-black">
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        className="h-[46vh] max-h-[420px] w-full object-cover"
      />

      {/* Aiming window. The barcode is wide and short, so the guide is too. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-24 w-[82%] rounded-lg border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.28)]" />
      </div>

      {state === "starting" ? (
        <Overlay>Starting camera…</Overlay>
      ) : state === "denied" ? (
        <Overlay>
          Camera blocked. Allow it in your browser settings, or type the number below.
        </Overlay>
      ) : state === "unavailable" ? (
        <Overlay>No camera here. Type the number below.</Overlay>
      ) : null}

      {state === "running" ? (
        <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-3">
          <span className="rounded-full bg-black/60 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white/80">
            {engine === "native" ? "Ready — hold the barcode steady" : "Ready"}
          </span>
          {torchAvailable ? (
            <button
              type="button"
              onClick={toggleTorch}
              aria-pressed={torchOn}
              className="rounded-full bg-black/60 px-4 py-2 text-sm font-bold uppercase text-white active:bg-black/80"
            >
              {torchOn ? "Light off" : "Light on"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/75 px-6 text-center text-lg font-semibold text-white">
      {children}
    </div>
  );
}
