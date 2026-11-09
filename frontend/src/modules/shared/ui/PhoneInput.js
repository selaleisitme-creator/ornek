"use client";

import { useState } from "react";
import { COUNTRY_CODES, normalizePhone } from "@/lib/phone";

// Country code + number, as in the design. The form receives "+905321234567" through a hidden input
// named `name`, so every phone in the database has the same shape.
export default function PhoneInput({ id, name, label = "Telefon", defaultCountry = "+90", defaultNumber = "", required, onChange }) {
  const [country, setCountry] = useState(defaultCountry);
  const [number, setNumber] = useState(defaultNumber);
  const value = normalizePhone(country, number);
  const invalid = number.trim() !== "" && value === null;

  function update(nextCountry, nextNumber) {
    setCountry(nextCountry);
    setNumber(nextNumber);
    onChange?.(normalizePhone(nextCountry, nextNumber));
  }

  return (
    <div className="ui-field">
      <label className="ui-label" htmlFor={id}>{label}</label>
      <div className={`ui-phone${invalid ? " invalid" : ""}`}>
        <select
          className="ui-input ui-phone-country"
          aria-label="Ülke kodu"
          value={country}
          onChange={(event) => update(event.target.value, number)}
        >
          {COUNTRY_CODES.map((option) => (
            <option key={option.code} value={option.code}>
              {option.code} · {option.label}
            </option>
          ))}
        </select>
        <input
          id={id}
          className="ui-input"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="532 123 45 67"
          value={number}
          required={required}
          aria-invalid={invalid || undefined}
          onChange={(event) => update(country, event.target.value)}
        />
      </div>
      {invalid && <span className="ui-error">Ülke koduyla birlikte geçerli bir telefon numarası girin.</span>}
      {name && <input type="hidden" name={name} value={value ?? ""} />}
    </div>
  );
}
