import type { ReactNode } from "react";
import { Icon } from "../_components/icon";
import type { AdminRole } from "./admin-types";

export const ROLE_LABEL: Record<AdminRole, string> = {
  owner: "Sahip",
  operator: "Operatör",
  support: "Destek",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Aktif", cancelled: "İptal", dead: "Müdahale gerekli", deleted: "Silindi",
  deploying: "Dağıtılıyor", draft: "Taslak", failed: "Başarısız", leased: "Worker işliyor",
  locked: "Kilitli", online: "Çevrimiçi", paid: "Ödendi", pending: "Sırada",
  pending_payment: "Ödeme bekliyor", provisioning: "Kuruluyor", refunded: "İade",
  requested: "Talep edildi", succeeded: "Tamamlandı", suspended: "Durduruldu",
};

export const JOB_LABEL: Record<string, string> = {
  create_server: "Sunucu kur",
  start_server: "Başlat",
  stop_server: "Durdur",
  restart_server: "Yeniden başlat",
  delete_server: "Sil",
};

/** Turkish wording for the audit actions the console writes; unknown keys stay verbatim. */
export const AUDIT_LABEL: Record<string, string> = {
  "admin.membership.granted": "Yönetici yetkisi verildi",
  "admin.membership.revoked": "Yönetici yetkisi kaldırıldı",
  "admin.membership.updated": "Yönetici rolü değişti",
  "admin.password.changed": "Admin parolası değişti",
  "admin.provisioning.retry": "İş yeniden kuyruğa alındı",
  "admin.server.command": "Sunucu komutu verildi",
  "admin.server.provisioned": "Manuel sunucu kuruldu",
  "auth.admin_password.consumed": "Admin parolasıyla giriş",
};

export function statusLabel(value: string) {
  return STATUS_LABEL[value] ?? value;
}

export function statusTone(value: string) {
  if (["online", "active", "paid", "succeeded"].includes(value)) return "good";
  if (["failed", "dead"].includes(value)) return "bad";
  if (["pending", "leased", "requested", "provisioning", "deploying", "pending_payment"].includes(value)) return "warn";
  return "neutral";
}

export function formatMoment(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

export function formatMoney(minor: number, currency: string) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency }).format(minor / 100);
}

export function shortId(value: string) {
  return value.slice(0, 8);
}

export function Status({ value }: { value: string }) {
  return <span className={`adminStatus ${statusTone(value)}`}><i /> {statusLabel(value)}</span>;
}

export function EmptyRow({ columns }: { columns: number }) {
  return <tr><td className="adminEmpty" colSpan={columns}>Bu filtrede kayıt bulunamadı.</td></tr>;
}

export function AdminSection({ icon, title, count, children }: {
  icon: "wallet" | "server" | "activity" | "users" | "shield" | "lock";
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="adminSection">
      <header>
        <span><Icon name={icon} size={17} /> {title}</span>
        {count !== undefined && <em>{count} kayıt</em>}
      </header>
      {children}
    </section>
  );
}
