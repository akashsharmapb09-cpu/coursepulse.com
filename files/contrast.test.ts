import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Reads the REAL design tokens from globals.css so a palette change that breaks WCAG 2.2 AA fails the build.
const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");
const tokens = new Map<string, string>();
for (const match of css.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6});/g)) {
  const [, name, hex] = match;
  if (name !== undefined && hex !== undefined) tokens.set(name, hex);
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
function ratio(foreground: string, background: string): number {
  const fg = tokens.get(foreground);
  const bg = tokens.get(background);
  if (fg === undefined || bg === undefined) throw new Error(`missing token: ${foreground} / ${background}`);
  return contrast(fg, bg);
}

const TEXT_PAIRS: Array<[string, string]> = [
  ["foreground", "background"], ["foreground", "card"],
  ["muted-foreground", "background"], ["muted-foreground", "card"],
  ["primary", "background"], ["primary", "card"],
  ["secondary", "background"], ["secondary", "card"],
  ["danger", "background"], ["danger", "card"],
  ["success-text", "background"], ["success-text", "card"],
  ["warning-text", "background"], ["warning-text", "card"],
  ["primary-foreground", "primary"], ["secondary-foreground", "secondary"], ["danger-foreground", "danger"],
];
const NON_TEXT_PAIRS: Array<[string, string]> = [
  ["input-border", "card"], ["input-border", "background"],
  ["secondary", "background"], ["secondary", "card"], // focus outline
];

describe("design tokens", () => {
  it("defines the brief's palette", () => {
    expect(tokens.get("background")).toBe("#f8fafc");
    expect(tokens.get("primary")).toBe("#1e3a8a");
    expect(tokens.get("secondary")).toBe("#2563eb");
    expect(tokens.get("success")).toBe("#16a34a");
    expect(tokens.get("warning")).toBe("#f59e0b");
    expect(tokens.get("danger")).toBe("#dc2626");
  });
  it("text pairs meet WCAG AA 4.5:1", () => {
    for (const [fg, bg] of TEXT_PAIRS) expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
  it("UI component and focus colours meet 3:1", () => {
    for (const [fg, bg] of NON_TEXT_PAIRS) expect(ratio(fg, bg)).toBeGreaterThanOrEqual(3);
  });
  it("documents why success and warning must not be used as text (the guard against regressions)", () => {
    expect(ratio("success", "card") < 4.5).toBe(true);
    expect(ratio("warning", "card") < 4.5).toBe(true);
  });
});
