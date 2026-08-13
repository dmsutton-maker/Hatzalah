/**
 * Barcode / keypad payload -> serial number.
 *
 * The printed batch encodes a plain 6-digit serial with no signature. BUILD_BRIEF §8
 * reserves the right to reprint later with a short HMAC appended (`000123-7F2A`), so the
 * parser tolerates that suffix today. It is returned, not verified — verification would
 * belong server-side in redeem(). Accepting it now means a future reprint does not
 * require touching the scanner.
 */
export type ParsedSerial = {
  serial: number;
  /** The optional `-XXXX` suffix, upper-cased. Null for the current printed batch. */
  suffix: string | null;
};

const PAYLOAD = /^(\d{1,6})(?:-([0-9A-Za-z]{4}))?$/;

export function parseSerial(raw: string): ParsedSerial | null {
  // Scanners and greasy keypads both produce stray whitespace; some wedge scanners
  // append a newline.
  const cleaned = raw.trim().replace(/\s+/g, "");
  if (!cleaned) return null;

  const m = PAYLOAD.exec(cleaned);
  if (!m) return null;

  const serial = Number.parseInt(m[1], 10);
  if (!Number.isSafeInteger(serial) || serial < 1) return null;

  return { serial, suffix: m[2] ? m[2].toUpperCase() : null };
}

/** 123 -> "000123". What is printed under the barcode. */
export function formatSerial(serial: number): string {
  return String(serial).padStart(6, "0");
}
