/**
 * Redemptions per day. One series, so no legend — the heading names it. Colour carries
 * no meaning here beyond "this is the data", so it is a single hue; the grid and axis
 * stay recessive and only the peak is labelled directly.
 */

export type DailyRow = { day: string; redeemed: number };

const BAR = "#35a94b";

const W = 720;
const H = 220;
const PAD_L = 34;
const PAD_R = 8;
const PAD_T = 16;
const PAD_B = 26;

export default function DailyChart({ rows }: { rows: DailyRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-white/10 bg-white/[0.03] p-8 text-center text-white/40">
        No redemptions yet.
      </p>
    );
  }

  const days = fillGaps(rows);
  const max = Math.max(...days.map((d) => d.redeemed), 1);
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const slot = plotW / days.length;
  const barW = Math.max(2, Math.min(26, slot - 2)); // 2px surface gap between bars
  const peak = days.reduce((a, b) => (b.redeemed > a.redeemed ? b : a));

  const ticks = [0, Math.round(max / 2), max].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <figure className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Redemptions per day, ${days[0].day} to ${days[days.length - 1].day}`}
        className="h-auto w-full"
      >
        {ticks.map((t) => {
          const y = PAD_T + plotH - (t / max) * plotH;
          return (
            <g key={t}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={y}
                y2={y}
                stroke="rgba(255,255,255,0.10)"
                strokeWidth={1}
              />
              <text
                x={PAD_L - 8}
                y={y + 4}
                textAnchor="end"
                fontSize={11}
                fill="rgba(255,255,255,0.40)"
              >
                {t}
              </text>
            </g>
          );
        })}

        {days.map((d, i) => {
          const h = (d.redeemed / max) * plotH;
          const x = PAD_L + i * slot + (slot - barW) / 2;
          const y = PAD_T + plotH - h;
          if (d.redeemed === 0) return null;
          return (
            <path key={d.day} d={barPath(x, y, barW, h, 4)} fill={BAR}>
              <title>{`${d.day}: ${d.redeemed} redeemed`}</title>
            </path>
          );
        })}

        {/* Direct label on the peak only — a number on every bar is noise. */}
        <text
          x={PAD_L + days.indexOf(peak) * slot + slot / 2}
          y={PAD_T + plotH - (peak.redeemed / max) * plotH - 6}
          textAnchor="middle"
          fontSize={12}
          fontWeight={700}
          fill="rgba(255,255,255,0.85)"
        >
          {peak.redeemed}
        </text>

        {xLabels(days.length).map((i) => (
          <text
            key={i}
            x={PAD_L + i * slot + slot / 2}
            y={H - 8}
            textAnchor="middle"
            fontSize={11}
            fill="rgba(255,255,255,0.40)"
          >
            {shortDay(days[i].day)}
          </text>
        ))}
      </svg>
    </figure>
  );
}

/** Rounded top corners only; the bar stays anchored flat to the baseline. */
function barPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h, w / 2);
  return [
    `M ${x} ${y + h}`,
    `L ${x} ${y + rr}`,
    `Q ${x} ${y} ${x + rr} ${y}`,
    `L ${x + w - rr} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + rr}`,
    `L ${x + w} ${y + h}`,
    "Z",
  ].join(" ");
}

/** A day with no redemptions is data, not a missing row — draw the gap. */
function fillGaps(rows: DailyRow[]): DailyRow[] {
  const sorted = [...rows].sort((a, b) => a.day.localeCompare(b.day));
  const out: DailyRow[] = [];
  const cursor = new Date(`${sorted[0].day}T00:00:00Z`);
  const end = new Date(`${sorted[sorted.length - 1].day}T00:00:00Z`);
  const byDay = new Map(sorted.map((r) => [r.day, r.redeemed]));

  // Guard against a bad date landing us in an unbounded loop.
  let safety = 0;
  while (cursor <= end && safety++ < 800) {
    const key = cursor.toISOString().slice(0, 10);
    out.push({ day: key, redeemed: byDay.get(key) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return out.length > 0 ? out : sorted;
}

/** First, last, and a handful in between — never every tick. */
function xLabels(n: number): number[] {
  if (n <= 8) return Array.from({ length: n }, (_, i) => i);
  const step = Math.ceil(n / 6);
  const idx = new Set<number>([0, n - 1]);
  for (let i = step; i < n - 1; i += step) idx.add(i);
  return [...idx].sort((a, b) => a - b);
}

function shortDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}
