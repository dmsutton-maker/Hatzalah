"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toLoginEmail } from "@/lib/username";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/admin";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: toLoginEmail(email),
      password,
    });

    if (error) {
      setStatus(
        error.message === "Invalid login credentials"
          ? "That username or password is not right."
          : error.message,
      );
      setBusy(false);
      return;
    }

    router.replace(next);
    router.refresh();
  }

  async function magicLink() {
    // A username account has no mailbox behind it, so offering to email it a link
    // would just fail silently. Only a real address can use this.
    if (!email.includes("@")) {
      setStatus("Type a full email address to get a sign-in link.");
      return;
    }
    setBusy(true);
    setStatus(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/admin/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    setStatus(error ? error.message : "Check your email for the sign-in link.");
    setBusy(false);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-6">
      <h1 className="text-2xl font-black uppercase tracking-wide">Admin sign in</h1>
      <p className="mt-2 text-sm text-white/50">Carvel coupon redemption</p>

      <form onSubmit={signIn} className="mt-8 space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-semibold text-white/70">
            Username
          </label>
          <input
            id="email"
            // Not type="email": the whole point is that a bare username validates.
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-white/20 bg-black/40 px-3 py-3 text-lg focus:border-white focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-semibold text-white/70">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-white/20 bg-black/40 px-3 py-3 text-lg focus:border-white focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-white px-4 py-3 text-lg font-bold text-black disabled:opacity-40"
        >
          Sign in
        </button>
      </form>

      {email.includes("@") ? (
        <button
          type="button"
          onClick={magicLink}
          disabled={busy}
          className="mt-3 w-full rounded-lg border border-white/25 px-4 py-3 text-base font-semibold text-white/80 disabled:opacity-40"
        >
          Email me a sign-in link instead
        </button>
      ) : null}

      {status ? (
        <p role="status" className="mt-4 text-sm text-caution">
          {status}
        </p>
      ) : null}
    </main>
  );
}
