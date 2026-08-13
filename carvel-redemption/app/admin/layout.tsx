import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The login screen renders inside this layout too, before there is a user.
  if (!user) return <>{children}</>;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <h1 className="text-lg font-black uppercase tracking-wide">Carvel coupons</h1>
          <p className="text-xs text-white/40">Jersey Shore Hatzalah · Helmet Safety Reward</p>
        </div>

        <nav className="flex items-center gap-1 text-sm font-semibold">
          <NavLink href="/admin">Dashboard</NavLink>
          <NavLink href="/admin/log">Log</NavLink>
          <NavLink href="/admin/settings">Settings</NavLink>
          <form action="/admin/auth/signout" method="post">
            <button
              type="submit"
              className="rounded-lg px-3 py-2 text-white/50 hover:bg-white/10 hover:text-white"
            >
              Sign out
            </button>
          </form>
        </nav>
      </header>

      <main className="pt-6">{children}</main>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="rounded-lg px-3 py-2 text-white/70 hover:bg-white/10 hover:text-white">
      {children}
    </Link>
  );
}
