import { redirect } from "next/navigation";
import { getStaffProfile } from "@/lib/auth";
import PagePlaceholder from "@/modules/shared/ui/PagePlaceholder";

// Without the accounting permission (interns never have it) the page does not exist for the user:
// typing the address sends them home. The ledger tables are closed by RLS as well.
export default async function AccountingPage() {
  const staff = await getStaffProfile();
  if (!staff?.canViewAccounting) redirect("/anasayfa");

  return <PagePlaceholder title="Muhasebe" description="Kasa defteri, gelir ve gider kayıtları, sabit gider şablonları." />;
}
