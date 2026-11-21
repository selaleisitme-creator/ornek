import { describe, expect, it } from "vitest";
import {
  FOLLOW_UPS,
  addDays,
  backupProblem,
  chartScale,
  daysBetween,
  fillMonths,
  formatWelcomeClock,
  isSgkInvoiceWindow,
  lastMonths,
  needsFollowUp,
  paymentShares,
  referralIcon,
  warrantyState,
} from "../src/modules/anasayfa/homeRules";

describe("dates", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(daysBetween("2026-11-01", "2026-11-21")).toBe(20);
  });

  it("lists the last six months oldest first, across a year end", () => {
    expect(lastMonths("2026-11-21").map((month) => month.key)).toEqual([
      "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11",
    ]);
    expect(lastMonths("2026-02-03").map((month) => month.label)).toEqual(["Eyl", "Eki", "Kas", "Ara", "Oca", "Şub"]);
  });
});

describe("chartScale", () => {
  it("rounds the top to readable steps", () => {
    expect(chartScale(186054).ticks).toEqual([0, 50000, 100000, 150000, 200000]);
    expect(chartScale(6).ticks).toEqual([0, 1.5, 3, 4.5, 6]);
    expect(chartScale(0).max).toBe(4);
  });
});

describe("paymentShares", () => {
  it("adds whole-number percentages to the database rows", () => {
    const rows = [
      { code: "transfer", name: "Havale/EFT", payments: 2 },
      { code: "cash", name: "Nakit", payments: 1 },
    ];
    expect(paymentShares(rows)).toEqual([
      { code: "transfer", name: "Havale/EFT", count: 2, percent: 67 },
      { code: "cash", name: "Nakit", count: 1, percent: 33 },
    ]);
    expect(paymentShares([])).toEqual([]);
  });
});

describe("fillMonths", () => {
  it("places the database month rows on the chart and fills the gaps with zeros", () => {
    const months = lastMonths("2026-11-21");
    const rows = [{ month: "2026-10-01", amount: "1200.50" }, { month: "2025-01-01", amount: "9" }];
    const bars = fillMonths(months, rows, (row) => ({ value: Number(row.amount) }), { value: 0 });
    expect(bars.map((bar) => bar.value)).toEqual([0, 0, 0, 0, 1200.5, 0]);
    expect(bars[4]).toMatchObject({ key: "2026-10", label: "Eki" });
  });
});

describe("suggestion windows", () => {
  it("opens the SGK invoice window in the last and first seven days", () => {
    expect(isSgkInvoiceWindow("2026-11-07")).toBe(true);
    expect(isSgkInvoiceWindow("2026-11-08")).toBe(false);
    expect(isSgkInvoiceWindow("2026-11-23")).toBe(false);
    expect(isSgkInvoiceWindow("2026-11-24")).toBe(true);
    expect(isSgkInvoiceWindow("2027-02-22")).toBe(true);
  });

  it("lists the first check 6–14 days after the sale unless an appointment covers it", () => {
    expect(needsFollowUp(FOLLOW_UPS.firstCheck, "2026-11-10", "2026-11-18", [])).toBe(true);
    expect(needsFollowUp(FOLLOW_UPS.firstCheck, "2026-11-10", "2026-11-18", ["2026-11-20"])).toBe(false);
    expect(needsFollowUp(FOLLOW_UPS.firstCheck, "2026-11-10", "2026-11-15", [])).toBe(false);
  });

  it("lists the 45-day check 38–52 days after the sale unless days 20–55 hold an appointment", () => {
    expect(needsFollowUp(FOLLOW_UPS.fortyFive, "2026-10-01", "2026-11-10", ["2026-10-05"])).toBe(true);
    expect(needsFollowUp(FOLLOW_UPS.fortyFive, "2026-10-01", "2026-11-10", ["2026-10-25"])).toBe(false);
  });

  it("warns 45 days before the warranty ends and for 60 days after", () => {
    expect(warrantyState("2026-12-30", "2026-11-21")).toEqual({ kind: "ending", days: 39 });
    expect(warrantyState("2026-10-01", "2026-11-21")).toEqual({ kind: "ended", days: 51 });
    expect(warrantyState("2026-08-01", "2026-11-21")).toBeNull();
    expect(warrantyState(null, "2026-11-21")).toBeNull();
  });

  it("explains what is wrong with backups", () => {
    const now = "2026-11-21T12:00:00Z";
    expect(backupProblem({ enabled: false, now })?.title).toMatch(/kapalı/);
    expect(backupProblem({ enabled: true, lastRun: { status: "failed" }, lastSuccessAt: "2026-11-20T00:00:00Z", now })?.title).toMatch(/alınamadı/);
    expect(backupProblem({ enabled: true, lastRun: null, lastSuccessAt: null, now })?.title).toMatch(/İlk/);
    expect(backupProblem({ enabled: true, lastRun: { status: "succeeded" }, lastSuccessAt: "2026-11-10T00:00:00Z", now })?.title).toMatch(/7 günden/);
    expect(backupProblem({ enabled: true, lastRun: { status: "succeeded" }, lastSuccessAt: "2026-11-19T00:00:00Z", now })).toBeNull();
  });
});

describe("display helpers", () => {
  it("writes the welcome clock in Istanbul time", () => {
    expect(formatWelcomeClock(new Date("2026-11-21T09:50:48Z"))).toBe("21 Kasım 2026 Cumartesi · 12:50:48");
  });

  it("picks a mark for known referral sources", () => {
    expect(referralIcon("Instagram")).toEqual({ tone: "instagram", mark: "◎" });
    expect(referralIcon("Web sitesi").tone).toBe("website");
    expect(referralIcon("Komşu").tone).toBe("generic");
  });
});

