"use client";

import { FormEvent, useState } from "react";
import { Icon } from "../_components/icon";

export type SettingField =
  | { key: string; kind: "text"; label: string; hint: string; maxLength: number; fallback: string; format?: "url" }
  | { key: string; kind: "number"; label: string; hint: string; min: number; max: number; fallback: number }
  | { key: string; kind: "choice"; label: string; hint: string; choices: Array<{ value: string; label: string }>; fallback: string }
  | { key: string; kind: "toggle"; label: string; hint: string; fallback: boolean };

export type SettingGroup = {
  id: string;
  label: string;
  hint: string;
  fields: SettingField[];
};

export type SettingValue = string | number | boolean;

/**
 * The runtime settings of the server, edited in place.
 *
 * The catalogue is long enough that one flat form would be unreadable, so it
 * arrives already split into sections and only one section is open at a time.
 * A section that holds unsaved edits says so on its own header, because a
 * closed section must never hide a change the customer is about to save.
 *
 * The restart is stated up front rather than discovered afterwards: the game
 * only reads its configuration at boot, so saving always costs a short outage
 * and players who are online should not be surprised by it.
 */
export function ServerSettingsCard({ serverId, groups, values, editable, busyReason, onSaved }: {
  serverId: string;
  groups: SettingGroup[];
  values: Record<string, SettingValue>;
  editable: boolean;
  busyReason: string | null;
  onSaved: (message: string) => void;
}) {
  const [draft, setDraft] = useState<Record<string, SettingValue>>(values);
  const [openGroups, setOpenGroups] = useState<string[]>(groups[0] ? [groups[0].id] : []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Reset only when the real settings of the server change, not on every poll.
   *
   * The panel refetches while a job runs, which hands this component a new
   * object every few seconds. Comparing the contents rather than the reference
   * means half-typed edits survive a refresh, while a save — or switching to
   * another server — genuinely replaces what is on screen.
   */
  const signature = `${serverId}|${JSON.stringify(values)}`;
  const [lastSignature, setLastSignature] = useState(signature);
  if (lastSignature !== signature) {
    setLastSignature(signature);
    setDraft(values);
    setError(null);
  }

  if (groups.length === 0) {
    return (
      <section className="panelNotice">
        <Icon name="settings" size={18} />
        <p>
          <b>Bu oyun için ayar yönetimi henüz yok.</b>
          Ayarlar yalnızca kapsayıcıda doğrulanmış birleşimlerde açılıyor.
        </p>
      </section>
    );
  }

  const changedKeys = new Set(
    groups.flatMap((group) => group.fields)
      .filter((field) => draft[field.key] !== values[field.key])
      .map((field) => field.key),
  );
  const changed = changedKeys.size > 0;

  function toggleGroup(groupId: string, open: boolean) {
    setOpenGroups((current) => open
      ? [...current.filter((id) => id !== groupId), groupId]
      : current.filter((id) => id !== groupId));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editable || !changed) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/servers", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ action: "save_settings", serverId, settings: draft }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(body.message ?? "Ayarlar kaydedilemedi.");
      onSaved(body.message ?? "Ayarlar kaydedildi.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Ayarlar kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settingsCard">
      <header>
        <span><Icon name="settings" size={18} /> Sunucu ayarları</span>
        <em>{changed ? `${changedKeys.size} DEĞİŞİKLİK` : "GÜNCEL"}</em>
      </header>

      <form onSubmit={save}>
        {groups.map((group) => {
          const pending = group.fields.filter((field) => changedKeys.has(field.key)).length;
          return (
            <details
              className="settingsGroup"
              key={group.id}
              onToggle={(event) => toggleGroup(group.id, event.currentTarget.open)}
              open={openGroups.includes(group.id)}
            >
              <summary>
                <span>
                  <b>{group.label}</b>
                  <small>{group.hint}</small>
                </span>
                {pending > 0 && <em>{pending} değişiklik</em>}
                <i aria-hidden="true" />
              </summary>

              <div className="settingsGrid">
                {group.fields.map((field) => (
                  <label
                    className={`${field.kind === "toggle" ? "settingsToggle" : ""}${changedKeys.has(field.key) ? " isChanged" : ""}`}
                    key={field.key}
                  >
                    <span>{field.label}</span>
                    {field.kind === "text" && (
                      <input
                        disabled={!editable}
                        inputMode={field.format === "url" ? "url" : "text"}
                        maxLength={field.maxLength}
                        onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
                        placeholder={field.format === "url" ? "https://" : undefined}
                        type="text"
                        value={String(draft[field.key] ?? "")}
                      />
                    )}
                    {field.kind === "number" && (
                      <input
                        disabled={!editable}
                        max={field.max}
                        min={field.min}
                        onChange={(event) => setDraft({ ...draft, [field.key]: Number(event.target.value) })}
                        type="number"
                        value={Number(draft[field.key] ?? field.fallback)}
                      />
                    )}
                    {field.kind === "choice" && (
                      <select
                        disabled={!editable}
                        onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
                        value={String(draft[field.key] ?? field.fallback)}
                      >
                        {field.choices.map((choice) => (
                          <option key={choice.value} value={choice.value}>{choice.label}</option>
                        ))}
                      </select>
                    )}
                    {field.kind === "toggle" && (
                      <input
                        checked={Boolean(draft[field.key])}
                        disabled={!editable}
                        onChange={(event) => setDraft({ ...draft, [field.key]: event.target.checked })}
                        type="checkbox"
                      />
                    )}
                    <small>{field.hint}</small>
                  </label>
                ))}
              </div>
            </details>
          );
        })}

        {error && <p className="settingsError" role="alert">{error}</p>}

        <footer>
          <p>
            <Icon name="refresh" size={14} />
            Kaydetmek sunucuyu yeni ayarlarla yeniden başlatır; dünyan korunur,
            bağlantı adresin değişmez.
          </p>
          <div>
            {changed && (
              <button className="settingsReset" disabled={saving} onClick={() => setDraft(values)} type="button">
                Geri al
              </button>
            )}
            <button disabled={!editable || !changed || saving} type="submit">
              <Icon name="check" size={15} /> {saving ? "Kaydediliyor…" : "Kaydet ve yeniden başlat"}
            </button>
          </div>
        </footer>

        {!editable && (
          <p className="settingsBlocked">
            <Icon name="lock" size={14} /> {busyReason ?? "Sunucu bu durumdayken ayar değiştirilemez."}
          </p>
        )}
      </form>
    </section>
  );
}
