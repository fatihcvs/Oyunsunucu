"use client";

import { FormEvent, useState } from "react";
import { Icon } from "../_components/icon";
import { AUDIT_LABEL, AdminSection, EmptyRow, Status, formatMoment, formatMoney, shortId } from "./admin-ui";
import type { Dashboard } from "./admin-types";

/** Read-only views: who the customers are, and what the console has already done. */
export function AdminRecords({ dashboard, onChanged, onToast }: {
  dashboard: Dashboard;
  onChanged: () => Promise<void> | void;
  onToast: (message: string) => void;
}) {
  return (
    <>
      <AdminSection count={dashboard.customers.length} icon="users" title="Müşteriler">
        <div className="adminTableWrap">
          <table className="adminTable">
            <thead>
              <tr><th>Hesap</th><th>Durum</th><th>E-posta</th><th>Sunucu</th><th>Bakiye</th><th>Yetki</th><th>Kayıt</th></tr>
            </thead>
            <tbody>
              {dashboard.customers.map((customer) => (
                <tr key={customer.userId}>
                  <td><b>{customer.displayName}</b><small>{customer.email}</small></td>
                  <td><Status value={customer.status} /></td>
                  <td>{customer.emailVerified
                    ? <span className="adminStatus good"><i /> Doğrulandı</span>
                    : <span className="adminStatus warn"><i /> Bekliyor</span>}</td>
                  <td>{customer.serverCount}</td>
                  <td>
                    <b>{formatMoney(customer.balanceMinor, "TRY")}</b>
                    {dashboard.capabilities.canAdjustBalances && (
                      <BalanceControl
                        customer={customer}
                        onChanged={onChanged}
                        onToast={onToast}
                      />
                    )}
                  </td>
                  <td>{customer.isAdmin ? <span className="adminSource">Operasyon ekibi</span> : <span className="adminNoAction">Müşteri</span>}</td>
                  <td>{formatMoment(customer.createdAt)}</td>
                </tr>
              ))}
              {dashboard.customers.length === 0 && <EmptyRow columns={7} />}
            </tbody>
          </table>
        </div>
      </AdminSection>

      <AdminSection count={dashboard.auditLogs.length} icon="shield" title="Denetim kaydı">
        <div className="adminTableWrap">
          <table className="adminTable">
            <thead><tr><th>İşlem</th><th>Yapan</th><th>Hedef</th><th>Zaman</th></tr></thead>
            <tbody>
              {dashboard.auditLogs.map((entry) => (
                <tr key={entry.auditId}>
                  <td><b>{AUDIT_LABEL[entry.action] ?? entry.action}</b><small>{entry.action}</small></td>
                  <td>{entry.actorEmail ?? <span className="adminNoAction">sistem</span>}</td>
                  <td>
                    {entry.targetId
                      ? <><b>{entry.targetType ?? "kayıt"}</b><code title={entry.targetId}>{shortId(entry.targetId)}</code></>
                      : <span className="adminNoAction">—</span>}
                  </td>
                  <td>{formatMoment(entry.occurredAt)}</td>
                </tr>
              ))}
              {dashboard.auditLogs.length === 0 && <EmptyRow columns={4} />}
            </tbody>
          </table>
        </div>
        <p className="adminProvisionReadonly">
          Denetim kaydı yalnızca okunur. Konsol bu kayıtları siler veya değiştirir bir yol sunmaz.
        </p>
      </AdminSection>
    </>
  );
}

/**
 * Manual store credit for one customer.
 *
 * The closed beta has no payment provider, so credit arrives by an operator
 * typing it in after money turned up some other way. Each submit carries a
 * fresh request id, which is unique in the entries table — a double-clicked
 * button credits once.
 */
function BalanceControl({ customer, onChanged, onToast }: {
  customer: Dashboard["customers"][number];
  onChanged: () => Promise<void> | void;
  onToast: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = Number(amount.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed === 0) {
      setError("Tutar sıfırdan farklı bir sayı olmalı.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          action: "adjust_balance",
          userId: customer.userId,
          amount: parsed,
          note,
          requestId: crypto.randomUUID(),
        }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(body.message ?? "Bakiye güncellenemedi.");
      onToast(body.message ?? "Bakiye güncellendi.");
      setAmount("");
      setNote("");
      setOpen(false);
      await onChanged();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Bakiye güncellenemedi.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button className="adminRetry" onClick={() => setOpen(true)} type="button">
        <Icon name="plus" size={13} /> Bakiye
      </button>
    );
  }

  return (
    <form className="adminBalanceForm" onSubmit={submit}>
      <input
        autoFocus
        inputMode="decimal"
        onChange={(event) => setAmount(event.target.value)}
        placeholder="TL (eksi için -)"
        value={amount}
      />
      <input
        maxLength={200}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Açıklama"
        value={note}
      />
      <div>
        <button disabled={saving} type="submit">{saving ? "…" : "Uygula"}</button>
        <button disabled={saving} onClick={() => { setOpen(false); setError(null); }} type="button">Vazgeç</button>
      </div>
      {error && <em>{error}</em>}
    </form>
  );
}
