"use client";

import { useState } from "react";
import LinkDialog from "./LinkDialog";

// Header with "+ Bağlantı ekle" and the tile grid. One window serves adding and editing; which link it edits
// is the only state kept here (the list itself comes from the server and refreshes after each change).
export default function LinksBoard({ links }) {
  const [editing, setEditing] = useState(null); // null: closed, "new": adding, or the link being edited

  return (
    <>
      <header className="links-head">
        <div>
          <h1>Bağlantılar</h1>
          <p>Başlığa tıklayın, ilgili site tarayıcıda açılsın.</p>
        </div>
        <button type="button" className="links-add" onClick={() => setEditing("new")}>
          + Bağlantı ekle
        </button>
      </header>

      {links.length ? (
        <ul className="links-grid">
          {links.map((link) => (
            <li key={link.id} className="links-item">
              <LinkTile link={link} onEdit={() => setEditing(link)} />
              <button
                type="button"
                className="links-edit"
                aria-label={`${link.name} bağlantısını düzenle`}
                title="Düzenle"
                onClick={() => setEditing(link)}
              >
                ✎
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="links-empty">Henüz bağlantı yok. &quot;+ Bağlantı ekle&quot; ile ilk siteyi ekleyin.</p>
      )}

      {/* A new key per opening resets the form to the chosen link. */}
      <LinkDialog
        key={editing === "new" ? "new" : (editing?.id ?? "closed")}
        link={editing === "new" ? null : editing}
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

// The tile's own colour: the letter in links.color on a pale tint of it (the design's four soft tile tones).
function LinkTile({ link, onEdit }) {
  const letter = (
    <span className="links-letter" style={{ "--tile": link.color }} aria-hidden="true">
      {link.letter}
    </span>
  );

  if (link.url) {
    return (
      <a className="links-tile" href={link.url} target="_blank" rel="noopener noreferrer">
        {letter}
        <b>{link.name}</b>
        <span className="links-go">Siteyi aç ↗</span>
      </a>
    );
  }
  return (
    <button type="button" className="links-tile missing" onClick={onEdit}>
      {letter}
      <b>{link.name}</b>
      <span className="links-go">Adres ekle</span>
    </button>
  );
}
