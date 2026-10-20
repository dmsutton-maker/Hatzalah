// In-memory stand-in for the Google Apps Script services Code.gs uses.
// Proves the RULES (claim, cap, location, fail-closed); only a deployed script can
// prove Google's runtime itself behaves.
import vm from "node:vm";

export function makeEnv(source) {
  const state = { lockHeld: false, unlockedReads: 0, lockTakes: 0, lockFail: false };
  const sheets = {};

  class Range {
    constructor(sheet, r, c, nr, nc) {
      Object.assign(this, { sheet, r, c, nr, nc });
      // Formatting calls (setFontWeight, setNumberFormat, ...) are irrelevant to the
      // rules under test; they just need to exist and chain.
      const proxy = new Proxy(this, {
        get: (t, k) => (k in t ? t[k] : () => proxy),
      });
      return proxy;
    }
    getValues() {
      if (this.sheet.name === "Coupons" && !state.lockHeld) state.unlockedReads++;
      const out = [];
      for (let i = 0; i < this.nr; i++) {
        const row = [];
        for (let j = 0; j < this.nc; j++) row.push(this.sheet.rows[this.r - 1 + i]?.[this.c - 1 + j] ?? "");
        out.push(row);
      }
      return out;
    }
    setValues(v) {
      v.forEach((row, i) =>
        row.forEach((val, j) => {
          const R = (this.sheet.rows[this.r - 1 + i] ??= []);
          R[this.c - 1 + j] = val;
        }),
      );
      return this;
    }
    setValue(v) {
      return this.setValues([[v]]);
    }
  }

  class Sheet {
    constructor(name) {
      this.name = name;
      this.rows = [];
    }
    getLastRow() {
      let last = 0;
      this.rows.forEach((r, i) => r?.some((x) => x !== "" && x !== undefined) && (last = i + 1));
      return last;
    }
    getRange(r, c, nr = 1, nc = 1) {
      if (typeof r === "string") return new Range(this, 1, 1, 1, 1);
      return new Range(this, r, c, nr, nc);
    }
    appendRow(arr) {
      this.rows[this.getLastRow()] = arr.slice();
    }
    clear() {
      this.rows = [];
      return this;
    }
    newChart() {
      const chain = new Proxy({}, { get: (t, k) => (k === "build" ? () => ({}) : () => chain) });
      return chain;
    }
    insertChart() {}
    setFrozenRows() {}
    setColumnWidth() {}
  }

  const ss = {
    getSheetByName: (n) => sheets[n] ?? null,
    insertSheet: (n) => (sheets[n] = new Sheet(n)),
    deleteSheet: () => {},
    setSpreadsheetTimeZone: () => {},
    setActiveSheet: () => {},
    moveActiveSheet: () => {},
  };

  const g = {
    console,
    Date,
    Math,
    JSON,
    parseInt,
    Number,
    String,
    isFinite,
    Array,
    SpreadsheetApp: { openById: () => ss, flush: () => {}, getUi: () => ({}) },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => {
          if (state.lockFail) throw new Error("Lock timeout");
          state.lockHeld = true;
          state.lockTakes++;
        },
        releaseLock: () => (state.lockHeld = false),
      }),
    },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (s) => ({ s, setMimeType() { return this; }, getContent: () => s }),
    },
    Utilities: {
      formatDate: (d, tz) =>
        new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d),
    },
    Session: { getActiveUser: () => ({ getEmail: () => "test@example.com" }) },
    Charts: { ChartType: { COLUMN: "column" } },
  };
  vm.createContext(g);
  vm.runInContext(source, g);
  return { g, state, sheets, ss };
}

