"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Modal from "@/modules/shared/ui/Modal";
import Stepper from "@/modules/shared/ui/Stepper";
import { useToast } from "@/modules/shared/ui/Toast";
import { todayInClinic } from "@/lib/dates";
import { createStockEntry, loadEntryModels } from "../server/actions";
import {
  defaultSerialPolicy,
  entryError,
  hasEarSides,
  newModelError,
  readStockQuery,
  stockGroupByCategory,
  stockHref,
} from "../stockRules";
import EntryGroupStep from "./EntryGroupStep";
import EntryModelStep from "./EntryModelStep";
import EntryUnitsStep, { emptyRow, entryUnits } from "./EntryUnitsStep";

const STEPS = ["Marka / ürün grubu", "Model seçimi", "Cihaz bilgileri"];

function emptyModel(category, brandId, gtin) {
  return {
    category,
    brandId: category === "device" ? brandId : "",
    name: "",
    type: "",
    salePrice: null,
    wholesalePrice: null,
    gtin: gtin ?? "",
    packageBarcode: "",
    manufacturerRef: "",
    warrantyMonths: "",
    minStock: "",
    serialPolicy: defaultSerialPolicy(category),
    packSize: "",
    packsPerBox: "",
    boxesPerCarton: "",
  };
}

function emptyEntry(model, today) {
  return {
    mode: "single",
    count: 1,
    rows: [emptyRow()],
    commonSide: "",
    commonDate: "",
    priceMode: "unit",
    // The model's last purchase price is a suggestion for this entry, not a rule.
    amount: model?.purchasePrice > 0 ? model.purchasePrice : null,
    paymentMethod: "",
    supplierId: "",
    invoiceNo: "",
    receivedOn: today,
    note: "",
    opening: false,
  };
}

