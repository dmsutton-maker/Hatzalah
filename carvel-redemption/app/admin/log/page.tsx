"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatSerial } from "@/lib/serial";
import { formatStamp } from "@/lib/format";

/**
 * The full audit trail — every scan, successes and failures. This is the artifact
 * David settles with Carvel from, so the CSV is a first-class output, not a nicety.
 */

type ScanRow = {
  id: number;
  at: string;
  serial: number | null;
  raw_input: string | null;
  store_token: string | null;
  result: string;
  test_mode: boolean;
  device_hint: string | null;
  lat: number | null;
  lon: number | null;
  accuracy_m: number | null;
  distance_m: number | null;
  geo_status: string | null;
};

const RESULTS = [
  "ok",
  "override",
  "already_used",
  "out_of_range",
  "not_found",
  "bad_format",
  "exhausted",
  "wrong_location",
  "test",
] as const;

const PAGE_SIZE = 1000;

export default function LogPage() {
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [stores, setStores] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [result, setResult] = useState<string>("all");
  const [hideTest, setHideTest] = useState(false);
  const [offsiteOnly, setOffsiteOnly] = useState(false);
  const [sortDesc, setSortDesc] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = createClient();

      // Two flat queries, joined in JS. Nested selects against this schema have burned
      // us before with schema-cache relationship errors (BUILD_BRIEF §2).
      const [logRes, storeRes] = await Promise.all([
        supabase
          .from("scan_log")
          .select(
            "id, at, serial, raw_input, store_token, result, test_mode, device_hint, lat, lon, accuracy_m, distance_m, geo_status",
          )
          .order("at", { ascending: false })
          .limit(PAGE_SIZE),
        supabase.from("stores").select("token, name"),
      ]);

      if (cancelled) return;

      if (logRes.error) {
        setError(logRes.error.message);
        setLoading(false);
        return;
      }

      setRows((logRes.data ?? []) as ScanRow[]);
      setStores(
        Object.fromEntries(
          ((storeRes.data ?? []) as { token: string; name: string }[]).map((s) => [
            s.token,
            s.name,
          ]),
        ),
      );
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().replace(/^0+/, "");
    let out = rows;

    if (result !== "all") out = out.filter((r) => r.result === result);
    if (hideTest) out = out.filter((r) => !r.test_mode);
    if (offsiteOnly) out = out.filter((r) => r.geo_status === "far");
    if (q) out = out.filter((r) => r.serial != null && String(r.serial).includes(q));

    return [...out].sort((a, b) =>
      sortDesc ? b.at.localeCompare(a.at) : a.at.localeCompare(b.at),
    );
  }, [rows, query, result, hideTest, offsiteOnly, sortDesc]);

  function exportCsv() {
    const header = [
      "serial",
      "redeemed_at",
      "store_token",
      "store",
      "result",
      "test_mode",
      "geo_status",
      "distance_m",
      "accuracy_m",
      "lat",
      "lon",
      "note",
    ];

    const body = filtered.map((r) => [
      r.serial != null ? formatSerial(r.serial) : "",
      r.at,
      r.store_token ?? "",
      (r.store_token && stores[r.store_token]) || "",
      r.result,
      r.test_mode ? "true" : "false",
      r.geo_status ?? "",
      r.distance_m != null ? String(Math.round(r.distance_m)) : "",
      r.accuracy_m != null ? String(Math.round(r.accuracy_m)) : "",
      r.lat != null ? r.lat.toFixed(6) : "",
      r.lon != null ? r.lon.toFixed(6) : "",
      r.raw_input ?? "",
    ]);

    const csv = [header, ...body]
      .map((cells) => cells.map(csvCell).join(","))
      .join("\r\n");

    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `carvel-scan-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="q" className="block text-xs font-bold uppercase text-white/50">
            Serial
          </label>
          <input
            id="q"
            inputMode="numeric"
            placeholder="000123"
            value={query}
            onChange={(e) => setQuery(e.target.value.replace(/[^0-9]/g, ""))}
            className="mt-1 w-32 rounded-lg border border-white/20 bg-black/40 px-3 py-2 font-mono focus:border-white focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="r" className="block text-xs font-bold uppercase text-white/50">
            Result
          </label>
          <select
            id="r"
            value={result}
            onChange={(e) => setResult(e.target.value)}
            className="mt-1 rounded-lg border border-white/20 bg-black/40 px-3 py-2 focus:border-white focus:outline-none"
          >
            <option value="all">All</option>
            {RESULTS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 py-2 text-sm text-white/70">
          <input
            type="checkbox"
            checked={hideTest}
            onChange={(e) => setHideTest(e.target.checked)}
            className="h-4 w-4"
          />
          Hide test scans
        </label>

        <label className="flex items-center gap-2 py-2 text-sm text-white/70">
          <input
            type="checkbox"
            checked={offsiteOnly}
            onChange={(e) => setOffsiteOnly(e.target.checked)}
            className="h-4 w-4"
          />
          Off-site only
        </label>

        <button
          type="button"
          onClick={exportCsv}
          disabled={filtered.length === 0}
          className="ml-auto rounded-lg bg-white px-4 py-2 font-bold text-black disabled:opacity-40"
        >
          Export CSV ({filtered.length})
        </button>
      </div>

      {error ? (
        <p className="rounded-xl border border-invalid/50 bg-invalid/10 p-4 text-sm">
          {error}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-white/[0.04] text-xs uppercase tracking-wide text-white/50">
            <tr>
              <th className="px-3 py-2">
                <button type="button" onClick={() => setSortDesc((s) => !s)}>
                  When {sortDesc ? "↓" : "↑"}
                </button>
              </th>
              <th className="px-3 py-2">Serial</th>
              <th className="px-3 py-2">Result</th>
              <th className="px-3 py-2">Register</th>
              <th className="px-3 py-2">Where</th>
              <th className="px-3 py-2">Note</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-white/40">
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-white/40">
                  No scans match.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="whitespace-nowrap px-3 py-2 text-white/70">
                    {formatStamp(r.at)}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {r.serial != null ? formatSerial(r.serial) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <ResultTag result={r.result} test={r.test_mode} />
                  </td>
                  <td className="px-3 py-2 text-white/60">
                    {(r.store_token && stores[r.store_token]) || r.store_token || "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <GeoTag row={r} />
                  </td>
                  <td className="px-3 py-2 text-white/50">{r.raw_input ?? ""}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {rows.length === PAGE_SIZE ? (
        <p className="text-xs text-white/40">
          Showing the most recent {PAGE_SIZE} scans.
        </p>
      ) : null}
    </div>
  );
}

function ResultTag({ result, test }: { result: string; test: boolean }) {
  const tone =
    result === "ok" || result === "override"
      ? "bg-valid/20 text-valid"
      : result === "test"
        ? "bg-testing/25 text-white"
        : result === "bad_format"
          ? "bg-caution/20 text-caution"
          : "bg-invalid/20 text-invalid";

  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${tone}`}>
      {result}
      {test && result !== "test" ? " (test)" : ""}
    </span>
  );
}

