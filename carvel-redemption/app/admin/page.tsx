import { redirect } from "next/navigation";

/**
 * The admin is the Google Sheet. This address just forwards there, so the old bookmark
 * (and the "/" route) still lead somewhere useful.
 *
 * Access is controlled by Google, not by this app: only accounts the Sheet is shared
 * with can open it. Anyone else lands on Google's "request access" screen.
 */
export const dynamic = "force-dynamic";

export default function AdminRedirect() {
  const sheet = process.env.NEXT_PUBLIC_SHEET_URL;
  redirect(sheet || "/s/CARVEL-WLB");
}
