import { describe, it, expect, beforeEach, vi } from "vitest";
import { defaultAccomplishmentReportDraft } from "../accomplishmentReportContent";

const STORAGE_PREFIX = "cnnhs.accomplishment-report-draft.v1";
const KEY_2026 = `${STORAGE_PREFIX}.2026-2027`;

/**
 * The store caches its snapshot in module state, so every test gets a fresh
 * module instance (`vi.resetModules`) while localStorage persists.
 */
async function loadStore() {
  vi.resetModules();
  return import("../reportDraft");
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("reportDraft store", () => {
  it("seeds a brand-new draft from the live election values", async () => {
    const store = await loadStore();
    const draft = store.ensureReportDraft({
      periodLabel: "2026-2027",
      chiefName: "JUAN DELA CRUZ",
      dateTime: "January 5, 2026 6:00 AM",
      venue: "CNNHS Gymnasium",
    });

    expect(draft.periodLabel).toBe("2026-2027");
    expect(draft.dateTime).toBe("January 5, 2026 6:00 AM");
    expect(draft.venue).toBe("CNNHS Gymnasium");
    expect(JSON.stringify(draft.signatoryGroups)).toContain("JUAN DELA CRUZ");
    // The seeded draft is remembered for the next visit.
    expect(window.localStorage.getItem(KEY_2026)).toBeTruthy();
  });

  it("is idempotent — ensureReportDraft returns the same snapshot", async () => {
    const store = await loadStore();
    const first = store.ensureReportDraft({ periodLabel: "2026-2027" });
    const second = store.ensureReportDraft({ periodLabel: "2026-2027" });
    expect(second).toBe(first);
  });

  it("keeps the Chief's edits from localStorage on the next visit", async () => {
    const seeded = (await loadStore()).ensureReportDraft({ periodLabel: "2026-2027" });
    window.localStorage.setItem(
      KEY_2026,
      JSON.stringify({ ...seeded, rationaleLead: "EDITED LEAD", financialLiquidation: "PHP 1,500.00" })
    );

    const store = await loadStore();
    const draft = store.ensureReportDraft({ periodLabel: "2026-2027" });
    expect(draft.rationaleLead).toBe("EDITED LEAD");
    expect(draft.financialLiquidation).toBe("PHP 1,500.00");
    // Untouched sections keep the template wording.
    expect(draft.objectives).toEqual(defaultAccomplishmentReportDraft().objectives);
  });

  it("does not overwrite stored edits with a later seed", async () => {
    const seeded = (await loadStore()).ensureReportDraft({ periodLabel: "2026-2027" });
    window.localStorage.setItem(KEY_2026, JSON.stringify({ ...seeded, venue: "EDITED VENUE" }));

    const store = await loadStore();
    // A later render (or a different resolved chief) must not clobber the edit.
    const draft = store.ensureReportDraft({ periodLabel: "2026-2027", chiefName: "SOMEONE ELSE" });
    expect(draft.venue).toBe("EDITED VENUE");
  });

  it("setReportDraft updates the snapshot and persists it", async () => {
    const store = await loadStore();
    const draft = store.ensureReportDraft({ periodLabel: "2026-2027" });
    store.setReportDraft({ ...draft, objectives: ["Custom objective"] });

    expect(store.getReportDraft().objectives).toEqual(["Custom objective"]);
    const stored = JSON.parse(window.localStorage.getItem(KEY_2026) ?? "{}");
    expect(stored.objectives).toEqual(["Custom objective"]);
  });

  it("resetReportDraft restores the bundled template text", async () => {
    const store = await loadStore();
    const draft = store.ensureReportDraft({ periodLabel: "2026-2027" });
    store.setReportDraft({ ...draft, rationaleLead: "Scratch", objectives: ["Scratch"] });

    const reset = store.resetReportDraft({ periodLabel: "2026-2027" });
    expect(reset.rationaleLead).toContain("Accomplishment Report of (COMEA)");
    expect(reset.objectives.length).toBeGreaterThan(1);
    expect(store.getReportDraft()).toEqual(reset);
    expect(JSON.parse(window.localStorage.getItem(KEY_2026) ?? "{}").rationaleLead).toContain(
      "Accomplishment Report of (COMEA)"
    );
  });

  it("versions the draft per school year, so a new period starts fresh", async () => {
    const seeded = (await loadStore()).ensureReportDraft({ periodLabel: "2026-2027" });
    window.localStorage.setItem(KEY_2026, JSON.stringify({ ...seeded, rationaleLead: "OLD YEAR" }));

    const store = await loadStore();
    const draft = store.ensureReportDraft({ periodLabel: "2031-2032" });
    expect(draft.periodLabel).toBe("2031-2032");
    expect(draft.rationaleLead).not.toBe("OLD YEAR");
    expect(window.localStorage.getItem(`${STORAGE_PREFIX}.2031-2032`)).toBeTruthy();
  });

  it("survives a corrupted or unavailable localStorage entry", async () => {
    window.localStorage.setItem(KEY_2026, "{not json");
    const store = await loadStore();
    const draft = store.ensureReportDraft({ periodLabel: "2026-2027" });
    expect(draft.objectives.length).toBeGreaterThan(0);
    expect(draft.periodLabel).toBe("2026-2027");
  });
});
