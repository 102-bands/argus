// Contact form: messages are stored on our server and read on /admin (api/argus/store.py).
import { useState } from "react";
import { track } from "../../lib/analytics";
import { sendContact } from "../../lib/site";

const TOPICS: [string, string][] = [
  ["question", "A question about Argus"],
  ["feedback", "Feedback or an idea"],
  ["bug", "Something isn't working"],
  ["collaboration", "Collaboration or research"],
  ["press", "Press or education"],
  ["other", "Something else"],
];
const EMAIL = /^[^@\s<>]{1,64}@[^@\s<>]{1,190}\.[A-Za-z]{2,24}$/;

export function ContactForm() {
  const [f, setF] = useState({ name: "", email: "", topic: "question", message: "", website: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [serverError, setServerError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((v) => ({ ...v, [k]: e.target.value }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = "Enter your name.";
    if (!EMAIL.test(f.email.trim())) e.email = "Enter an email address we can reply to.";
    if (f.message.trim().length < 10) e.message = "Write at least 10 characters.";
    if (f.message.length > 4000) e.message = "Keep it under 4000 characters.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    if (!validate()) return;
    setState("sending");
    const r = await sendContact({ ...f, name: f.name.trim(), email: f.email.trim() });
    if (r.ok) {
      setState("sent");
      track("contact_submit", { topic: f.topic });
    } else {
      setState("idle");
      setServerError(r.error);
    }
  };

  if (state === "sent") {
    return (
      <div className="contact-done" role="status">
        <h3>Message sent</h3>
        <p>Thanks, {f.name.trim()}. We'll reply to {f.email.trim()}.</p>
        <button className="btn" onClick={() => { setF({ name: "", email: "", topic: "question", message: "", website: "" }); setState("idle"); }}>
          Send another
        </button>
      </div>
    );
  }

  return (
    <form className="contact-form" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="c-name">Name</label>
        <input id="c-name" autoComplete="name" value={f.name} onChange={set("name")} maxLength={100}
               aria-invalid={!!errors.name} aria-describedby={errors.name ? "c-name-e" : undefined} />
        {errors.name && <span className="err" id="c-name-e">{errors.name}</span>}
      </div>
      <div className="field">
        <label htmlFor="c-email">Email</label>
        <input id="c-email" type="email" autoComplete="email" value={f.email} onChange={set("email")} maxLength={200}
               aria-invalid={!!errors.email} aria-describedby={errors.email ? "c-email-e" : undefined} />
        {errors.email && <span className="err" id="c-email-e">{errors.email}</span>}
      </div>
      <div className="field">
        <label htmlFor="c-topic">About</label>
        <select id="c-topic" value={f.topic} onChange={set("topic")}>
          {TOPICS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div className="field wide">
        <label htmlFor="c-msg">Message</label>
        <textarea id="c-msg" rows={6} value={f.message} onChange={set("message")} maxLength={4000}
                  aria-invalid={!!errors.message} aria-describedby={errors.message ? "c-msg-e" : "c-msg-h"} />
        {errors.message ? <span className="err" id="c-msg-e">{errors.message}</span>
          : <span className="hint" id="c-msg-h">{f.message.length} / 4000</span>}
      </div>
      {/* Honeypot: hidden from people and screen readers; bots fill it in and their message is dropped. */}
      <div className="hp" aria-hidden="true">
        <label htmlFor="c-web">Website</label>
        <input id="c-web" tabIndex={-1} autoComplete="off" value={f.website} onChange={set("website")} />
      </div>
      <div className="field wide submit-row">
        <button className="btn btn-primary" type="submit" disabled={state === "sending"}>
          {state === "sending" ? "Sending…" : "Send message"}
        </button>
        <span className="hint">We store your name, email and message only to reply. No mailing lists.</span>
      </div>
      {serverError && <p className="err" role="alert">{serverError}</p>}
    </form>
  );
}
