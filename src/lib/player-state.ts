import type { TestRecord } from "./types";
export const STORAGE_KEY = "tcf-listening:v1";
export const SPEEDS = [0.75, 1, 1.25, 1.5] as const;
export function clampPosition(position: number, duration: number) { return Number.isFinite(position) && Number.isFinite(duration) ? Math.max(0, Math.min(position, duration)) : 0; }
export function isShortcutTarget(target: EventTarget | null) {
  return typeof Element !== "undefined" && target instanceof Element && Boolean(target.closest('input,textarea,select,[contenteditable="true"],[role="slider"],[role="combobox"],[role="menu"],[role="dialog"]'));
}
export function normalizePreferences(value: unknown, tests: TestRecord[]) {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const test = tests.find(t => t.testNumber === raw.testNumber) ?? tests[0];
  const question = test?.questions.find(q => q.id === raw.questionId) ?? test?.questions[0];
  const validIds = new Set(tests.flatMap(t => t.questions.map(q => q.id)));
  const progress: Record<string, {position: number; played: boolean}> = {};
  if (raw.progress && typeof raw.progress === "object") for (const [id, entry] of Object.entries(raw.progress)) {
    if (!validIds.has(id) || !entry || typeof entry !== "object") continue;
    const p = entry as Record<string, unknown>;
    progress[id] = { position: typeof p.position === "number" && Number.isFinite(p.position) ? Math.max(0, p.position) : 0, played: p.played === true };
  }
  return {testNumber: test?.testNumber ?? 1, questionId: question?.id ?? "", speed: (SPEEDS as readonly unknown[]).includes(raw.speed) ? raw.speed as number : 1, volume: typeof raw.volume === "number" && Number.isFinite(raw.volume) ? Math.max(0, Math.min(1, raw.volume)) : 1, autoPlay: raw.autoPlay === true, progress};
}
