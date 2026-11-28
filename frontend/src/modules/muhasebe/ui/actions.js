"use server";

import { revalidatePath } from "next/cache";
import { getStaffProfile } from "@/lib/auth";
import { parseMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export async function saveAccounting(form) {
  if (!(await getStaffProfile())?.canViewAccounting) return "Muhasebe erişimi gerekli.";
  const db = await createClient();
  const field = (key) => String(form.get(key) ?? "").trim();
  const kind = field("kind");
  const name = field("name");
  const amount = parseMoney(field("amount"));
  const payment_method = field("payment");
  const expense_category_id = field("category") || null;
  const note = field("note") || null;
  let result;

  if (kind === "category") {
    if (!name || name.length > 100) return "Geçerli bir kategori adı girin.";
    result = await db.from("expense_categories").insert({ name });
  } else if (kind === "template" || kind === "expense" || kind === "income") {
    if (!amount || amount <= 0 || amount >= 1e10 || !payment_method) {
      return "Pozitif tutar ve ödeme yöntemi girin.";
    }
    if (kind === "template") {
      if (!name || name.length > 100) return "Geçerli bir şablon adı girin.";
      result = await db.from("expense_templates").insert({
        name, amount, payment_method, expense_category_id, note,
      });
    } else {
      const entry_date = field("date");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry_date)) return "Geçerli bir tarih seçin.";
      result = await db.from("cash_entries").insert({
        direction: kind,
        entry_date,
        amount,
        payment_method,
        expense_category_id: kind === "expense" ? expense_category_id : null,
        template_id: kind === "expense" ? field("template") || null : null,
        counterparty_name: name || null,
        description: note,
      });
    }
  } else {
    return "Geçersiz işlem.";
  }
  if (result.error?.code === "23505") return "Bu ad zaten kayıtlı.";
  if (result.error) return "Kayıt yapılamadı. Bilgileri kontrol edip yeniden deneyin.";
  revalidatePath("/muhasebe");
  return null;
}

export async function removeExpenseTemplate(id) {
  if (!(await getStaffProfile())?.canViewAccounting) return "Muhasebe erişimi gerekli.";
  if (typeof id !== "string" || !/^[1-9]\d{0,18}$/.test(id)) return "Geçersiz şablon.";
  const db = await createClient();
  const { error } = await db.from("expense_templates").update({ active: false }).eq("id", id);
  if (error) return "Şablon silinemedi.";
  revalidatePath("/muhasebe");
  return null;
}