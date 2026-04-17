import { Header } from "@/components/shared/Header";
import { OfflineBanner } from "@/components/shared/OfflineBanner";
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <OfflineBanner />
      <Header />
      <main className="mx-auto max-w-6xl p-6">{children}</main>
    </div>
  );
}
