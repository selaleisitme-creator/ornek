import "server-only";
import { SERVICE_CATEGORIES, buildServiceItem } from "../stockRules";
import * as repo from "./serviceCatalogRepository";
import { ValidationError } from "./errors";

// "Servis" tab: service and audiology exam prices (VAT included). A price change is logged by the services
// trigger, so "Son fiyat güncellemesi" needs nothing written here. "Kaldır" hides the item (active = false):
// sales may point at it.

// Both groups, each with its items and the day each price last changed (the creation day if never changed).
export async function getServiceCatalog() {
  const services = await repo.listActiveServices();
  const changes = await repo.listServicePriceChanges(services.map((service) => service.id));
  const lastChange = new Map();
  for (const change of changes) if (!lastChange.has(change.service_id)) lastChange.set(change.service_id, change.changed_at);

  return SERVICE_CATEGORIES.map((category) => {
    const items = services
      .filter((service) => service.category === category.value)
      .map((service) => ({
        id: service.id,
        name: service.name,
        price: Number(service.price),
        lastPriceChangeAt: lastChange.get(service.id) ?? service.created_at,
      }));
    return { category: category.value, label: category.label, items };
  });
}

function serviceId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new ValidationError("Kalem seçin.");
  return id;
}

async function activeService(id) {
  const service = await repo.getService(serviceId(id));
  if (!service?.active) throw new ValidationError("Bu kalem bulunamadı ya da listeden kaldırılmış; sayfayı yenileyin.");
  return service;
}

// With an id the item's name and price change; without one a new item joins the given group.
export async function saveServiceItem(input) {
  const isNew = input?.id === null || input?.id === undefined || input?.id === "";
  const built = buildServiceItem(input, { isNew });
  if (built.error) throw new ValidationError(built.error);

  if (isNew) return repo.insertService(built.values);

  const service = await activeService(input.id);
  const updated = await repo.updateActiveService(service.id, built.values);
  if (!updated) throw new ValidationError("Kalem güncellenemedi; sayfayı yenileyip tekrar deneyin.");
  return updated;
}

export async function removeServiceItem(id) {
  const service = await activeService(id);
  const updated = await repo.updateActiveService(service.id, { active: false });
  if (!updated) throw new ValidationError("Kalem kaldırılamadı; sayfayı yenileyip tekrar deneyin.");
}
