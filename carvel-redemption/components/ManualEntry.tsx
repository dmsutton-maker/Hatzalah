"use client";

import { useState } from "react";

/**
 * The fallback that is not really a fallback. Barcodes get crumpled, greasy and folded
 * through the middle — typing the six digits is Tuesday, not an edge case. So this is
 * always visible, never hidden behind a "having trouble?" link.
 */
export default function ManualEntry({
  onSubmit,
  busy,
}: {
  onSubmit: (value: string) => void;
  busy: boolean;
}) {
  const [value, setValue] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    onSubmit(trimmed);
    setValue("");
  }

  return (
    <form onSubmit={submit} className="w-full">
      <label htmlFor="serial" className="block text-lg font-semibold text-white/80">
        Or type the 6 digits under the barcode
      </label>

      <div className="mt-3 flex gap-3">
        <input
          id="serial"
          name="serial"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          pattern="[0-9]*"
          maxLength={6}
          placeholder="000123"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
          className="min-w-0 flex-1 rounded-xl border-2 border-white/30 bg-black/40 px-4 py-5 text-center font-mono text-4xl tracking-[0.2em] text-white placeholder:text-white/30 focus:border-white focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || value.length === 0}
          className="rounded-xl bg-white px-7 py-5 text-2xl font-black uppercase text-black disabled:opacity-40"
        >
          Check
        </button>
      </div>
    </form>
  );
}
