"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "../_components/icon";
import { PanelDemo, type DemoNotice } from "./panel-demo";
import { LivePanel, type PanelServer } from "./live-panel";

/**
 * Why the panel is showing the demo instead of a real server.
 *
 * Kept explicit so the page can say which one it is. A visitor who is simply
 * signed out and a deployment whose panel is not wired up are different
 * situations, and telling them apart is the difference between a useful message
 * and a misleading one.
 */
type DemoReason = "signed_out" | "no_servers" | "unavailable";

type PanelState =
  | { kind: "loading" }
  | { kind: "demo"; reason: DemoReason }
  | { kind: "live"; servers: PanelServer[] };

const DEMO_NOTES: Record<DemoReason, DemoNotice> = {
  signed_out: {
    text: "gerçek bir sunucuya komut göndermez. Kendi sunucunu yönetmek için giriş yap.",
    action: { href: "/giris?returnTo=/panel", label: "Giriş yap" },
  },
  no_servers: {
    text: "henüz bir sunucun yok, bu panel örnek veriyle çalışıyor.",
    action: { href: "/kurulum", label: "Sunucu yapılandır" },
  },
  unavailable: {
    text: "sunucu verisine şu anda ulaşılamıyor, bu panel örnek veriyle çalışıyor.",
  },
};

export function PanelShell() {
  const [state, setState] = useState<PanelState>({ kind: "loading" });

  const load = useCallback(
    () =>
      fetch("/api/servers", { cache: "no-store", headers: { accept: "application/json" } })
        .then(async (response): Promise<PanelState> => {
          // A signed-out visitor and a panel that cannot answer are different
          // things, and the ribbon says which one happened.
          if (response.status === 401) return { kind: "demo", reason: "signed_out" };
          if (!response.ok) return { kind: "demo", reason: "unavailable" };

          const body = await response.json() as { servers?: PanelServer[] };
          const servers = body.servers ?? [];
          return servers.length > 0
            ? { kind: "live", servers }
            : { kind: "demo", reason: "no_servers" };
        })
        .catch((): PanelState => ({ kind: "demo", reason: "unavailable" }))
        .then(setState),
    [],
  );

  useEffect(() => { void load(); }, [load]);

  if (state.kind === "loading") {
    return (
      <div className="panelLoading" role="status">
        <Icon name="server" size={20} />
        <p>Sunucuların okunuyor…</p>
      </div>
    );
  }

  if (state.kind === "live") {
    return <LivePanel onRefresh={load} servers={state.servers} />;
  }

  return <PanelDemo notice={DEMO_NOTES[state.reason]} />;
}
