// Hearing aid boxes carry GS1 barcodes. A USB scanner types them like a keyboard, either with brackets
// "(01)05714464091134(21)B78KFP(11)240501" or raw "0105714464091134" + "21B78KFP" separated by the GS
// character (ASCII 29). The design's demo data shows both, which is why searches failed there.

const GS = String.fromCharCode(29);

// Application identifiers we need. Fixed ones have a known length; variable ones end at GS or the end.
const FIXED = { "01": 14, "11": 6, "17": 6 };
const VARIABLE = { "10": 20, "21": 20 };

// "05714464091134" → "5714464091134": a GTIN-14 with a leading zero is the same product as its EAN-13,
// so both scans find the same row.
export function normalizeGtin(code) {
  const digits = (code ?? "").replace(/[^\d]/g, "");
  if (digits.length === 14 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

// "240501" (YYMMDD) → "2024-05-01". GS1 allows day "00" meaning "end of month"; we keep the first.
function gs1Date(yymmdd) {
  const year = 2000 + Number(yymmdd.slice(0, 2));
  const month = yymmdd.slice(2, 4);
  const day = yymmdd.slice(4, 6) === "00" ? "01" : yymmdd.slice(4, 6);
  return `${year}-${month}-${day}`;
}

function readBracketed(text) {
  const fields = {};
  const re = /\((\d{2})\)([^(]*)/g;
  let match;
  while ((match = re.exec(text))) fields[match[1]] = match[2].trim();
  return fields;
}

function readRaw(text) {
  const fields = {};
  let rest = text;
  while (rest.length >= 2) {
    const ai = rest.slice(0, 2);
    if (FIXED[ai]) {
      fields[ai] = rest.slice(2, 2 + FIXED[ai]);
      rest = rest.slice(2 + FIXED[ai]);
    } else if (VARIABLE[ai]) {
      const end = rest.indexOf(GS, 2);
      const stop = end === -1 ? Math.min(rest.length, 2 + VARIABLE[ai]) : end;
      fields[ai] = rest.slice(2, stop);
      rest = rest.slice(end === -1 ? stop : end + 1);
    } else {
      break; // unknown identifier: stop instead of guessing
    }
  }
  return fields;
}

// Returns { gtin, serial, lot, productionDate, expiryDate } for a GS1 scan, or { raw } for anything else
// (a plain serial number or a shop barcode), so callers can search with whatever was scanned.
export function parseScan(input) {
  const text = (input ?? "").trim().replace(/^\][A-Za-z]\d/, ""); // some scanners prefix "]C1"
  if (!text) return { raw: "" };

  const fields = text.startsWith("(") ? readBracketed(text) : /^01\d{14}/.test(text) ? readRaw(text) : null;
  if (!fields || !fields["01"]) return { raw: text };

  return {
    gtin: normalizeGtin(fields["01"]),
    serial: fields["21"] || null,
    lot: fields["10"] || null,
    productionDate: fields["11"] ? gs1Date(fields["11"]) : null,
    expiryDate: fields["17"] ? gs1Date(fields["17"]) : null,
  };
}
