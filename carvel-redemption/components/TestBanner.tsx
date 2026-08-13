"use client";

/**
 * Must be impossible to mistake for live mode — this is what David demos to the Carvel
 * manager, and a demo that looks live would train staff to trust a screen that records
 * nothing. Hazard stripes, full width, always on top.
 */
export default function TestBanner() {
  return (
    <div
      className="sticky top-0 z-40 w-full border-y-4 border-black py-3 text-center"
      style={{
        backgroundImage:
          "repeating-linear-gradient(45deg, #f5c518 0 18px, #1a1a1a 18px 36px)",
      }}
    >
      <span className="inline-block bg-black/85 px-4 py-1 text-lg font-black uppercase tracking-wide text-[#f5c518]">
        Test mode — nothing is being recorded
      </span>
    </div>
  );
}
