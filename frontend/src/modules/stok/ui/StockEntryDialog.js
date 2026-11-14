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
  newModelError,
  readStockQuery,
  stockGroupByCategory,
  stockHref,
} from "../stockRules";
import EntryGroupStep from "./EntryGroupStep";
import EntryModelStep from "./EntryModelStep";
import EntryUnitsStep, { emptyRow, entryUnits } from "./EntryUnitsStep";

const STEPS = ["Ürün grubu", "Model", "Giriş"];

function emptyModel(category, brandId, gtin) {
  return {
    category,
    brandId: category === "device" ? brandId : "",
    name: "",
    type: "",
    salePrice: null,
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

  async function leaveGroupStep() {
    if (!category) return setError("Ürün grubunu seçin.");
    if (category === "device" && !brandId) return setError("Markayı seçin ya da yeni marka ekleyin.");

    setBusy(true);
    try {
      const result = await loadEntryModels({ category, brandId: category === "device" ? brandId : null });
      if (!result?.ok) return setError(result?.error ?? "Modeller yüklenemedi.");
      setModels(result.data);
      // A model of another group or brand must not stay selected.
      if (!result.data.some((model) => model.id === choice)) setChoice(result.data.length ? null : "new");
      if (!draft || draft.category !== category || (category === "device" && draft.brandId !== brandId)) {
        setDraft(emptyModel(category, brandId, initialGtin));
      }
      setStep(1);
    } finally {
      setBusy(false);
    }
  }

  function leaveModelStep() {
    if (!choice) return setError("Bir model seçin ya da yeni model oluşturun.");
    if (choice === "new") {
      const problem = newModelError(draft);
      if (problem) return setError(problem);
    }
    if (entryFor !== choice) {
      setEntry(emptyEntry(selected, today));
      setEntryFor(choice);
    }
    setStep(2);
  }

  async function save() {
    const units = entryUnits(entry, unitModel.serialPolicy);
    const problem = entryError({
      units,
      serialPolicy: unitModel.serialPolicy,
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
    if (step === 0) return leaveGroupStep();
    if (step === 1) return leaveModelStep();
    return save();
  }

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="Stok"
      title="Stok ekle"
      size="lg"
      footer={
        <>
          {error && <p className="ui-error stock-entry-error" role="alert">{error}</p>}
          {step > 0 && (
            <button type="button" className="ui-button ui-button-ghost" disabled={busy} onClick={() => { setError(null); setStep(step - 1); }}>
              Geri
            </button>
          )}
          <button type="button" className="ui-button ui-button-ghost" onClick={onClose} disabled={busy}>Vazgeç</button>
          <button type="button" className="ui-button ui-button-primary" onClick={next} disabled={busy}>
            {busy ? "Bekleyin…" : step === 2 ? "Stoğa ekle" : "İleri"}
          </button>
        </>
      }
    >
      <Stepper steps={STEPS} current={step} />

      {step === 0 && (
        <EntryGroupStep
          category={category}
          onCategory={setCategory}
          brandId={brandId}
          onBrand={setBrandId}
          brands={brands}
          onBrandAdded={addBrandToList}
        />
      )}

      {step === 1 && (
        <EntryModelStep
          category={category}
          models={models}
          choice={choice}
          onChoice={setChoice}
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
    </Modal>
  );
}
