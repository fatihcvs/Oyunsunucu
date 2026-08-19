"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icon";
import {
  CONFIGURATOR_STORAGE_KEY,
  DRAFT_IMPORT_KEY_STORAGE_KEY,
  isServerDraft,
} from "@/lib/catalog";

type ImportState = "idle" | "imported" | "already" | "conflict" | "error";

const MESSAGES: Record<Exclude<ImportState, "idle">, string> = {
  imported: "Cihazındaki sunucu taslağı hesabına taşındı.",
  already: "Bu taslak hesabına daha önce taşınmıştı; ikinci bir kopya oluşturulmadı.",
  conflict: "Aynı aktarım anahtarı farklı bir taslak için kullanılmış. Yapılandırıcıdan yeni bir taslak oluştur.",
  error: "Taslak şu anda hesabına taşınamadı. Daha sonra yeniden denenecek.",
};

/** Reuses one key per device so a repeated import is recognised, not duplicated. */
function readImportKey() {
  const stored = window.localStorage.getItem(DRAFT_IMPORT_KEY_STORAGE_KEY);
  if (stored) return stored;

  const created = window.crypto.randomUUID();
  window.localStorage.setItem(DRAFT_IMPORT_KEY_STORAGE_KEY, created);
  return created;
}

function readLocalDraft() {
  try {
    const stored = window.localStorage.getItem(CONFIGURATOR_STORAGE_KEY);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    return isServerDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Silent unless there is something true to report: with no draft, no session or
 * no live identity store the component renders nothing rather than implying an
 * account action happened.
 */
export function DraftImport() {
  const [state, setState] = useState<ImportState>("idle");

  useEffect(() => {
    const controller = new AbortController();

    const send = async () => {
      const draft = readLocalDraft();
      if (!draft) return;

      try {
        const response = await fetch("/api/auth/drafts/import", {
          method: "POST",
          cache: "no-store",
          signal: controller.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ importKey: readImportKey(), draft }),
        });

        // Not signed in or identity not live yet: stay quiet and try again later.
        if (response.status === 401 || response.status === 503) return;
        if (response.status === 409) {
          setState("conflict");
          return;
        }
        if (!response.ok) {
          setState("error");
          return;
        }

        const body = await response.json().catch(() => null);
        setState(body?.code === "DRAFT_ALREADY_IMPORTED" ? "already" : "imported");
      } catch {
        if (!controller.signal.aborted) setState("error");
      }
    };

    void send();
    return () => controller.abort();
  }, []);

  if (state === "idle") return null;

  return (
    <p className="providerNotice" role="status">
      <Icon name={state === "imported" || state === "already" ? "check" : "lock"} size={15} />
      {MESSAGES[state]}
    </p>
  );
}
