import { Suspense } from "react";
import { io } from "next/cache";
import { todayInClinic } from "@/lib/dates";
import { getScreenData } from "../server/appointmentsService";
import AppointmentsClient from "./AppointmentsClient";

export default function AppointmentsPage() {
  return (
    <Suspense fallback={<div className="ui-skeleton" aria-label="Randevular yükleniyor"><div className="ui-skeleton-row" /><div className="ui-skeleton-row" /></div>}>
      <AppointmentsContent />
    </Suspense>
  );
}

async function AppointmentsContent() {
  await io();
  const now = new Date();
  const today = todayInClinic(now);
  const data = await getScreenData(today.slice(0, 7));
  return <AppointmentsClient initialData={data} today={today} initialNow={now.getTime()} />;
}
