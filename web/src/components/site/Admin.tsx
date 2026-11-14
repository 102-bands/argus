// Contact messages for the team. Needs the ADMIN_TOKEN set on the server; kept in this tab only.
import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "../../lib/api";
import { SiteLayout } from "./SiteLayout";

interface Message {
  id: number;
  created: number;
  name: string;
  email: string;
  topic: string;
  body: string;
  handled: boolean;
}

const KEY = "argus.adminToken";

export function Admin({ navigate }: { navigate: (path: string) => void }) {
  const [token, setToken] = useState(() => { try { return sessionStorage.getItem(KEY) ?? ""; } catch { return ""; } });
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Message[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHandled, setShowHandled] = useState(false);

  const load = useCallback(async (tok: string) => {
    setError(null);
    try {
      const r = await fetch(`${API_BASE}/admin/messages`, { headers: { Authorization: `Bearer ${tok}` } });
      if (r.status === 401) { setError("That token is wrong."); setToken(""); return; }
      if (r.status === 404) { setError("Admin is switched off: set ADMIN_TOKEN on the server."); return; }
      if (!r.ok) { setError(`The server answered ${r.status}.`); return; }
      setMsgs(((await r.json()) as { messages: Message[] }).messages);
      try { sessionStorage.setItem(KEY, tok); } catch { /* keep in memory only */ }
    } catch {
      setError("Can't reach the server.");
    }
  }, []);

  useEffect(() => { if (token) void load(token); }, [token, load]);

  const toggle = async (m: Message) => {
    const r = await fetch(`${API_BASE}/admin/messages/${m.id}/handled?handled=${!m.handled}`,
                          { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) setMsgs((list) => list?.map((x) => (x.id === m.id ? { ...x, handled: !m.handled } : x)) ?? null);
  };

  const shown = msgs?.filter((m) => showHandled || !m.handled) ?? [];
  return (
    <SiteLayout page="admin" navigate={navigate}>
      <main id="main" className="admin-page">
        <header className="page-head">
          <h1>Messages</h1>
          {msgs && <p className="lede">{msgs.filter((m) => !m.handled).length} open · {msgs.length} total</p>}
        </header>
        {!token || !msgs ? (
          <form className="admin-login" onSubmit={(e) => { e.preventDefault(); setToken(input.trim()); }}>
            <label htmlFor="tok">Admin token</label>
            <input id="tok" type="password" autoComplete="current-password" value={input} onChange={(e) => setInput(e.target.value)} />
            <button className="btn btn-primary" type="submit">Open</button>
            {error && <p className="err" role="alert">{error}</p>}
          </form>
        ) : (
          <>
            <label className="admin-filter"><input type="checkbox" checked={showHandled} onChange={(e) => setShowHandled(e.target.checked)} /> Show handled</label>
            {shown.length === 0 && <p className="note">No open messages.</p>}
            <ul className="msg-list">
              {shown.map((m) => (
                <li key={m.id} className={m.handled ? "handled" : ""}>
                  <div className="msg-meta mono">
                    <span>{new Date(m.created * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC</span>
                    <span>{m.topic}</span>
                  </div>
                  <p className="msg-from"><b>{m.name}</b> · <a href={`mailto:${m.email}?subject=${encodeURIComponent("Re: your message about Argus")}`}>{m.email}</a></p>
                  <p className="msg-body">{m.body}</p>
                  <button className="btn" onClick={() => toggle(m)}>{m.handled ? "Mark open" : "Mark handled"}</button>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </SiteLayout>
  );
}
