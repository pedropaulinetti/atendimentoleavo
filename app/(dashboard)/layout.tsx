import { Header } from "@/components/shared/Header";
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <><Header /><main className="p-6">{children}</main></>;
}
