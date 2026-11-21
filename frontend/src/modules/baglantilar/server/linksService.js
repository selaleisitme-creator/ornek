import "server-only";
import * as repo from "./linksRepository";
import { ValidationError } from "./errors";
import { isSystemLink, linkInputError, linkLetter, nextLinkColor, normalizeUrl } from "../linkRules";

// Bağlantılar rules: the window sends only a name and an address (the design's form); the letter and colour
// of a new tile are chosen here. System links (sale wizard, SGK card) keep existing: they cannot be removed.

function toView(row) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    letter: row.icon_letter,
    color: row.color,
    systemKey: row.system_key,
  };
}

export async function listLinks() {
  return (await repo.listActiveLinks()).map(toView);
}

function cleanInput(input) {
  const problem = linkInputError(input ?? {});
  if (problem) throw new ValidationError(problem);
  return { name: String(input.name).trim().replace(/\s+/g, " "), url: normalizeUrl(input.url) || null };
}

export async function addLink(input) {
  const { name, url } = cleanInput(input);
  const [existing, sortOrder] = await Promise.all([repo.listActiveLinks(), repo.maxSortOrder()]);
  const row = await repo.insertLink({
    name,
    url,
    icon_letter: linkLetter(name),
    color: nextLinkColor(existing.length),
    sort_order: sortOrder + 1,
  });
  return toView(row);
}

// Renaming keeps the tile's letter in step with the name, except on system links, whose letters are fixed.
export async function editLink(id, input) {
  const link = await findLink(id);
  const { name, url } = cleanInput(input);
  const fields = { name, url };
  if (!isSystemLink(link) && name !== link.name) fields.icon_letter = linkLetter(name);
  await repo.updateLink(link.id, fields);
}

export async function removeLink(id) {
  const link = await findLink(id);
  if (isSystemLink(link)) throw new ValidationError("Bu bağlantı satış ve SGK adımlarında kullanılıyor; silinemez, yalnızca adresi değiştirilebilir.");
  await repo.updateLink(link.id, { active: false });
}

async function findLink(id) {
  const linkId = Number(id);
  if (!Number.isSafeInteger(linkId) || linkId <= 0) throw new ValidationError("Geçersiz bağlantı.");
  const link = await repo.getLink(linkId);
  if (!link) throw new ValidationError("Bağlantı bulunamadı; sayfayı yenileyin.");
  return link;
}
