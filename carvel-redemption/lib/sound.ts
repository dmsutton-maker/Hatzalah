"use client";

/**
 * Audible + haptic confirmation. Staff will not be looking at the screen — they will be
 * looking at the customer — so the phone has to say what happened out loud.
 */

let ctx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

/**
 * iOS will not produce sound from an AudioContext created or resumed outside a user
 * gesture. Call this from the first tap anywhere on the page.
 */
export function unlockAudio(): void {
  const ac = audioContext();
  if (ac && ac.state === "suspended") void ac.resume();
}

function tone(startAt: number, freq: number, durationMs: number, gain: number): void {
  const ac = audioContext();
  if (!ac) return;

  const osc = ac.createOscillator();
  const amp = ac.createGain();
  const t0 = ac.currentTime + startAt;
  const dur = durationMs / 1000;

  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, t0);

  // Short ramps at both ends: a square-edged gate clicks on phone speakers.
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(amp).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Unsupported (iOS Safari). The sound and the full-screen colour still carry it.
  }
}

/** Rising two-tone. Means: serve the ice cream. */
export function playSuccess(muted: boolean): void {
  vibrate(60);
  if (muted) return;
  const ac = audioContext();
  if (ac?.state === "suspended") void ac.resume();
  tone(0, 660, 110, 0.22);
  tone(0.1, 990, 160, 0.22);
}

/** Low buzz. Means: stop, look at the screen. */
export function playFailure(muted: boolean): void {
  vibrate([80, 60, 80]);
  if (muted) return;
  const ac = audioContext();
  if (ac?.state === "suspended") void ac.resume();
  tone(0, 180, 260, 0.25);
  tone(0.22, 150, 300, 0.25);
}

/** Neutral tick, for test mode and no-connection. Neither approval nor rejection. */
export function playNeutral(muted: boolean): void {
  vibrate([40, 40, 40]);
  if (muted) return;
  const ac = audioContext();
  if (ac?.state === "suspended") void ac.resume();
  tone(0, 440, 120, 0.18);
  tone(0.16, 440, 120, 0.18);
}
