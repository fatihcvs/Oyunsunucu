"use client";

import { FormEvent, useState } from "react";
import { Icon } from "../_components/icon";

type Proposal =
  | {
    kind: "change_settings";
    serverId: string; serverName: string;
    settings: Record<string, string | number | boolean>;
    changedKeys: string[]; restarts: boolean; summary: string;
  }
  | {
    kind: "change_plan";
    serverId: string; serverName: string; planId: string; planLabel: string;
    monthlyDifference: number; monthlyAfter: number; restarts: boolean; summary: string;
  }
  | {
    kind: "command";
    serverId: string; serverName: string; command: string; restarts: boolean; summary: string;
  };

type Turn = { role: "user" | "assistant"; text: string };

const EXAMPLES = [
  "Sunucuyu 2 katına çıkar",
  "Zorluğu zor yap",
  "Karşılama mesajını değiştir",
];

/**
 * The assistant: it proposes, the customer decides.
 *
 * Nothing here applies anything on its own. A proposal is shown with what it
 * changes, what it costs and whether the server restarts; confirming sends it
 * through the same endpoints the panel's own buttons use, with the same
 * ownership and validation checks. A plan change additionally needs operator
 * rights, because no payment is taken in the closed beta.
 */
export function AssistantCard({ onApplied }: { onApplied: (message: string) => void }) {
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [asking, setAsking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const asked = message.trim();
    if (!asked || asking) return;

    setAsking(true);
    setError(null);
    setProposal(null);
    setTurns((previous) => [...previous, { role: "user", text: asked }]);
    setMessage("");
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ message: asked }),
      });
      const body = await response.json().catch(() => ({})) as {
        reply?: string; proposal?: Proposal | null; message?: string; code?: string;
      };
      if (response.status === 503 && body.code === "ASSISTANT_NOT_CONFIGURED") {
        setUnavailable(body.message ?? "Asistan henüz etkin değil.");
        return;
      }
      if (!response.ok) throw new Error(body.message ?? "Asistan yanıt veremedi.");

      setTurns((previous) => [...previous, { role: "assistant", text: body.reply ?? "" }]);
      setProposal(body.proposal ?? null);
    } catch (askError) {
      setError(askError instanceof Error ? askError.message : "Asistan yanıt veremedi.");
    } finally {
      setAsking(false);
    }
  }

  async function apply() {
    if (!proposal || applying) return;
    setApplying(true);
    setError(null);
    try {
      const request = proposal.kind === "change_plan"
        ? {
          url: "/api/admin",
          body: { action: "change_plan", serverId: proposal.serverId, planId: proposal.planId },
        }
        : proposal.kind === "change_settings"
          ? {
            url: "/api/servers",
            body: { action: "save_settings", serverId: proposal.serverId, settings: proposal.settings },
          }
          : {
            url: "/api/servers",
            body: { serverId: proposal.serverId, command: proposal.command },
          };

      const response = await fetch(request.url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(request.body),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (response.status === 403 && proposal.kind === "change_plan") {
        throw new Error("Paket değişikliği operasyon ekibinin onayını gerektiriyor.");
      }
      if (!response.ok) throw new Error(body.message ?? "İşlem uygulanamadı.");

      setTurns((previous) => [...previous, { role: "assistant", text: "Uyguladım." }]);
      setProposal(null);
      onApplied(body.message ?? "İstek sıraya alındı.");
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "İşlem uygulanamadı.");
    } finally {
      setApplying(false);
    }
  }

  if (unavailable) {
    return (
      <section className="panelNotice">
        <Icon name="spark" size={18} />
        <p><b>Asistan henüz etkin değil.</b> {unavailable}</p>
      </section>
    );
  }

  return (
    <section className="assistantCard">
      <header>
        <span><Icon name="spark" size={18} /> Riftory Asistanı</span>
        <em>ÖNERİR, UYGULAMAZ</em>
      </header>

      <div className="assistantThread">
        {turns.length === 0 && (
          <div className="assistantEmpty">
            <p>Ne yapmak istediğini yaz; ben ayarlara çeviririm, uygulamadan önce onayını isterim.</p>
            <div>
              {EXAMPLES.map((example) => (
                <button key={example} onClick={() => setMessage(example)} type="button">{example}</button>
              ))}
            </div>
          </div>
        )}
        {turns.map((turn, index) => (
          <p className={turn.role === "user" ? "assistantTurn user" : "assistantTurn"} key={index}>
            {turn.text}
          </p>
        ))}
        {asking && <p className="assistantTurn pending">Düşünüyorum…</p>}
      </div>

      {proposal && (
        <div className="assistantProposal">
          <small>ÖNERİLEN İŞLEM</small>
          <b>{proposal.summary}</b>
          <ul>
            {proposal.kind === "change_plan" && (
              <>
                <li>Aylık fark: +{proposal.monthlyDifference} TL (yeni tutar {proposal.monthlyAfter} TL)</li>
                <li>Tahsilat yapılmaz; paket değişikliği operasyon onayı gerektirir.</li>
              </>
            )}
            {proposal.kind === "change_settings" && (
              <li>Değişen alanlar: {proposal.changedKeys.join(", ")}</li>
            )}
            {proposal.restarts && <li>Sunucu yeniden başlatılacak; dünya ve adres korunur.</li>}
          </ul>
          <div>
            <button disabled={applying} onClick={() => { void apply(); }} type="button">
              <Icon name="check" size={15} /> {applying ? "Uygulanıyor…" : "Onayla ve uygula"}
            </button>
            <button className="assistantDecline" disabled={applying} onClick={() => setProposal(null)} type="button">
              Vazgeç
            </button>
          </div>
        </div>
      )}

      {error && <p className="settingsError" role="alert">{error}</p>}

      <form onSubmit={ask}>
        <input
          disabled={asking}
          maxLength={500}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Örneğin: sunucuyu 2 katına çıkar"
          value={message}
        />
        <button disabled={asking || !message.trim()} type="submit">
          <Icon name="arrow" size={16} /> Sor
        </button>
      </form>
    </section>
  );
}
