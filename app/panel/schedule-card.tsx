"use client";

import { FormEvent, useState } from "react";
import { Icon } from "../_components/icon";

export type Schedule = {
  kind: "restart";
  hour: number;
  minute: number;
  offsetMinutes: number;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
};

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MINUTES = [0, 15, 30, 45];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function formatMoment(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

/**
 * The daily restart.
 *
 * A restart clears leaks and stale entities, which is why hosts offer one, but
 * it is also a short outage — so the card states when it will happen and what
 * it costs instead of burying it in a settings list.
 *
 * The stored schedule arrives with the server list rather than through a fetch
 * of its own: one round trip, and no effect that has to be kept in step with
 * the panel's own refresh.
 */
export function ScheduleCard({ serverId, schedule, onSaved }: {
  serverId: string;
  schedule: Schedule | null;
  onSaved: (message: string) => void;
}) {
  const [enabled, setEnabled] = useState(schedule?.enabled ?? false);
  const [hour, setHour] = useState(schedule?.hour ?? 4);
  const [minute, setMinute] = useState(schedule?.minute ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the form when the server's real schedule changes — on a save, or when
  // switching servers — but leave half-made edits alone across a poll.
  const signature = `${serverId}|${schedule ? `${schedule.enabled}:${schedule.hour}:${schedule.minute}` : "yok"}`;
  const [lastSignature, setLastSignature] = useState(signature);
  if (lastSignature !== signature) {
    setLastSignature(signature);
    setEnabled(schedule?.enabled ?? false);
    setHour(schedule?.hour ?? 4);
    setMinute(schedule?.minute ?? 0);
    setError(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/servers", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          action: "save_schedule",
          serverId,
          schedule: { kind: "restart", hour, minute, enabled },
        }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(body.message ?? "Zamanlama kaydedilemedi.");
      onSaved(body.message ?? "Zamanlama kaydedildi.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Zamanlama kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="scheduleCard">
      <header>
        <span><Icon name="clock" size={18} /> Zamanlanmış yeniden başlatma</span>
        <em>{schedule?.enabled ? "AÇIK" : "KAPALI"}</em>
      </header>

      <form onSubmit={save}>
        <label className="scheduleToggle">
          <input checked={enabled} onChange={(event) => setEnabled(event.target.checked)} type="checkbox" />
          <span>
            <b>Her gün otomatik yeniden başlat</b>
            <small>Sunucu birkaç dakika kapalı kalır; dünya ve bağlantı adresi korunur.</small>
          </span>
        </label>

        <label>
          <span>Saat</span>
          <select disabled={!enabled} onChange={(event) => setHour(Number(event.target.value))} value={hour}>
            {HOURS.map((value) => <option key={value} value={value}>{pad(value)}</option>)}
          </select>
        </label>
        <label>
          <span>Dakika</span>
          <select disabled={!enabled} onChange={(event) => setMinute(Number(event.target.value))} value={minute}>
            {MINUTES.map((value) => <option key={value} value={value}>{pad(value)}</option>)}
          </select>
        </label>

        <button disabled={saving} type="submit">
          <Icon name="check" size={15} /> {saving ? "Kaydediliyor…" : "Kaydet"}
        </button>

        {error && <p className="settingsError" role="alert">{error}</p>}

        <p className="scheduleNote">
          {schedule?.enabled
            ? <>Sıradaki yeniden başlatma: <b>{formatMoment(schedule.nextRunAt)}</b>
              {schedule.lastRunAt && <> · Son çalışma: {formatMoment(schedule.lastRunAt)}</>}</>
            : "Saat Türkiye saatiyle değerlendirilir. Kapalıyken sunucu yalnızca senin komutlarınla yeniden başlar."}
        </p>
      </form>
    </section>
  );
}
