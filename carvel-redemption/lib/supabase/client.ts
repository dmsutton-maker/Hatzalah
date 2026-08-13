"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser client. Ships the public anon key, which is safe ONLY because 04_rls.sql
 * leaves anon with zero table access and exactly one executable function (redeem).
 * If you loosen RLS, this key stops being safe to ship.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. See BUILD_BRIEF.md §4.",
    );
  }

  return createBrowserClient(url, key);
}
