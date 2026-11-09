"use client";

import { useRef, useState } from "react";
import { parseScan } from "@/lib/gs1";

// A USB barcode scanner types like a keyboard and ends with Enter. This box catches that Enter, hands the
// parsed result (GTIN, serial, dates, or the raw text) to onScan, and clears itself for the next scan, so
// serial numbers can be scanned one after another. Typing by hand and pressing Enter works the same way.
export default function ScanInput({ label = "Barkod veya seri no", placeholder = "Okutun ya da yazıp Enter'a basın…", onScan, autoFocus }) {
  const [text, setText] = useState("");
  const input = useRef(null);

  return (
    <label className="ui-field">
      <span className="ui-label">{label}</span>
      <span className="ui-input-wrap ui-scan">
        <span className="ui-input-prefix" aria-hidden="true">▦</span>
        <input
          ref={input}
          className="ui-input"
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            if (!text.trim()) return;
            onScan?.(parseScan(text));
            setText("");
            input.current?.focus();
          }}
        />
      </span>
    </label>
  );
}
