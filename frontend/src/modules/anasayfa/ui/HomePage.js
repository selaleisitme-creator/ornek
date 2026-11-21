import { io } from "next/cache";
import { getStaffProfile } from "@/lib/auth";
import { getHomeView } from "../server/homeService";
import HomeView from "./HomeView";

// Anasayfa (son.html "Anasayfa", plan 3.7): greeting with a live clock, three charts for the last six
// months, the system suggestions and the referral-source table. All numbers are computed on the server;
// people without the accounting permission get sale counts instead of money totals.
export default async function HomePage() {
  // The suggestions compare dates with today; under cacheComponents that is request-time work.
  await io();
  const staff = await getStaffProfile();
  const view = await getHomeView({ canSeeMoney: Boolean(staff?.canViewAccounting) });
  return <HomeView view={view} />;
}
