import { Suspense } from "react";
import { io } from "next/cache";
import Skeleton from "@/modules/shared/ui/Skeleton";
import { listLinks } from "../server/linksService";
import LinksBoard from "./LinksBoard";
import "./links.css";

// Bağlantılar (son.html "Bağlantılar", plan 3.5): tiles of the sites the clinic uses every day. A tile with an
// address opens the site in a new tab; one without opens the edit window so the address can be added.
export default function LinksPage() {
  return (
    <section className="links-page">
      <Suspense fallback={<LinksLoading />}>
        <LinksContent />
      </Suspense>
    </section>
  );
}

async function LinksContent() {
  // The Supabase session check reads the clock; under cacheComponents that is request-time work.
  await io();
  const links = await listLinks();
  return <LinksBoard links={links} />;
}

function LinksLoading() {
  return (
    <>
      <header className="links-head">
        <div>
          <h1>Bağlantılar</h1>
          <p>Başlığa tıklayın, ilgili site tarayıcıda açılsın.</p>
        </div>
      </header>
      <Skeleton rows={4} label="Bağlantılar yükleniyor…" />
    </>
  );
}
