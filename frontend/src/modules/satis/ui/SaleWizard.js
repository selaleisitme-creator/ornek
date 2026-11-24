"use client";

import { useEffect, useState } from "react";
import Modal from "@/modules/shared/ui/Modal";
import Stepper from "@/modules/shared/ui/Stepper";
import { useToast } from "@/modules/shared/ui/Toast";
import { todayInClinic } from "@/lib/dates";
import { buildSaleArgs, defaultTaxRate, isEarDevice, warrantyEndFor } from "../saleRules";
import { createSale, loadSaleCatalog } from "../server/actions";
import SaleProductStep from "./SaleProductStep";
import SaleCartStep from "./SaleCartStep";
import SaleSitesStep from "./SaleSitesStep";
import "./sale.css";

const STEPS = ["Ürün ekle", "Sepet ve ödeme", "Satış bildirimi"];

// "＋ Hasta işlem" (docs/faz-2-satis-plani.md, section 1): products and services into a cart, payments, then the
// post-sale sites, saved in one database call (create_sale). Toptan satış (section 4) reuses it with kind="wholesale".
//   patient: { id, name } for a patient sale; onClose: closes the window.
export default function SaleWizard({ patient, kind = "retail", onClose }) {
  const toast = useToast();
  const today = todayInClinic();
  const wholesale = kind === "wholesale";
  const [step, setStep] = useState(0);
  const [catalog, setCatalog] = useState(null);
  const [lines, setLines] = useState([]);
  const [sale, setSale] = useState({
    saleDate: today,
    discount: null,
    sgkAmount: null,
    customerName: "",
    customerPhone: "",
    invoiceMode: "single",
    invoiceNo: "",
    payments: [{ key: 1, method: "cash", amount: null, installments: "" }],
    sites: {},
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    loadSaleCatalog().then((result) => {
      if (!alive) return;
      if (result?.ok) setCatalog(result.data);
      else setError(result?.error ?? "Satış bilgileri yüklenemedi.");
    });
    return () => {
      alive = false;
    };
  }, []);

  const priceOf = (item) => (wholesale ? item.wholesalePrice : item.salePrice);

  // Adders used by the product step. A unit enters once; a serial-less model or a service adds to its quantity.
  const add = {
    unit(unit) {
      if (lines.some((line) => line.unitId === unit.unitId)) return "Bu ürün zaten sepette.";
      if (wholesale && unit.wholesalePrice === null) return `${unit.name} için toptan fiyatı yok. Stok kartından toptan fiyatını girin.`;
      setLines((current) => [
        ...current,
        {
          key: `u${unit.unitId}`,
          type: "unit",
          unitId: unit.unitId,
          name: unit.name,
          serial: unit.serial,
          category: unit.category,
          unitPrice: priceOf(unit),
          taxRate: defaultTaxRate(unit.category),
          earSide: unit.earSide ?? "",
          moldType: "",
          utsNo: "",
          warrantyEnd: isEarDevice(unit.category) ? warrantyEndFor(sale.saleDate, unit.warrantyMonths) : "",
          invoiceNo: "",
        },
      ]);
      return null;
    },
    model(model) {
      if (wholesale && model.wholesalePrice === null) return `${model.name} için toptan fiyatı yok. Stok kartından toptan fiyatını girin.`;
      const existing = lines.find((line) => line.type === "product" && line.productId === model.productId);
      if (existing) {
        if (existing.quantity >= model.inStock) return `Stokta ${model.inStock} adet var.`;
        setLines((current) => current.map((line) => (line === existing ? { ...line, quantity: line.quantity + 1 } : line)));
        return null;
      }
      setLines((current) => [
        ...current,
        {
          key: `p${model.productId}`,
          type: "product",
          productId: model.productId,
          name: model.name,
          category: model.category,
          quantity: 1,
          maxQuantity: model.inStock,
          unitPrice: priceOf(model),
          taxRate: defaultTaxRate(model.category),
          moldType: "",
          invoiceNo: "",
        },
      ]);
      return null;
    },
    service(service) {
      const existing = lines.find((line) => line.type === "service" && line.serviceId === service.id);
      if (existing) {
        setLines((current) => current.map((line) => (line === existing ? { ...line, quantity: line.quantity + 1 } : line)));
        return null;
      }
      setLines((current) => [
        ...current,
        { key: `s${service.id}`, type: "service", serviceId: service.id, name: service.name, quantity: 1, unitPrice: service.price, taxRate: 20, serviceNote: "", invoiceNo: "" },
      ]);
      return null;
    },
    custom({ name, price }) {
      setLines((current) => [
        ...current,
        { key: `c${Date.now()}`, type: "custom", name, quantity: 1, unitPrice: price, taxRate: 20, serviceNote: "", invoiceNo: "" },
      ]);
      return null;
    },
  };

  const hasSites = wholesale || lines.some((line) => line.type === "unit" && isEarDevice(line.category));
  const input = { ...sale, kind, patientId: patient?.id, lines };

  async function save() {
    const built = buildSaleArgs(input, { today });
    if (built.error) return setError(built.error);
    setBusy(true);
    setError(null);
    const result = await createSale(input);
    setBusy(false);
    if (!result?.ok) return setError(result?.error ?? "Satış kaydedilemedi.");
    toast(wholesale ? "Toptan satış kaydedildi." : "Satış kaydedildi; hasta geçmişine işlendi.");
    onClose();
  }

  function next() {
    const built = buildSaleArgs(input, { today });
    if (built.error) return setError(built.error);
    setError(null);
    if (hasSites) setStep(2);
    else save();
  }

  const title = wholesale ? "Toptan satış" : `${patient?.name ?? "Hasta"} için hasta işlem`;

  return (
    <Modal open onClose={onClose} eyebrow={wholesale ? "Stok" : "Hasta işlem"} title={title} size="lg">
      <div className="sale-wizard">
        <Stepper steps={STEPS} current={step} />
        {!catalog && !error && <p className="sale-muted" role="status">Yükleniyor…</p>}
        {catalog && step === 0 && (
          <SaleProductStep catalog={catalog} wholesale={wholesale} lines={lines} add={add} onNext={() => { setError(null); setStep(1); }} />
        )}
        {catalog && step === 1 && (
          <SaleCartStep
            catalog={catalog}
            wholesale={wholesale}
            lines={lines}
            setLines={setLines}
            sale={sale}
            setSale={setSale}
            today={today}
            onBack={() => setStep(0)}
            onNext={next}
            nextLabel={hasSites ? "Site işlemlerine geç →" : "✓ Satışı kaydet"}
            busy={busy}
          />
        )}
        {catalog && step === 2 && (
          <SaleSitesStep
            catalog={catalog}
            kind={kind}
            lines={lines}
            setLines={setLines}
            sale={sale}
            setSale={setSale}
            onBack={() => setStep(1)}
            onSave={save}
            busy={busy}
          />
        )}
        {error && <p className="ui-error" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
