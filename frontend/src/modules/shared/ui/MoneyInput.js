"use client";

import { useState } from "react";
import { formatMoneyInput, parseMoney } from "@/lib/money";

// A price box in Turkish format. People type "7.491,64" or "20000"; on leaving the box it is tidied to
// "20.000,00". The form receives the number ("20000") through a hidden input named `name`, so server code
// never parses Turkish text. Invalid input is marked instead of silently becoming 0.
export default function MoneyInput({ id, name, label, defaultValue, required, onChange, placeholder = "0,00" }) {
  const [text, setText] = useState(formatMoneyInput(defaultValue));
  const value = parseMoney(text);
  const invalid = text !== "" && value === null;

  return (
    <label className="ui-field" htmlFor={id}>
      <span className="ui-label">{label}</span>
      <span className={`ui-input-wrap${invalid ? " invalid" : ""}`}>
        <input
          id={id}
          className="ui-input ui-input-money"
          inputMode="decimal"
          autoComplete="off"
          placeholder={placeholder}
          value={text}
          required={required}
          aria-invalid={invalid || undefined}
          onChange={(event) => {
            setText(event.target.value);
            onChange?.(parseMoney(event.target.value));
          }}
          onBlur={() => value !== null && setText(formatMoneyInput(value))}
        />
        <span className="ui-input-suffix">TL</span>
      </span>
      {invalid && <span className="ui-error">Tutarı 7.491,64 biçiminde yazın.</span>}
      {name && <input type="hidden" name={name} value={value ?? ""} />}
    </label>
  );
}
