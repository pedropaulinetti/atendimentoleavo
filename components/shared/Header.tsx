import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { Button } from "@/components/ui/button";

export async function Header() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <header className="flex items-center justify-between border-b px-6 py-3">
      <nav className="flex gap-4">
        <Link href="/monitor" className="font-medium hover:underline">Monitor</Link>
        <Link href="/funil" className="font-medium hover:underline">Funil</Link>
      </nav>
      <div className="flex items-center gap-3 text-sm text-zinc-600">
        <span>{user?.email}</span>
        <form action={logout}><Button variant="ghost" size="sm">Sair</Button></form>
      </div>
    </header>
  );
}
