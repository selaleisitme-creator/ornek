"use client";

import { useSyncExternalStore } from "react";
import { formatWelcomeClock } from "../homeRules";

// Greeting card with the live date and time. The clock is drawn only in the browser (plan 3.7): the server
// snapshot is empty, so the page never carries the server's time and hydration never disagrees.
// One timer for the page, aligned to the next whole second, instead of the design's two.
let clockText = "";
const listeners = new Set();
let timer = null;

function tick() {
  clockText = formatWelcomeClock(new Date());
  listeners.forEach((listener) => listener());
  timer = setTimeout(tick, 1000 - (Date.now() % 1000));
}

function subscribe(listener) {
  listeners.add(listener);
  if (!timer) tick();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

export default function WelcomeCard() {
  const clock = useSyncExternalStore(subscribe, () => clockText, () => "");

  return (
    <section className="home-welcome" aria-labelledby="home-welcome-title">
      <div className="home-welcome-content">
        <h2 id="home-welcome-title">Şelale İşitme’de her gün yeni bir başlangıç</h2>
        <p>Doğru cihaz, doğru programlama ve özenli takip, hastalarımızın yaşam kalitesine katkı sağlar.</p>
        <p className="home-welcome-time" aria-live="off">{clock || " "}</p>
      </div>
      <span className="home-welcome-tag">İşitme sağlığı · Hasta odaklı bakım</span>
    </section>
  );
}
