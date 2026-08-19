import type { Metadata } from "next";
import { AdminShell } from "./admin-shell";

export const metadata: Metadata = {
  title: "Operasyon Yönetim Paneli",
  description: "Riftory kapalı beta operasyonları için yetkili yönetim paneli.",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return (
    <main className="adminPage">
      <div className="noise" aria-hidden="true" />
      <AdminShell />
    </main>
  );
}
