// Small coloured label: "Stokta", "Azalıyor", "Garanti bitti"… tone: ok, warn, danger, info, neutral.
export default function StatusBadge({ tone = "neutral", children }) {
  return <span className={`ui-badge ui-badge-${tone}`}>{children}</span>;
}
