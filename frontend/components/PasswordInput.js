"use client";

import { useState } from "react";

export default function PasswordInput({ id, value, onChange, autoComplete = "current-password" }) {
  const [visible, setVisible] = useState(false);
  const label = visible ? "Şifreyi gizle" : "Şifreyi göster";

  return (
    <div className="password-wrap">
      <input
        id={id}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
      />
      <button className="toggle" type="button" aria-label={label} title={label} onClick={() => setVisible(!visible)}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
    </div>
  );
}