// Server lists plus what was added in this window, without repeats (refresh() also brings the new row).
function mergeById(base, extra) {
  const byId = new Map([...base, ...extra].map((item) => [item.id, item]));
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

// "Stok ekle": group → model (or a new one) → units and purchase, saved in one database call.
// Mounted only while open, so every opening starts clean and today's date is read in the browser.
export default function StockEntryDialog({ options, initialGtin, onClose }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const [today] = useState(() => todayInClinic());

  const [step, setStep] = useState(0);
  const [category, setCategory] = useState(null);
  const [brandId, setBrandId] = useState("");
  const [extraBrands, setExtraBrands] = useState([]);
  const [extraSuppliers, setExtraSuppliers] = useState([]);
  const [models, setModels] = useState([]);
  const [choice, setChoice] = useState(null); // model id or "new"
  const [draft, setDraft] = useState(null);
  const [entry, setEntry] = useState(null);
  const [entryFor, setEntryFor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const brands = mergeById(options.brands, extraBrands);
  const suppliers = mergeById(options.suppliers, extraSuppliers);
  const selected = choice === "new" ? null : models.find((model) => model.id === choice) ?? null;
  const addBrandToList = (brand) => setExtraBrands((list) => [...list, brand]);

  const unitModel = selected
    ? { ...selected, isNew: false }
    : draft && {
        isNew: true,
        category,
        name: draft.name.trim() || "Yeni model",
        gtin: draft.gtin.trim(),
        serialPolicy: draft.serialPolicy,
        packsPerBox: draft.packsPerBox,
        boxesPerCarton: draft.boxesPerCarton,
      };

  // A group or brand card was chosen: load its models and move to step 2 at once (the design has no "İleri"
  // on this step). The values come as arguments because state set in the same click is not visible yet.
  async function pickGroup(_kind, nextCategory, nextBrandId) {
    setError(null);
    setCategory(nextCategory);
    setBrandId(nextBrandId);
    setBusy(true);
    try {
      const result = await loadEntryModels({ category: nextCategory, brandId: nextCategory === "device" ? nextBrandId : null });
      if (!result?.ok) return setError(result?.error ?? "Modeller yüklenemedi.");
      setModels(result.data);
      // A model of another group or brand must not stay selected; with no models the new-model form opens.
      if (!result.data.some((model) => model.id === choice)) setChoice(result.data.length ? null : "new");
      if (!draft || draft.category !== nextCategory || (nextCategory === "device" && draft.brandId !== nextBrandId)) {
        setDraft(emptyModel(nextCategory, nextBrandId, initialGtin));
      }
      setStep(1);
    } finally {
      setBusy(false);
    }
  }

  // An existing model card moves on at once; the new-model form needs its fields checked first.
  function leaveModelStep(nextChoice = choice) {
    if (!nextChoice) return setError("Bir model seçin ya da yeni model oluşturun.");
    if (nextChoice === "new") {
      const problem = newModelError(draft);
      if (problem) return setError(problem);
    }
    const nextSelected = nextChoice === "new" ? null : models.find((model) => model.id === nextChoice) ?? null;
    if (entryFor !== nextChoice) {
      setEntry(emptyEntry(nextSelected, today));
      setEntryFor(nextChoice);
    }
    setChoice(nextChoice);
    setStep(2);
  }

  async function save() {
    const units = entryUnits(entry, unitModel.serialPolicy);
    const problem = entryError({
      units,
      serialPolicy: unitModel.serialPolicy,
      sided: hasEarSides(unitModel.category),
      opening: entry.opening,
      priceMode: entry.priceMode,
      amount: entry.amount,
      paymentMethod: entry.paymentMethod,
      receivedOn: entry.receivedOn,
      today,
    });
    if (problem) return setError(problem);

    setBusy(true);
    try {
      const result = await createStockEntry({
        product: selected ? { id: selected.id } : draft,
        receipt: {
          opening: entry.opening,
          supplierId: entry.supplierId,
          receivedOn: entry.receivedOn,
          invoiceNo: entry.invoiceNo,
          paymentMethod: entry.paymentMethod,
          note: entry.note,
          priceMode: entry.priceMode,
          amount: entry.amount,
        },
        units: units.map(({ serialNo, earSide, productionDate }) => ({ serialNo, earSide, productionDate })),
      });
      if (!result?.ok) return setError(result?.error ?? "Stok eklenemedi.");

      toast(`${result.data.unitCount} birim stoğa eklendi.`);
      onClose();
      // Show the new units: the model's group, with that model open.
      const current = readStockQuery(Object.fromEntries(searchParams));
      router.push(
        stockHref({ gorunum: current.gorunum }, { grup: stockGroupByCategory(result.data.category).key, ac: result.data.productId }),
        { scroll: false }
      );
    } finally {
      setBusy(false);
    }
  }

  function next() {
    setError(null);
    if (step === 1) return leaveModelStep();
    return save();
  }

  // Footer per step, as in the design: step 1 only "Vazgeç"; step 2 "← Geri", plus "İleri" while the new-model
  // form is open; step 3 "← Geri" and "＋ Stoğa kaydet".
  const footer = (
    <>
      {error && <p className="ui-error stock-entry-error" role="alert">{error}</p>}
      {step === 0 ? (
        <button type="button" className="ui-button ui-button-ghost" onClick={onClose} disabled={busy}>Vazgeç</button>
      ) : (
        <button type="button" className="ui-button ui-button-ghost" disabled={busy} onClick={() => { setError(null); setStep(step - 1); }}>
          ← Geri
        </button>
      )}
      {step === 1 && choice === "new" && (
        <button type="button" className="ui-button ui-button-primary" onClick={next} disabled={busy}>İleri</button>
      )}
      {step === 2 && (
        <button type="button" className="ui-button ui-button-primary" onClick={next} disabled={busy}>
          {busy ? "Kaydediliyor…" : "＋ Stoğa kaydet"}
        </button>
      )}
    </>
  );

  const brandName = brands.find((brand) => String(brand.id) === String(brandId))?.name;
  const groupTitle = category === "device" ? brandName ?? "İşitme cihazı" : category ? stockGroupByCategory(category).label : "";

  return (
    <Modal open onClose={onClose} eyebrow="Stok yönetimi" title="Yeni stok kaydı" size="lg" footer={footer}>
      <div className="stock-entry-dialog">
        <Stepper steps={STEPS} current={step} />

        {step === 0 && <EntryGroupStep brands={brands} onPick={pickGroup} onBrandAdded={addBrandToList} busy={busy} />}

        {step === 1 && (
          <EntryModelStep
            title={groupTitle}
            category={category}
            models={models}
            choice={choice}
            onChoice={(id) => (id === "new" ? setChoice("new") : leaveModelStep(id))}
            draft={draft}
            setDraft={setDraft}
            brands={brands}
            onBrandAdded={addBrandToList}
          />
        )}

      {step === 2 && entry && unitModel && (
        <EntryUnitsStep
          model={unitModel}
          entry={entry}
          setEntry={setEntry}
          today={today}
          paymentMethods={options.paymentMethods}
          suppliers={suppliers}
          onSupplierAdded={(supplier) => setExtraSuppliers((list) => [...list, supplier])}
          onGtinScanned={(gtin) => setDraft((current) => ({ ...current, gtin }))}
        />
      )}
      </div>
    </Modal>
  );
}
