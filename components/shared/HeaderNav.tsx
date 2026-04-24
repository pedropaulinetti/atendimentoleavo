"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/monitor",   label: "Monitor" },
  { href: "/funil",     label: "Funil" },
  { href: "/historico", label: "Histórico" },
] as const;

export function HeaderNav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1">
      {NAV_LINKS.map(({ href, label }) => {
        const isActive = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-zinc-100 text-zinc-900"
                : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50"
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
