"use client";

import { useActionState, useRef, useState } from "react";
import { formatMoneyInput, parseMoney } from "@/lib/money";
import { saveAccounting, removeExpenseTemplate } from "./actions";

function EntryForm({ kind, label, today, methods, categories, templates }) {
  const dialog = useRef(null);
  const templateDialog = useRef(null);
  const deleteDialog = useRef(null);
  const [toDelete, setToDelete] = useState(null);
  const [incomeTemplates, setIncomeTemplates] = useState([]);
  const availableTemplates = kind === "income" ? incomeTemplates : templates;

  function openDialog() {
    if (kind === "income") {
      try {
        const saved = JSON.parse(localStorage.getItem("ornek-income-templates") ?? "[]");
        setIncomeTemplates(Array.isArray(saved) ? saved : []);
      } catch {
        setIncomeTemplates([]);
      }
    }
    dialog.current.showModal();
  }
  const [template, selectTemplate] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  async function deleteTemplate(item) {
    if (!item || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      if (kind === "income") {
        const next = incomeTemplates.filter(({ id }) => id !== item.id);
        localStorage.setItem("ornek-income-templates", JSON.stringify(next));
        setIncomeTemplates(next);
      } else {
        const failure = await removeExpenseTemplate(String(item.id));
        if (failure) { setDeleteError(failure); return; }
      }
    } catch {
      setDeleteError("Şablon silinemedi.");
    } finally {
      deleteDialog.current?.close();
      setDeleting(false);
    }
  }
  const [templateResult, saveTemplate, savingTemplate] = useActionState(async (_, form) => {
    let failure;
    if (kind === "income") {
      const name = String(form.get("name") ?? "").trim();
      const amount = parseMoney(String(form.get("amount") ?? ""));
      if (!name || !amount || amount <= 0 || amount >= 1e10) {
        return { failure: "Şablon adı ve geçerli bir tutar girin." };
      }
      const next = [...incomeTemplates, {
        id: crypto.randomUUID(), name, amount,
        payment_method: form.get("payment"), note: form.get("note"),
      }];
      try {
        localStorage.setItem("ornek-income-templates", JSON.stringify(next));
      } catch {
        return { failure: "Gelir şablonu bu tarayıcıya kaydedilemedi." };
      }
      setIncomeTemplates(next);
    } else {
      failure = await saveAccounting(form);
    }
    if (!failure) templateDialog.current?.close();
    return { failure };
  }, null);
  const selected = availableTemplates.find((item) => String(item.id) === template);
  const [state, submit, pending] = useActionState(async (_, form) => {
    const failure = await saveAccounting(form);
    if (!failure) { selectTemplate(""); dialog.current?.close(); }
    return { failure };
  }, null);

  return <><button type="button" className={`btn${kind === "income" ? " primary" : kind === "expense" ? " danger" : ""}`} onClick={openDialog}>{label}</button><dialog ref={dialog} className="accounting-dialog" aria-label={label}><h2>{kind === "income" ? "Dış gelir ekle" : "Gider ekle"}</h2><p>{kind === "income" ? "Satış dışında elde edilen geliri kaydedin." : "İşletme giderini kaydedin."}</p>
    {<section className="template-box">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <strong>{kind === "income" ? "Gelir şablonları" : "Sabit gider şablonları"}</strong>
        <button className="btn" type="button" style={{ padding: "6px 9px", fontSize: 12 }}
          onClick={() => templateDialog.current.showModal()}>+ Şablon ekle</button>
      </div>
      {availableTemplates.length > 0 && <div tabIndex={availableTemplates.length > 5 ? 0 : undefined}
        role="region" aria-label="Kayıtlı şablonlar"
        style={availableTemplates.length > 5 ? { maxHeight: 210, overflowY: "auto" } : undefined}>
        {availableTemplates.map((item) => <div className="accounting-template" key={item.id}>
          <span style={{ overflowWrap: "anywhere", minWidth: 0 }}>{item.name}</span>
          <div style={{ display: "flex", gap: 6, flexShrink: 0, marginLeft: "auto" }}>
            <button className="btn" type="button" style={{ padding: "6px 9px", fontSize: 12 }}
              onClick={() => selectTemplate(String(item.id))}>Forma aktar</button>
            <button className="btn danger" type="button" style={{ padding: "6px 9px", fontSize: 12 }}
              disabled={deleting} onClick={() => { setToDelete(item); deleteDialog.current.showModal(); }}>Sil</button>
          </div>
        </div>)}
      </div>}
      {deleteError && <p role="alert">{deleteError}</p>}
    </section>}
    <form action={submit} key={template}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="template" value={template} />
      <input type="hidden" name="date" value={today} />
      <label>{kind === "income" ? "Gelir kaynağı / işlem" : "Gider türü"}
        <input name="name" maxLength={100} required defaultValue={selected?.name ?? ""} placeholder={kind === "income" ? "Örn. Diğer gelir" : "Örn. Kargo gideri"} />
      </label>
      {kind !== "category" && <>
        <label>Tutar (TL)<input name="amount" placeholder="0,00" inputMode="decimal" required defaultValue={formatMoneyInput(selected?.amount)} /></label>
        <label>Nakit / KK<select name="payment" required defaultValue={selected?.payment_method || ""}>
          <option value="">Seçin</option>
          {methods.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
        </select></label>
        {kind !== "income" && <label>Gider kategorisi<select name="category" defaultValue={selected?.expense_category_id ?? ""}>
          <option value="">Kategori seçin</option>
          {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>}
        <label>Açıklamalar<textarea name="note" maxLength={500} placeholder="İsteğe bağlı" defaultValue={selected?.note ?? ""} /></label>
      </>}
      <div className="auto-date">İşlem tarihi kaydettiğiniz anda otomatik eklenir.</div>
      <div className="dialog-actions">
        <button className="btn" type="button" onClick={() => dialog.current.close()}>Vazgeç</button>
        <button className="btn primary" disabled={pending}>{pending ? "Kaydediliyor…" : "Kaydet"}</button>
      </div>
    </form>
    {state && <p role="status">{state.failure || "Kaydedildi."}</p>}
  </dialog><dialog ref={templateDialog} className="accounting-dialog" style={{ width: "min(380px, calc(100% - 32px))" }} aria-label="Yeni şablon"><h2>Yeni şablon</h2>      <form action={saveTemplate}>
        <input type="hidden" name="kind" value="template" />
        <label>{kind === "income" ? "Gelir adı" : "Gider adı"}<input name="name" maxLength={100} required placeholder={kind === "income" ? "Örn. Diğer gelir" : "Örn. Kira"} /></label>
        <label>Tutar (TL)<input name="amount" inputMode="decimal" required placeholder="0,00" /></label>
        <label>Ödeme şekli<select name="payment" required defaultValue="">
          <option value="" disabled>Seçin</option>
          {methods.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
        </select></label>
        <label>Açıklama<input name="note" maxLength={250} placeholder="İsteğe bağlı" /></label>
        <div className="dialog-actions">
          <button className="btn" type="button" onClick={() => templateDialog.current.close()}>Vazgeç</button>
          <button className="btn primary" disabled={savingTemplate}>{savingTemplate ? "Kaydediliyor…" : "Şablonu kaydet"}</button>
        </div>
        {templateResult?.failure && <p role="alert">{templateResult.failure}</p>}
      </form>
</dialog>
  <dialog ref={deleteDialog} className="accounting-dialog" aria-label="Şablonu sil"
      style={{ width: "min(360px, calc(100% - 32px))" }}
      onCancel={(event) => { if (deleting) event.preventDefault(); }}>
    <h2>Şablonu sil</h2>
    <p>“{toDelete?.name}” şablonu silinsin mi?</p>
    <div className="dialog-actions">
      <button className="btn" type="button" autoFocus disabled={deleting} onClick={() => deleteDialog.current.close()}>Vazgeç</button>
      <button className="btn danger" type="button" disabled={deleting} onClick={() => deleteTemplate(toDelete)}>{deleting ? "Siliniyor…" : "Sil"}</button>
    </div>
  </dialog></>;
}

export default function AccountingForms(props) {
  return <div className="accounting-forms">
    <EntryForm {...props} kind="income" label="+ Gelir ekle" />
    <EntryForm {...props} kind="expense" label="− Gider ekle" />
  </div>;
}
