// patient_overview.devices lists the devices in use as "Model A, Model A" — one entry per ear. A patient wearing
// the same model on both ears reads better as "Model A (sağ + sol)". Other combinations stay as they are, in order.
export function summarizeDevices(text) {
  if (!text) return text ?? null;
  const counts = new Map();
  for (const name of String(text).split(", ").map((part) => part.trim()).filter(Boolean)) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => (count === 2 ? `${name} (sağ + sol)` : count > 2 ? `${name} × ${count}` : name)).join(", ");
}
