"use client";

import { useEffect } from "react";

/**
 * Replaces a session token once it is past half its life.
 *
 * Rotation shortens how long any single captured cookie stays useful, and it is
 * what makes reuse detection possible: presenting a replaced token afterwards
 * burns the whole session family server-side.
 *
 * Renders nothing. A failure is silent on purpose — the visitor's session is
 * still valid, and the next visit tries again.
 */
export function SessionKeepalive() {
  useEffect(() => {
    const controller = new AbortController();

    const rotateIfStale = async () => {
      try {
        const current = await fetch("/api/auth/session", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!current.ok) return;

        const session = await current.json().catch(() => null);
        const expiresAt = Date.parse(session?.session?.expiresAt ?? "");
        if (!session?.authenticated || !Number.isFinite(expiresAt)) return;

        // The cookie lives 30 days; rotating inside the final half keeps a
        // token from being carried around for its entire lifetime.
        const remaining = expiresAt - Date.now();
        const halfLife = 15 * 24 * 60 * 60 * 1000;
        if (remaining > halfLife) return;

        await fetch("/api/auth/session/refresh", {
          method: "POST",
          cache: "no-store",
          signal: controller.signal,
          headers: { "content-type": "application/json" },
          body: "{}",
        });
      } catch {
        // Network trouble or an aborted navigation; the session is untouched.
      }
    };

    void rotateIfStale();
    return () => controller.abort();
  }, []);

  return null;
}
