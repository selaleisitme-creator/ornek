// A chosen logo (drawn preset or uploaded picture) when there is one, otherwise the old letter mark.
export default function SourceIcon({ icon }) {
  if (icon.src) {
    return (
      <span className="home-source-icon home-source-logo" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- 27 px logo from Storage or public/, no resizing needed */}
        <img src={icon.src} alt="" width={20} height={20} loading="lazy" />
      </span>
    );
  }
  return (
    <span className={`home-source-icon ${icon.tone}`} aria-hidden="true">
      {icon.mark}
    </span>
  );
}
