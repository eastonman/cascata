import { expect, test } from "bun:test";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, SETTINGS_KEY } from "./settings";

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

test("returns defaults when nothing is stored", () => {
  expect(loadSettings(memoryStorage())).toEqual(DEFAULT_SETTINGS);
});

test("round-trips a saved settings object", () => {
  const storage = memoryStorage();
  const s = { ...DEFAULT_SETTINGS, fftSize: 8192 as const, a4: 442, colormap: "viridis" as const };
  saveSettings(s, storage);
  expect(loadSettings(storage)).toEqual(s);
});

test("falls back to defaults on malformed JSON", () => {
  expect(loadSettings(memoryStorage({ [SETTINGS_KEY]: "{not json" }))).toEqual(DEFAULT_SETTINGS);
});

test("falls back to defaults when the stored value is not an object", () => {
  expect(loadSettings(memoryStorage({ [SETTINGS_KEY]: "42" }))).toEqual(DEFAULT_SETTINGS);
  expect(loadSettings(memoryStorage({ [SETTINGS_KEY]: "null" }))).toEqual(DEFAULT_SETTINGS);
});

test("repairs individual invalid fields, keeping valid ones", () => {
  const stored = JSON.stringify({ fftSize: 12345, a4: 442, colormap: "chartreuse", timeZoom: 2 });
  const loaded = loadSettings(memoryStorage({ [SETTINGS_KEY]: stored }));
  expect(loaded.fftSize).toBe(DEFAULT_SETTINGS.fftSize);
  expect(loaded.colormap).toBe(DEFAULT_SETTINGS.colormap);
  expect(loaded.a4).toBe(442);
  expect(loaded.timeZoom).toBe(2);
});

test("clamps out-of-range dB settings", () => {
  const stored = JSON.stringify({ dbFloor: -900, dbRange: 0 });
  const loaded = loadSettings(memoryStorage({ [SETTINGS_KEY]: stored }));
  expect(loaded.dbFloor).toBeGreaterThanOrEqual(-127);
  expect(loaded.dbRange).toBeGreaterThan(0);
});

test("coerces a non-boolean pitchEnabled to the default", () => {
  const stored = JSON.stringify({ pitchEnabled: "yes" });
  const loaded = loadSettings(memoryStorage({ [SETTINGS_KEY]: stored }));
  expect(loaded.pitchEnabled).toBe(DEFAULT_SETTINGS.pitchEnabled);
});

test("loading does not throw when storage rejects reads", () => {
  const hostile = {
    ...memoryStorage(),
    getItem: () => {
      throw new Error("blocked");
    },
  } as Storage;
  expect(loadSettings(hostile)).toEqual(DEFAULT_SETTINGS);
});

test("saving does not throw when storage rejects writes", () => {
  const hostile = {
    ...memoryStorage(),
    setItem: () => {
      throw new Error("quota");
    },
  } as Storage;
  expect(() => saveSettings(DEFAULT_SETTINGS, hostile)).not.toThrow();
});
