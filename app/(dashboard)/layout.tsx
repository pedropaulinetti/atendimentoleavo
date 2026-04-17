import { Header } from "@/components/shared/Header";
import { OfflineBanner } from "@/components/shared/OfflineBanner";
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <><OfflineBanner /><Header /><main className="p-6">{children}</main></>;
}
