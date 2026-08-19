"use client";

import { FormEvent, useState } from "react";
import { Icon } from "../_components/icon";

type Line = { kind: "command" | "output" | "error"; text: string };

const QUICK_ACTIONS = [
  { action: "list", label: "Çevrimiçi oyuncular", needsPlayer: false },
  { action: "whitelist_add", label: "Beyaz listeye ekle", needsPlayer: true },
  { action: "whitelist_remove", label: "Beyaz listeden çıkar", needsPlayer: true },
  { action: "op", label: "Yetkili yap", needsPlayer: true },
  { action: "deop", label: "Yetkiyi al", needsPlayer: true },
  { action: "kick", label: "Oyundan at", needsPlayer: true },
  { action: "ban", label: "Yasakla", needsPlayer: true },
  { action: "pardon", label: "Yasağı kaldır", needsPlayer: true },
] as const;

/**
 * The in-game console, with the common actions as buttons.
 *
 * Two ways in on purpose: the buttons cover what most people actually need
 * without knowing command syntax, and the free-text box is there for everything
 * else. Both go through the same endpoint and the same ownership check.
 */
export function ConsoleCard({ serverId, online, gameId }: {
  serverId: string;
  online: boolean;
  gameId: string;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [command, setCommand] = useState("");
  const [player, setPlayer] = useState("");
  const [busy, setBusy] = useState(false);

  if (gameId !== "minecraft") {
    return (
      <section className="panelNotice">
        <Icon name="terminal" size={18} />
        <p><b>Bu oyun için konsol henüz yok.</b> Konsol şimdilik Minecraft sunucularında çalışıyor.</p>
      </section>
    );
  }

  async function send(body: Record<string, unknown>, shown: string) {
    if (busy || !online) return;
    setBusy(true);
    setLines((previous) => [...previous, { kind: "command" as const, text: shown }].slice(-40));
    try {
      const response = await fetch("/api/servers/console", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ serverId, ...body }),
      });
      const payload = await response.json().catch(() => ({})) as { output?: string; message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Komut çalıştırılamadı.");
      setLines((previous) => [...previous, { kind: "output" as const, text: payload.output ?? "" }].slice(-40));
    } catch (error) {
      setLines((previous) => [
        ...previous,
        { kind: "error" as const, text: error instanceof Error ? error.message : "Komut çalıştırılamadı." },
      ].slice(-40));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const typed = command.trim();
    if (!typed) return;
    setCommand("");
    void send({ command: typed }, `> ${typed}`);
  }

  return (
    <section className="consoleCard">
      <header>
        <span><Icon name="terminal" size={18} /> Konsol</span>
        <em>{online ? "BAĞLI" : "SUNUCU ÇALIŞMIYOR"}</em>
      </header>

      <div className="consoleActions">
        <input
          maxLength={16}
          onChange={(event) => setPlayer(event.target.value)}
          placeholder="Oyuncu adı"
          value={player}
        />
        <div>
          {QUICK_ACTIONS.map((quick) => (
            <button
              disabled={busy || !online || (quick.needsPlayer && player.trim().length < 3)}
              key={quick.action}
              onClick={() => void send(
                { action: quick.action, player: player.trim() },
                quick.needsPlayer ? `> ${quick.label}: ${player.trim()}` : `> ${quick.label}`,
              )}
              type="button"
            >
              {quick.label}
            </button>
          ))}
        </div>
      </div>

      <div className="consoleLog">
        {lines.length === 0 && (
          <p className="consoleHint">
            Butonlarla oyuncu yönetimi yapabilir veya aşağıya doğrudan komut yazabilirsin.
            Sunucuyu durdurmak ve yeniden başlatmak için üstteki butonları kullan.
          </p>
        )}
        {lines.map((line, index) => (
          <pre className={`consoleLine ${line.kind}`} key={index}>{line.text}</pre>
        ))}
      </div>

      <form onSubmit={submit}>
        <input
          disabled={busy || !online}
          maxLength={300}
          onChange={(event) => setCommand(event.target.value)}
          placeholder={online ? "örn. say Merhaba" : "Sunucu çalışmıyor"}
          value={command}
        />
        <button disabled={busy || !online || !command.trim()} type="submit">
          <Icon name="arrow" size={16} /> Çalıştır
        </button>
      </form>
    </section>
  );
}
