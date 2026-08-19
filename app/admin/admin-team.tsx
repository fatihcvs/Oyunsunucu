"use client";

import { FormEvent, useState } from "react";
import { Icon } from "../_components/icon";
import { AdminSection, EmptyRow, ROLE_LABEL, formatMoment } from "./admin-ui";
import type { AdminRole, Dashboard } from "./admin-types";

const ASSIGNABLE_ROLES: AdminRole[] = ["owner", "operator", "support"];

async function postAdmin(body: Record<string, unknown>, path = "/api/admin") {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new Error(payload.message ?? "İşlem tamamlanamadı.");
  return payload;
}

/**
 * Access management and the operator's own password.
 *
 * Both are deliberately in the same place: they are the two ways someone keeps
 * or loses entry to the console, and both are owner-visible actions with an
 * audit record behind them.
 */
export function AdminTeam({ dashboard, onChanged, onToast }: {
  dashboard: Dashboard;
  onChanged: () => Promise<void> | void;
  onToast: (message: string) => void;
}) {
  const [grantEmail, setGrantEmail] = useState("");
  const [grantRole, setGrantRole] = useState<AdminRole>("operator");
  const [granting, setGranting] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [revokingUserId, setRevokingUserId] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const canManage = dashboard.capabilities.canManageMemberships;

  async function grantMembership(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage) return;
    setGranting(true);
    setTeamError(null);
    try {
      const result = await postAdmin({ action: "grant_membership", email: grantEmail, role: grantRole });
      onToast(result.message ?? "Yönetici yetkisi verildi.");
      setGrantEmail("");
      await onChanged();
    } catch (error) {
      setTeamError(error instanceof Error ? error.message : "Yetki verilemedi.");
    } finally {
      setGranting(false);
    }
  }

  async function revokeMembership(userId: string, email: string) {
    if (!canManage) return;
    if (!globalThis.confirm(`${email} hesabının yönetici yetkisi kaldırılsın mı? Müşteri hesabı korunur.`)) return;
    setRevokingUserId(userId);
    setTeamError(null);
    try {
      const result = await postAdmin({ action: "revoke_membership", userId });
      onToast(result.message ?? "Yönetici yetkisi kaldırıldı.");
      await onChanged();
    } catch (error) {
      setTeamError(error instanceof Error ? error.message : "Yetki kaldırılamadı.");
    } finally {
      setRevokingUserId(null);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError(null);
    if (newPassword !== repeatPassword) {
      setPasswordError("Yeni parola tekrarı eşleşmiyor.");
      return;
    }
    setChangingPassword(true);
    try {
      const result = await postAdmin({ currentPassword, newPassword }, "/api/admin/password");
      onToast(result.message ?? "Parola değiştirildi.");
      setCurrentPassword("");
      setNewPassword("");
      setRepeatPassword("");
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : "Parola değiştirilemedi.");
    } finally {
      setChangingPassword(false);
    }
  }

  return (
    <>
      <AdminSection count={dashboard.memberships.length} icon="users" title="Operasyon ekibi">
        <div className="adminTableWrap">
          <table className="adminTable">
            <thead><tr><th>Hesap</th><th>Rol</th><th>Parola</th><th>Eklendi</th><th>İşlem</th></tr></thead>
            <tbody>
              {dashboard.memberships.map((member) => (
                <tr key={member.userId}>
                  <td><b>{member.displayName}</b><small>{member.email}</small></td>
                  <td><span className="adminSource">{ROLE_LABEL[member.role]}</span></td>
                  <td>{member.hasOwnPassword
                    ? <span className="adminStatus good"><i /> Kendi parolası</span>
                    : <span className="adminStatus warn"><i /> Kurulum parolası</span>}</td>
                  <td>{formatMoment(member.createdAt)}</td>
                  <td>
                    {canManage && member.email !== dashboard.viewer.email ? (
                      <button
                        className="adminRetry danger"
                        disabled={revokingUserId === member.userId}
                        onClick={() => { void revokeMembership(member.userId, member.email); }}
                        type="button"
                      >
                        <Icon name="close" size={13} /> {revokingUserId === member.userId ? "Kaldırılıyor" : "Yetkiyi kaldır"}
                      </button>
                    ) : <span className="adminNoAction">—</span>}
                  </td>
                </tr>
              ))}
              {dashboard.memberships.length === 0 && <EmptyRow columns={5} />}
            </tbody>
          </table>
        </div>

        {canManage ? (
          <form className="adminTeamForm" onSubmit={grantMembership}>
            <label>
              <span>Hesap e-postası</span>
              <input
                autoComplete="off"
                inputMode="email"
                maxLength={254}
                onChange={(event) => setGrantEmail(event.target.value)}
                placeholder="operator@example.com"
                required
                type="email"
                value={grantEmail}
              />
            </label>
            <label>
              <span>Rol</span>
              <select onChange={(event) => setGrantRole(event.target.value as AdminRole)} value={grantRole}>
                {ASSIGNABLE_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
              </select>
            </label>
            <button disabled={granting} type="submit">
              <Icon name="plus" size={15} /> {granting ? "Veriliyor…" : "Yetki ver"}
            </button>
            {teamError && <p className="adminLoginError" role="alert">{teamError}</p>}
            <p className="adminTeamNote">
              Yalnızca doğrulanmış ve aktif bir Riftory hesabına yetki verilebilir; konsol hesap oluşturmaz.
              Yetki kaldırıldığında o hesabın oturumları hemen kapanır.
            </p>
          </form>
        ) : (
          <p className="adminProvisionReadonly">
            <Icon name="lock" size={15} /> Üyelik yönetimi yalnızca sahip rolüne açıktır.
          </p>
        )}
      </AdminSection>

      <AdminSection icon="lock" title="Kendi parolan">
        <form className="adminTeamForm password" onSubmit={changePassword}>
          <label>
            <span>Mevcut parola</span>
            <input
              autoComplete="current-password"
              maxLength={256}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
              type="password"
              value={currentPassword}
            />
          </label>
          <label>
            <span>Yeni parola</span>
            <input
              autoComplete="new-password"
              maxLength={128}
              minLength={8}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              type="password"
              value={newPassword}
            />
          </label>
          <label>
            <span>Yeni parola tekrar</span>
            <input
              autoComplete="new-password"
              maxLength={128}
              minLength={8}
              onChange={(event) => setRepeatPassword(event.target.value)}
              required
              type="password"
              value={repeatPassword}
            />
          </label>
          <button disabled={changingPassword} type="submit">
            <Icon name="shield" size={15} /> {changingPassword ? "Değiştiriliyor…" : "Parolayı değiştir"}
          </button>
          {passwordError && <p className="adminLoginError" role="alert">{passwordError}</p>}
          <p className="adminTeamNote">
            En az 8 karakter. Parola değişince bu oturum dışındaki tüm oturumların kapanır ve
            kurulum parolası bu hesap için çalışmaz olur.
          </p>
        </form>
      </AdminSection>
    </>
  );
}
