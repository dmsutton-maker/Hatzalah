import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import DailyChart, { type DailyRow } from "@/components/DailyChart";
import { formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

type Summary = {
  issued: number;
  redeemed: number;
  remaining: number;
  unit_cost: number;
  amount_owed: number;
};

export default async function DashboardPage() {
  const supabase = await createClient();

  // Separate queries, never nested selects. Joined/nested reads against this schema
  // have repeatedly hit schema-cache relationship failures — see BUILD_BRIEF §2.
  const [summaryRes, dailyRes, overrideRes, offsiteRes] = await Promise.all([
    supabase.from("v_summary").select("*").maybeSingle(),
    supabase.from("v_daily").select("day, redeemed").order("day", { ascending: true }),
    supabase.from("override_log").select("id", { count: "exact", head: true }),
    supabase.from("v_offsite").select("id", { count: "exact", head: true }),
  ]);

  const summary = (summaryRes.data ?? null) as Summary | null;
  const daily = (dailyRes.data ?? []) as DailyRow[];
  const overrides = overrideRes.count ?? 0;
  const offsite = offsiteRes.count ?? 0;

  const error = summaryRes.error ?? dailyRes.error;

  if (error) {
    return (
      <div className="rounded-xl border border-invalid/50 bg-invalid/10 p-6">
        <p className="font-bold">Could not load the dashboard.</p>
        <p className="mt-2 text-sm text-white/60">{error.message}</p>
        <p className="mt-2 text-sm text-white/60">
          If this mentions a missing relation, run the SQL files in{" "}
          <code>supabase/</code> in order (01 → 06).
        </p>
      </div>
    );
  }

  const unitCost = Number(summary?.unit_cost ?? 0);
  const owed = Number(summary?.amount_owed ?? 0);

  return (
    <div className="space-y-8">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Issued" value={String(summary?.issued ?? 0)} />
        <Card label="Redeemed" value={String(summary?.redeemed ?? 0)} />
        <Card label="Remaining" value={String(summary?.remaining ?? 0)} />
        <Card label="Owed to Carvel" value={formatMoney(owed)} accent />
      </section>

      {unitCost === 0 ? (
        <p className="rounded-xl border border-caution/50 bg-caution/10 px-4 py-3 text-sm">
          Unit cost is $0.00, so &ldquo;owed&rdquo; will read $0 no matter how many are
          redeemed.{" "}
          <Link href="/admin/settings" className="font-bold underline">
            Set the per-cup price
          </Link>
          .
        </p>
      ) : (
        <p className="text-sm text-white/50">
          {summary?.redeemed ?? 0} redeemed × {formatMoney(unitCost)} per cup ={" "}
          {formatMoney(owed)}
        </p>
      )}

      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-white/60">
          Redemptions per day
        </h2>
        <DailyChart rows={daily} />
      </section>

      {offsite > 0 ? (
        <p className="rounded-xl border border-caution/50 bg-caution/10 px-4 py-3 text-sm">
          <strong>{offsite}</strong> scan{offsite === 1 ? "" : "s"} came from outside the
          register&rsquo;s radius.{" "}
          <Link href="/admin/log" className="font-bold underline">
            Review them
          </Link>{" "}
          — check the accuracy figure before reading anything into it.
        </p>
      ) : null}

      <section className="flex flex-wrap items-center gap-4 text-sm text-white/60">
        <span>
          <strong className="text-white">{overrides}</strong> redeemed by manual override
        </span>
        <Link href="/admin/log" className="underline">
          Full scan log
        </Link>
        <Link href="/admin/settings" className="underline">
          Settings &amp; un-redeem
        </Link>
      </section>
    </div>
  );
}

function Card({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        accent ? "border-valid/40 bg-valid/10" : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <p className="text-xs font-bold uppercase tracking-wide text-white/50">{label}</p>
      <p className="mt-1 text-3xl font-black tabular-nums">{value}</p>
    </div>
  );
}
