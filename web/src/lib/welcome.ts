// The tool's welcome popup shows once per browser: seeing it counts, whatever the visitor clicks.
const KEY = "argus.welcomed";

export function hasBeenWelcomed(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

export function markWelcomed(): void {
  try { localStorage.setItem(KEY, "1"); } catch { /* private mode: show again next time */ }
}
