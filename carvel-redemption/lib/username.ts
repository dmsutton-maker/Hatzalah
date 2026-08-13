/**
 * Supabase identifies users by email, but the admin signs in with a plain username.
 *
 * A name with no "@" gets this domain attached. It is a .local TLD, which can never
 * receive real mail — deliberately, because it is an account name, not a mailbox.
 * A real email typed in full passes through untouched, so a second admin with an
 * actual address (and the magic-link option) still works.
 */
const USERNAME_DOMAIN = "hatzalah.local";

export function toLoginEmail(input: string): string {
  const v = input.trim();
  return v.includes("@") ? v : `${v.toLowerCase()}@${USERNAME_DOMAIN}`;
}
