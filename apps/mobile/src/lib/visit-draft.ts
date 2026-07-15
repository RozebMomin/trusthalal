import * as SecureStore from "expo-secure-store";
import type {
  CheckResult,
  PlaceSearchResult,
  VisitDisclosure,
} from "@/lib/api/types";

/**
 * On-device draft for the "file a visit" wizard so a verifier can back out
 * (or get interrupted) and pick up where they left off. Best-effort: stored
 * as a single JSON blob and every read/write is wrapped — a failure (e.g.
 * SecureStore's Android size ceiling on a very long note) just means no
 * draft that session, never a crash. Cleared on successful submit.
 */
const KEY = "visit_draft_v1";

export type VisitDraft = {
  step: number;
  selected: PlaceSearchResult | null;
  ordered: string[];
  checks: Record<string, CheckResult>;
  disclosure: VisitDisclosure;
  disclosureNote: string;
  notes: string;
  reviewUrl: string;
  savedAt: string;
};

export const visitDraft = {
  async load(): Promise<VisitDraft | null> {
    try {
      const blob = await SecureStore.getItemAsync(KEY);
      return blob ? (JSON.parse(blob) as VisitDraft) : null;
    } catch {
      return null;
    }
  },
  async save(draft: Omit<VisitDraft, "savedAt">): Promise<void> {
    try {
      await SecureStore.setItemAsync(
        KEY,
        JSON.stringify({ ...draft, savedAt: new Date().toISOString() }),
      );
    } catch {
      // Best-effort — an oversized note or storage hiccup just skips this save.
    }
  },
  async clear(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(KEY);
    } catch {
      // ignore
    }
  },
};
