// Website helpers: public counters (api/argus/store.py) and the Space Apps link.
import { API_BASE } from "./api";

export interface Stats {
  fields_analysed: number;
  live_searches: number;
  exposures_processed: number;
  downloads: number;
  visits: number;
  since: string;
}

/** Our challenge page on the Space Apps site. */
export const CHALLENGE_URL = "https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/";

/** Count one event for the public counters. Fire-and-forget; never blocks or breaks the page. */
export function countEvent(event: "field" | "download"): void {
  try {
    void fetch(`${API_BASE}/count`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event }), keepalive: true,
    }).catch(() => undefined);
  } catch {
    // counters are best-effort
  }
}

export async function fetchStats(signal?: AbortSignal): Promise<Stats> {
  const r = await fetch(`${API_BASE}/stats`, { signal });
  if (!r.ok) throw new Error(`stats ${r.status}`);
  return (await r.json()) as Stats;
}

export interface ContactBody {
  name: string;
  email: string;
  topic: string;
  message: string;
  website: string; // honeypot
}

export async function sendContact(body: ContactBody): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const r = await fetch(`${API_BASE}/contact`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (r.ok) return { ok: true };
    if (r.status === 429) return { ok: false, error: "Too many messages from this connection. Try again in an hour." };
    if (r.status === 422) return { ok: false, error: "Check the highlighted fields and try again." };
    return { ok: false, error: `The server answered ${r.status}. Try again in a minute.` };
  } catch {
    return { ok: false, error: "Can't reach the server. Check your connection and try again." };
  }
}
