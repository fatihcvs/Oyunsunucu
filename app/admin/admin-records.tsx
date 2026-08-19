import { AUDIT_LABEL, AdminSection, EmptyRow, Status, formatMoment, shortId } from "./admin-ui";
import type { Dashboard } from "./admin-types";

/** Read-only views: who the customers are, and what the console has already done. */
export function AdminRecords({ dashboard }: { dashboard: Dashboard }) {
  return (
    <>
      <AdminSection count={dashboard.customers.length} icon="users" title="Müşteriler">
        <div className="adminTableWrap">
          <table className="adminTable">
            <thead>
              <tr><th>Hesap</th><th>Durum</th><th>E-posta doğrulaması</th><th>Sunucu</th><th>Yetki</th><th>Kayıt</th></tr>
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
                  <td>{customer.isAdmin ? <span className="adminSource">Operasyon ekibi</span> : <span className="adminNoAction">Müşteri</span>}</td>
                  <td>{formatMoment(customer.createdAt)}</td>
                </tr>
              ))}
              {dashboard.customers.length === 0 && <EmptyRow columns={6} />}
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