/**
 * Where the scan happened, at a glance. The distance is only as good as the fix, so
 * the accuracy is shown next to it rather than hidden — a "1.2 km away" with ±2 km
 * accuracy is noise, and the log should make that obvious rather than imply guilt.
 */
function GeoTag({ row }: { row: ScanRow }) {
  if (row.geo_status === "far") {
    return (
      <a
        href={
          row.lat != null && row.lon != null
            ? `https://www.openstreetmap.org/?mlat=${row.lat}&mlon=${row.lon}#map=17/${row.lat}/${row.lon}`
            : undefined
        }
        target="_blank"
        rel="noreferrer"
        className="rounded-full bg-invalid/20 px-2 py-0.5 text-xs font-bold text-invalid underline"
      >
        off-site {row.distance_m != null ? formatDistance(row.distance_m) : ""}
        {row.accuracy_m != null ? ` ±${Math.round(row.accuracy_m)}m` : ""}
      </a>
    );
  }

  if (row.geo_status === "ok") {
    return (
      <span className="text-xs text-white/50">
        at store{row.distance_m != null ? ` · ${formatDistance(row.distance_m)}` : ""}
      </span>
    );
  }

  return (
    <span className="text-xs text-white/30">
      {row.geo_status === "unset" ? "no store coords" : "no location"}
    </span>
  );
}

function formatDistance(metres: number): string {
  return metres < 1000 ? `${Math.round(metres)}m` : `${(metres / 1000).toFixed(1)}km`;
}

function csvCell(value: string): string {
  // Leading =,+,-,@ make Excel evaluate the cell as a formula. Prefix with a quote.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
