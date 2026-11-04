"use client";

import { useEffect, useRef } from "react";

const LENGTH = 6;

// Six single-digit boxes: typing moves forward, Backspace moves back, pasting fills all.
// onComplete fires once all six digits are present so the user does not have to press the button.
export default function OtpInput({ value, onChange, onComplete, invalid, disabled }) {
  const boxes = useRef([]);
  const digits = Array.from({ length: LENGTH }, (_, i) => value[i] ?? "");

  useEffect(() => {
    if (!value) boxes.current[0]?.focus();
  }, [value]);

  function update(next) {
    onChange(next);
    if (next.length === LENGTH) onComplete?.(next);
  }

  function handleInput(index, raw) {
    const digit = raw.replace(/\D/g, "").slice(-1);
    const next = (digits.slice(0, index).join("") + digit).slice(0, LENGTH);
    update(next);
    if (digit && index < LENGTH - 1) boxes.current[index + 1]?.focus();
  }

  function handleKeyDown(index, event) {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      onChange(digits.slice(0, index - 1).join(""));
      boxes.current[index - 1]?.focus();
    }
  }

  function handlePaste(event) {
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, LENGTH);
    if (!pasted) return;
    event.preventDefault();
    update(pasted);
    boxes.current[Math.min(pasted.length, LENGTH - 1)]?.focus();
  }

  return (
    <div className={`otp${invalid ? " invalid" : ""}`} role="group" aria-label="6 haneli doğrulama kodu" onPaste={handlePaste}>
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => (boxes.current[i] = el)}
          type="text"
          inputMode="numeric"
          maxLength={1}
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`${i + 1}. hane`}
          value={digit}
          disabled={disabled}
          onChange={(e) => handleInput(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
        />
      ))}
    </div>
  );
}
