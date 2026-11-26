import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("frontend theme and localization", () => {
  it("defines both Silk White light and Obsidian dark theme tokens", () => {
    const css = readFileSync(resolve(import.meta.dirname, "../src/index.css"), "utf8");
    expect(css).toContain('[data-theme="light"]');
    expect(css).toContain('[data-theme="dark"]');
    expect(css).toContain("#ffffff");
    expect(css).toContain("--shadow-md");
  });

  it("provides matching English and Tamil locale keys", () => {
    const en = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../src/locales/en.json"), "utf8")
    ) as Record<string, unknown>;
    const ta = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../src/locales/ta.json"), "utf8")
    ) as Record<string, unknown>;
    expect(Object.keys(en)).toEqual(Object.keys(ta));
  });
});
