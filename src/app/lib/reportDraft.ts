import { useSyncExternalStore } from "react";
import {
  defaultAccomplishmentReportDraft,
  normalizeAccomplishmentReportDraft,
  type AccomplishmentReportDraft,
  type AccomplishmentReportSeed,
} from "./accomplishmentReportContent";

/**
 * Browser-local store for the editable Chief Commissioner Accomplishment
 * Report.
 *
 * The Chief edits the narrative, objectives, recommendations and signatories on
 * the Reports page; those edits are kept in localStorage (no Supabase table) so
 * they survive a reload, and are versioned per school year so a new election
 * period starts from the bundled COMEA template text again.
 */
const STORAGE_PREFIX = "cnnhs.accomplishment-report-draft.v1";

let snapshot: AccomplishmentReportDraft | null = null;
let snapshotKey = "";
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function storageKey(seed: AccomplishmentReportSeed): string {
  return `${STORAGE_PREFIX}.${seed.periodLabel?.trim() || "default"}`;
}

function readStored(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    // Storage disabled (private mode / blocked cookies) — run from memory.
    return null;
  }
}

function writeStored(key: string, draft: AccomplishmentReportDraft): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Quota or storage disabled — the in-memory draft still works.
  }
}

/**
 * Seed the store on first use.  Idempotent: afterwards it just hands back the
 * cached draft, so a stored (edited) copy always wins over the template.
 */
export function ensureReportDraft(seed: AccomplishmentReportSeed = {}): AccomplishmentReportDraft {
  const key = storageKey(seed);
  if (snapshot && snapshotKey === key) return snapshot;

  const stored = readStored(key);
  snapshot = stored
    ? normalizeAccomplishmentReportDraft(stored, seed)
    : defaultAccomplishmentReportDraft(seed);
  snapshotKey = key;
  writeStored(key, snapshot);
  return snapshot;
}

/**
 * Stable snapshot getter for `useSyncExternalStore`: it must return the same
 * reference between changes, so the template fallback is cached too.
 */
let templateFallback: AccomplishmentReportDraft | null = null;

export function getReportDraft(): AccomplishmentReportDraft {
  if (snapshot) return snapshot;
  templateFallback ??= defaultAccomplishmentReportDraft();
  return templateFallback;
}

/** Replace the whole draft (the editor composes patches from the current one). */
export function setReportDraft(next: AccomplishmentReportDraft): void {
  snapshot = next;
  if (snapshotKey) writeStored(snapshotKey, next);
  emit();
}

/** Discard the edits and restore the bundled template text. */
export function resetReportDraft(seed: AccomplishmentReportSeed = {}): AccomplishmentReportDraft {
  snapshot = defaultAccomplishmentReportDraft(seed);
  snapshotKey = storageKey(seed);
  writeStored(snapshotKey, snapshot);
  emit();
  return snapshot;
}

/**
 * Upgrade a still-pristine draft with late-arriving seed values (e.g. roster
 * officer names that resolve after the page's first render).  The re-seed
 * only happens while the draft is byte-identical to the template built
 * WITHOUT those values — the moment the Chief has edited anything, the stored
 * draft wins and this is a no-op.
 */
export function refreshReportDraftIfPristine(
  seed: AccomplishmentReportSeed = {}
): AccomplishmentReportDraft | null {
  if (!snapshot || !seed.officerNames || Object.keys(seed.officerNames).length === 0) {
    return null;
  }
  const key = storageKey(seed);
  if (snapshotKey !== key) return null;

  const baseSeed = { ...seed, officerNames: undefined };
  if (JSON.stringify(snapshot) !== JSON.stringify(defaultAccomplishmentReportDraft(baseSeed))) {
    return null;
  }

  snapshot = defaultAccomplishmentReportDraft(seed);
  writeStored(key, snapshot);
  emit();
  return snapshot;
}

/** React binding for the editable report draft. */
export function useReportDraft(seed: AccomplishmentReportSeed = {}): AccomplishmentReportDraft {
  ensureReportDraft(seed);
  return useSyncExternalStore(subscribe, getReportDraft, getReportDraft);
}
