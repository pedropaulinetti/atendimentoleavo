import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { HeaderNav } from "./HeaderNav";
import { MessageCircle, LogOut } from "lucide-react";

export async function Header() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <header className="sticky top-0 z-40 border-b bg-white/90 backdrop-blur-sm shadow-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        {/* Logo / brand */}
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-900 text-white">
            <MessageCircle className="size-4" />
          </div>
          <span className="text-sm font-semibold text-zinc-900">Atendimento Leavo</span>
        </div>

        {/* Nav — centered */}
        <HeaderNav />

        {/* Right side: email + logout */}
        <div className="flex items-center gap-3">
          {user?.email && (
            <span className="hidden text-xs text-zinc-400 sm:block">{user.email}</span>
          )}
          <form action={logout}>
            <Button variant="ghost" size="sm" aria-label="Sair da conta" className="text-zinc-500 hover:text-zinc-900">
              <LogOut className="size-4" />
              <span className="ml-1.5 hidden sm:inline">Sair</span>
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
