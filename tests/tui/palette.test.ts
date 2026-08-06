import { describe, expect, test } from "bun:test";
import { paletteFor, themeFromEnv } from "../../src/tui/app.ts";

describe("paletteFor", () => {
  test("light terminals get dark-on-light colors", () => {
    expect(paletteFor("light")).toEqual({
      fg: "#1a1a1a",
      dim: "#5f5f5f",
      accent: "#005f87",
      selected: "#af5f00",
      danger: "#af0000",
    });
  });

  test("dark and undetected terminals get light-on-dark colors", () => {
    expect(paletteFor("dark")).toEqual(paletteFor(null));
    expect(paletteFor("dark")).toEqual({
      fg: "#e4e4e4",
      dim: "#8a8a8a",
      accent: "#5fd7ff",
      selected: "#ffd75f",
      danger: "#ff5f5f",
    });
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
