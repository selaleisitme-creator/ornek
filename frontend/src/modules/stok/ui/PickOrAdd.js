"use client";

import { useState } from "react";

// A select with a "Yeni … ekle" link that turns into a name box. Brands and suppliers are added on the spot
// so the entry window never has to be closed for them. onAdd(name) is a Server Action returning
// { ok, data: { id, name } } or { ok: false, error }; an existing name comes back as the existing row.
// No <form>: this sits inside the entry window, and nested forms are not allowed in HTML.
export default function PickOrAdd({ id, label, options, value, onChange, onAdd, onAdded, addLabel, placeholder, required }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function add() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onAdd(name);
      if (!result?.ok) {
        setError(result?.error ?? "Eklenemedi.");
        return;
      }
      onAdded(result.data);
      onChange(String(result.data.id));
      setName("");
      setAdding(false);
    } finally {
      setBusy(false);
    }
  }

  if (adding) {
    return (
      <div className="ui-field">
        <label className="ui-label" htmlFor={`${id}-new`}>{addLabel}</label>
        <div className="stock-entry-inline">
          <input
            id={`${id}-new`}
            className="ui-input"
            value={name}
            maxLength={80}
            autoFocus
            placeholder={placeholder}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              add();
            }}
          />
          <button type="button" className="ui-button ui-button-primary" onClick={add} disabled={busy || !name.trim()}>
            {busy ? "Ekleniyor…" : "Ekle"}
          </button>
          <button type="button" className="ui-button ui-button-ghost" onClick={() => setAdding(false)} disabled={busy}>
            Vazgeç
          </button>
        </div>
        {error && <span className="ui-error" role="alert">{error}</span>}
      </div>
    );
  }

  return (
    <div className="ui-field">
      <label className="ui-label" htmlFor={id}>{label}</label>
      <div className="stock-entry-inline">
        <select id={id} className="ui-input" value={value ?? ""} required={required} onChange={(event) => onChange(event.target.value)}>
          <option value="">Seçin…</option>
          {options.map((option) => (
            <option key={option.id} value={String(option.id)}>{option.name}</option>
          ))}
        </select>
        <button type="button" className="ui-button ui-button-ghost" onClick={() => setAdding(true)}>
          ＋ {addLabel}
        </button>
      </div>
    </div>
  );
}
