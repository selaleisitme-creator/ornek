import Link from "next/link";
import { Suspense } from "react";
import { io } from "next/cache";
import { getStaffProfile } from "@/lib/auth";
import EmptyState from "@/modules/shared/ui/EmptyState";
import Skeleton from "@/modules/shared/ui/Skeleton";
import { getPatientCard, getPatientList } from "../server/patientsService";
import { patientsHref, readPatientQuery } from "../patientRules";
import PatientsToolbar from "./PatientsToolbar";
import PatientList from "./PatientList";
import PatientCard from "./PatientCard";
import "./patients.css";

// Hastalar (Selale_Prototip_Model_2 "Hastalar"): the patient list with search, the four filter buttons and a
// table/card switch, and the patient card. Everything that changes the view lives in the address bar
// (?sekme, ?ara, ?gorunum, ?ac), so a refresh or a shared link shows the same thing; the home page opens a
// card with /hastalar?ac=<id>.
export default function PatientsPage({ searchParams }) {
  return (
    <section className="patients-page">
      <Suspense fallback={<PatientsLoading />}>
        <PatientsContent searchParams={searchParams} />
      </Suspense>
    </section>
  );
}

async function PatientsContent({ searchParams }) {
  // Adaptation days compare with today; under cacheComponents reading the clock is request-time work.
  await io();
  const query = readPatientQuery(await searchParams);

  if (query.ac) {
    const staff = await getStaffProfile();
    const card = await getPatientCard(query.ac, staff);
    if (!card) {
      return (
        <EmptyState
          title="Hasta kaydı bulunamadı"
          description="Kayıt silinmiş ya da bağlantı hatalı olabilir."
          action={
            <Link className="ui-button ui-button-primary" href={patientsHref(query, { ac: null })}>
              Hasta listesine dön
            </Link>
          }
        />
      );
    }
    return <PatientCard card={card} backHref={patientsHref(query, { ac: null })} />;
  }

  const list = await getPatientList(query);
  return (
    <>
      <h1 className="ui-visually-hidden">Hastalar</h1>
      <PatientsToolbar query={query} counts={list.counts} referralSources={list.referralSources} />
      <PatientList query={query} list={list} />
    </>
  );
}

function PatientsLoading() {
  return (
    <>
      <h1 className="ui-visually-hidden">Hastalar</h1>
      <Skeleton rows={6} label="Hastalar yükleniyor…" />
    </>
  );
}
