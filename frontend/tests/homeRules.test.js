import { describe, expect, it } from "vitest";
import {
  FOLLOW_UPS,
  addDays,
  backupProblem,
  bucketSales,
  bucketVisits,
  chartScale,
  daysBetween,
  formatWelcomeClock,
  isNewPatientVisit,
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

describe("bucketSales", () => {
  const months = lastMonths("2026-11-21");

  it("adds sale values by sale date and takes refunds off by refund date", () => {
    const items = [
      { sale_id: 1, sale_date: "2026-10-05", net_value: "1000.50" },
      { sale_id: 1, sale_date: "2026-10-05", net_value: "200" },
      { sale_id: 2, sale_date: "2026-11-01", net_value: "500" },
      { sale_id: 3, sale_date: "2025-01-01", net_value: "999" },
    ];
    const refunds = [{ refunded_on: "2026-11-10", amount: "200" }];
    const bars = bucketSales(months, items, refunds);
    expect(bars.find((bar) => bar.key === "2026-10")).toMatchObject({ amount: 1200.5, count: 1 });
    expect(bars.find((bar) => bar.key === "2026-11")).toMatchObject({ amount: 300, count: 1 });
    expect(bars.find((bar) => bar.key === "2026-06")).toMatchObject({ amount: 0, count: 0 });
  });
});

describe("new and returning visits", () => {
  const months = lastMonths("2026-11-21");
  const first = new Map([[1, "2026-11-02T10:00:00+00:00"], [2, "2026-10-01T09:00:00+00:00"]]);
  const patients = new Map([
    [1, { registered_on: "2026-11-01", has_past_device: false }],
    [2, { registered_on: "2020-03-01", has_past_device: false }],
  ]);

  it("counts a first visit right after registration as new", () => {
    expect(isNewPatientVisit({ patient_id: 1, starts_at: "2026-11-02T10:00:00+00:00" }, first.get(1), patients.get(1))).toBe(true);
  });

  it("counts a patient registered long before (typed in from before the panel) as returning", () => {
    expect(isNewPatientVisit({ patient_id: 2, starts_at: "2026-10-01T09:00:00+00:00" }, first.get(2), patients.get(2))).toBe(false);
  });

  it("counts a patient with a past device as returning", () => {
    expect(isNewPatientVisit({ patient_id: 1, starts_at: "2026-11-02T10:00:00+00:00" }, first.get(1), { registered_on: "2026-11-01", has_past_device: true })).toBe(false);
  });

  it("splits the months", () => {
    const visits = [
      { patient_id: 1, starts_at: "2026-11-02T10:00:00+00:00" },
      { patient_id: 1, starts_at: "2026-11-20T10:00:00+00:00" },
      { patient_id: 2, starts_at: "2026-10-01T09:00:00+00:00" },
    ];
    const bars = bucketVisits(months, visits, first, patients);
    expect(bars.find((bar) => bar.key === "2026-11")).toMatchObject({ fresh: 1, returning: 1 });
    expect(bars.find((bar) => bar.key === "2026-10")).toMatchObject({ fresh: 0, returning: 1 });
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
  it("counts each patient payment once and sorts by count", () => {
    const methods = [{ code: "cash", name: "Nakit" }, { code: "transfer", name: "Havale/EFT" }];
    const payments = [{ payment_method: "transfer" }, { payment_method: "cash" }, { payment_method: "transfer" }];
    expect(paymentShares(payments, methods)).toEqual([
      { code: "transfer", name: "Havale/EFT", count: 2, percent: 67 },
      { code: "cash", name: "Nakit", count: 1, percent: 33 },
    ]);
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
