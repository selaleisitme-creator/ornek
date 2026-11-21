import { Suspense } from "react";
import { io } from "next/cache";
import { getStaffProfile } from "@/lib/auth";
import Skeleton from "@/modules/shared/ui/Skeleton";
import { getHomeView } from "../server/homeService";
import HomeView from "./HomeView";
import WelcomeCard from "./WelcomeCard";
import "./home.css";

// Anasayfa (son.html "Anasayfa", plan 3.7): greeting with a live clock, three charts for the last six
// months, the system suggestions and the referral-source table. All numbers are computed on the server;
// people without the accounting permission get sale counts instead of money totals.
// The numbers take about a second to gather, so they stream in behind <Suspense>: right after login the page
// (greeting and placeholders) shows at once instead of the login screen waiting on "Panel açılıyor…".
export default function HomePage() {
  return (
    <Suspense fallback={<HomeLoading />}>
      <HomeContent />
    </Suspense>
  );
}

async function HomeContent() {
  // The suggestions compare dates with today; under cacheComponents that is request-time work.
  await io();
  const staff = await getStaffProfile();
  const view = await getHomeView({ canSeeMoney: Boolean(staff?.canViewAccounting) });
  return <HomeView view={view} />;
}

function HomeLoading() {
  return (
    <section className="home-page" aria-busy="true">
      <h1 className="ui-visually-hidden">Anasayfa</h1>
      <WelcomeCard />
      <div className="home-charts">
        {["Aylık satış", "Hasta yoğunluğu", "Ödeme şekilleri"].map((title) => (
          <article key={title} className="home-panel home-panel-loading">
            <div className="home-panel-head">
              <h2>{title}</h2>
            </div>
            <Skeleton rows={6} label={`${title} yükleniyor…`} />
          </article>
        ))}
      </div>
    </section>
  );
}
