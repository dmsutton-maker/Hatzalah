"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatSerial } from "@/lib/serial";
import { getFixOnce } from "@/lib/geo";

type Range = {
  id: number;
  batch: string;
  serial_min: number;
  serial_max: number;
  enabled: boolean;
  unit_cost: number;
  note: string | null;
};

type Store = {
  token: string;
  name: string;
  enabled: boolean;
  lat: number | null;
  lon: number | null;
  geofence_radius_m: number;
  enforce_geofence: boolean;
};

export default function SettingsPage() {
  const [ranges, setRanges] = useState<Range[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [actor, setActor] = useState("");
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();

    const [rangeRes, storeRes, userRes] = await Promise.all([
      supabase.from("active_ranges").select("*").order("id", { ascending: true }),
      supabase
        .from("stores")
        .select("token, name, enabled, lat, lon, geofence_radius_m, enforce_geofence")
        .order("token"),
      supabase.auth.getUser(),
    ]);

    if (rangeRes.error) setNote({ tone: "bad", text: rangeRes.error.message });

    setRanges((rangeRes.data ?? []) as Range[]);
    setStores((storeRes.data ?? []) as Store[]);
    setActor(userRes.data.user?.email ?? "admin");
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="text-white/40">Loading…</p>;

  return (
    <div className="space-y-10">
      {note ? (
        <p
          role="status"
          className={`rounded-xl border p-3 text-sm ${
            note.tone === "ok"
              ? "border-valid/50 bg-valid/10"
              : "border-invalid/50 bg-invalid/10"
          }`}
        >
          {note.text}
        </p>
      ) : null}

      <RangeEditor ranges={ranges} onDone={load} onNote={setNote} />
      <StoreEditor stores={stores} onDone={load} onNote={setNote} />
      <UnredeemForm actor={actor} onNote={setNote} />
    </div>
  );
}

type NoteFn = (n: { tone: "ok" | "bad"; text: string }) => void;

function RangeEditor({
  ranges,
  onDone,
  onNote,
}: {
  ranges: Range[];
  onDone: () => Promise<void>;
  onNote: NoteFn;
}) {
  const [busy, setBusy] = useState(false);

  async function save(id: number, form: HTMLFormElement) {
    const data = new FormData(form);
    const patch = {
      serial_min: Number(data.get("serial_min")),
      serial_max: Number(data.get("serial_max")),
      unit_cost: Number(data.get("unit_cost")),
      enabled: data.get("enabled") === "on",
    };

    if (
      !Number.isInteger(patch.serial_min) ||
      !Number.isInteger(patch.serial_max) ||
      patch.serial_max < patch.serial_min
    ) {
      onNote({ tone: "bad", text: "Serial range is not valid." });
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("active_ranges").update(patch).eq("id", id);
    setBusy(false);

    if (error) {
      onNote({ tone: "bad", text: error.message });
      return;
    }

    onNote({ tone: "ok", text: "Range saved." });
    await onDone();
  }

  return (
    <section>
      <h2 className="text-sm font-bold uppercase tracking-wide text-white/60">
        Active range &amp; unit cost
      </h2>
      <p className="mt-1 text-sm text-white/40">
        Only serials inside an enabled range can be redeemed. Unit cost is what Hatzalah
        pays Carvel per Kiddie Cup — the &ldquo;owed&rdquo; figure is redeemed × this.
      </p>

      <div className="mt-4 space-y-4">
        {ranges.map((r) => (
          <form
            key={r.id}
            onSubmit={(e) => {
              e.preventDefault();
              void save(r.id, e.currentTarget);
            }}
            className="grid gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:grid-cols-5 sm:items-end"
          >
            <Field label="First serial" name="serial_min" defaultValue={r.serial_min} />
            <Field label="Last serial" name="serial_max" defaultValue={r.serial_max} />
            <Field
              label="Unit cost ($)"
              name="unit_cost"
              defaultValue={r.unit_cost}
              step="0.01"
            />

            <label className="flex items-center gap-2 py-2 text-sm">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={r.enabled}
                className="h-4 w-4"
              />
              Enabled
            </label>

            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-white px-4 py-2 font-bold text-black disabled:opacity-40"
            >
              Save
            </button>

            <p className="text-xs text-white/40 sm:col-span-5">
              {r.batch}
              {r.note ? ` · ${r.note}` : ""}
            </p>
          </form>
        ))}
      </div>
    </section>
  );
}

function StoreEditor({
  stores,
  onDone,
  onNote,
}: {
  stores: Store[];
  onDone: () => Promise<void>;
  onNote: NoteFn;
}) {
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function toggle(store: Store) {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("stores")
      .update({ enabled: !store.enabled })
      .eq("token", store.token);
    setBusy(false);

    if (error) {
      onNote({ tone: "bad", text: error.message });
      return;
    }
    await onDone();
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const clean = token.trim().toUpperCase();
    if (!clean || !name.trim()) return;

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("stores")
      .insert({ token: clean, name: name.trim(), enabled: true });
    setBusy(false);

    if (error) {
      onNote({ tone: "bad", text: error.message });
      return;
    }

    onNote({
      tone: "ok",
      text: `Added ${clean}. Regenerate the sign with APP_URL=".../s/${clean}" (README §4).`,
    });
    setToken("");
    setName("");
    await onDone();
  }

  return (
    <section>
      <h2 className="text-sm font-bold uppercase tracking-wide text-white/60">Registers</h2>
      <p className="mt-1 text-sm text-white/40">
        The token is the <code>/s/TOKEN</code> in the QR URL. If one leaks, add a new
        register, disable the old one, and reprint the sign — that is the whole rotation
        story.
      </p>

      <ul className="mt-4 space-y-3">
        {stores.map((s) => (
          <li
            key={s.token}
            className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3"
          >
            <div className="flex flex-wrap items-center gap-3">
              <code className="font-mono text-sm">{s.token}</code>
              <span className="text-sm text-white/60">{s.name}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                  s.enabled ? "bg-valid/20 text-valid" : "bg-invalid/20 text-invalid"
                }`}
              >
                {s.enabled ? "enabled" : "disabled"}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void toggle(s)}
                className="ml-auto rounded-lg border border-white/20 px-3 py-1 text-sm font-semibold disabled:opacity-40"
              >
                {s.enabled ? "Disable" : "Enable"}
              </button>
            </div>

            <GeofenceEditor store={s} onDone={onDone} onNote={onNote} />
          </li>
        ))}
      </ul>

      <form onSubmit={add} className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="token" className="block text-xs font-bold uppercase text-white/50">
            New token
          </label>
          <input
            id="token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="CARVEL-WLB-2"
            className="mt-1 rounded-lg border border-white/20 bg-black/40 px-3 py-2 font-mono focus:border-white focus:outline-none"
          />
        </div>
        <div className="flex-1">
          <label htmlFor="name" className="block text-xs font-bold uppercase text-white/50">
            Name
          </label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Carvel — 175 Monmouth Rd"
            className="mt-1 w-full rounded-lg border border-white/20 bg-black/40 px-3 py-2 focus:border-white focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-white px-4 py-2 font-bold text-black disabled:opacity-40"
        >
          Add register
        </button>
      </form>
    </section>
  );
}

/**
 * Where this register actually is, and what to do about scans that aren't there.
 *
 * The seeded coordinates come from a geocoder, which can be tens of metres off.
 * "Use my current location" is the fix: stand at the register once, press it, save.
 */
function GeofenceEditor({
  store,
  onDone,
  onNote,
}: {
  store: Store;
  onDone: () => Promise<void>;
  onNote: NoteFn;
}) {
  const [lat, setLat] = useState(store.lat != null ? String(store.lat) : "");
  const [lon, setLon] = useState(store.lon != null ? String(store.lon) : "");
  const [radius, setRadius] = useState(String(store.geofence_radius_m));
  const [enforce, setEnforce] = useState(store.enforce_geofence);
  const [busy, setBusy] = useState(false);

  async function useMyLocation() {
    setBusy(true);
    try {
      const fix = await getFixOnce();
      setLat(fix.lat.toFixed(6));
      setLon(fix.lon.toFixed(6));
      onNote({
        tone: "ok",
        text: `Got a fix accurate to about ${Math.round(fix.acc)} m. Press Save location to keep it.`,
      });
    } catch (err) {
      onNote({ tone: "bad", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const latNum = lat.trim() === "" ? null : Number(lat);
    const lonNum = lon.trim() === "" ? null : Number(lon);
    const radiusNum = Number(radius);

    if (
      (latNum !== null && (Number.isNaN(latNum) || Math.abs(latNum) > 90)) ||
      (lonNum !== null && (Number.isNaN(lonNum) || Math.abs(lonNum) > 180))
    ) {
      onNote({ tone: "bad", text: "Those coordinates are not valid." });
      return;
    }
    if (!Number.isFinite(radiusNum) || radiusNum < 25) {
      onNote({ tone: "bad", text: "Use a radius of at least 25 m — GPS is not sharper." });
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("stores")
      .update({
        lat: latNum,
        lon: lonNum,
        geofence_radius_m: Math.round(radiusNum),
        enforce_geofence: enforce,
      })
      .eq("token", store.token);
    setBusy(false);

    if (error) {
      onNote({ tone: "bad", text: error.message });
      return;
    }

    onNote({ tone: "ok", text: `Location saved for ${store.token}.` });
    await onDone();
  }

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <SmallField label="Latitude" value={lat} onChange={setLat} width="w-32" />
        <SmallField label="Longitude" value={lon} onChange={setLon} width="w-32" />
        <SmallField label="Radius (m)" value={radius} onChange={setRadius} width="w-24" />

        <button
          type="button"
          onClick={() => void useMyLocation()}
          disabled={busy}
          className="rounded-lg border border-white/25 px-3 py-2 text-sm font-semibold disabled:opacity-40"
        >
          Use my current location
        </button>

        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="rounded-lg bg-white px-3 py-2 text-sm font-bold text-black disabled:opacity-40"
        >
          Save location
        </button>
      </div>

      <label className="mt-3 flex items-start gap-2 text-sm text-white/70">
        <input
          type="checkbox"
          checked={enforce}
          onChange={(e) => setEnforce(e.target.checked)}
          className="mt-1 h-4 w-4"
        />
        <span>
          <strong>Refuse</strong> scans from outside this radius.
          <span className="block text-xs text-white/40">
            Off by default. Indoor GPS is routinely 100 m+ out, and a phone with location
            switched off has no fix at all — with this on, those become refusals in front
            of a customer. Watch the &ldquo;Where&rdquo; column in the log for a week
            before turning it on.
          </span>
        </span>
      </label>
    </div>
  );
}

function SmallField({
  label,
  value,
  onChange,
  width,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  width: string;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-bold uppercase text-white/50">
        {label}
      </label>
      <input
        id={id}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 rounded-lg border border-white/20 bg-black/40 px-3 py-2 font-mono text-sm focus:border-white focus:outline-none ${width}`}
      />
    </div>
  );
}

function UnredeemForm({ actor, onNote }: { actor: string; onNote: NoteFn }) {
  const [serial, setSerial] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    const n = Number(serial);
    if (!Number.isInteger(n) || n <= 0) {
      onNote({ tone: "bad", text: "Enter the serial to release." });
      return;
    }
    if (reason.trim().length < 3) {
      onNote({ tone: "bad", text: "A reason is required — it goes in the audit trail." });
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("unredeem", {
      p_serial: n,
      p_reason: reason.trim(),
      p_actor: actor,
    });
    setBusy(false);

    if (error) {
      onNote({ tone: "bad", text: error.message });
      return;
    }

    if (data === true) {
      onNote({ tone: "ok", text: `${formatSerial(n)} released — it can be redeemed again.` });
      setSerial("");
      setReason("");
    } else {
      onNote({
        tone: "bad",
        text: `${formatSerial(n)} was not redeemed, so there was nothing to release.`,
      });
    }
  }

  return (
    <section>
      <h2 className="text-sm font-bold uppercase tracking-wide text-white/60">Un-redeem</h2>
      <p className="mt-1 text-sm text-white/40">
        Releases a coupon that was redeemed by mistake. The scan stays in the log — nothing
        is ever deleted — and the reason is recorded against your account.
      </p>

      <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="us" className="block text-xs font-bold uppercase text-white/50">
            Serial
          </label>
          <input
            id="us"
            inputMode="numeric"
            value={serial}
            onChange={(e) => setSerial(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="000123"
            className="mt-1 w-32 rounded-lg border border-white/20 bg-black/40 px-3 py-2 font-mono focus:border-white focus:outline-none"
          />
        </div>
        <div className="flex-1">
          <label htmlFor="ur" className="block text-xs font-bold uppercase text-white/50">
            Reason (required)
          </label>
          <input
            id="ur"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Scanned twice by mistake"
            className="mt-1 w-full rounded-lg border border-white/20 bg-black/40 px-3 py-2 focus:border-white focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg border-2 border-caution px-4 py-2 font-bold disabled:opacity-40"
        >
          Un-redeem
        </button>
      </form>
    </section>
  );
}

function Field({
  label,
  name,
  defaultValue,
  step,
}: {
  label: string;
  name: string;
  defaultValue: number;
  step?: string;
}) {
  // One field per range row, so the id has to be unique per instance, not per name.
  const id = `${useId()}-${name}`;

  return (
    <div>
      <label htmlFor={id} className="block text-xs font-bold uppercase text-white/50">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type="number"
        step={step ?? "1"}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-lg border border-white/20 bg-black/40 px-3 py-2 font-mono focus:border-white focus:outline-none"
      />
    </div>
  );
}
