import { describe, expect, test } from "bun:test";
import { themeFromEnv } from "../../src/tui/app.ts";
import { DARK_PALETTE, LIGHT_PALETTE, paletteFor } from "../../src/tui/palette.ts";

describe("paletteFor", () => {
  test("light terminals get dark-on-light colors", () => {
    expect(paletteFor("light")).toEqual(LIGHT_PALETTE);
  });

  test("dark and undetected terminals get light-on-dark colors", () => {
    expect(paletteFor("dark")).toEqual(paletteFor(null));
    expect(paletteFor("dark")).toEqual(DARK_PALETTE);
  });
});

describe("themeFromEnv", () => {
  test("white background indices mean light", () => {
    expect(themeFromEnv({ COLORFGBG: "0;15" })).toBe("light");
    expect(themeFromEnv({ COLORFGBG: "0;7" })).toBe("light");
  });

  test("dark background indices mean dark", () => {
    expect(themeFromEnv({ COLORFGBG: "15;0" })).toBe("dark");
    expect(themeFromEnv({ COLORFGBG: "7;8" })).toBe("dark");
  });

  test("three-part COLORFGBG reads the last segment", () => {
    expect(themeFromEnv({ COLORFGBG: "default;default;15" })).toBe("light");
  });

  test("missing or unparseable COLORFGBG means unknown", () => {
    expect(themeFromEnv({})).toBeNull();
    expect(themeFromEnv({ COLORFGBG: "" })).toBeNull();
    expect(themeFromEnv({ COLORFGBG: "default;default" })).toBeNull();
  });
});
