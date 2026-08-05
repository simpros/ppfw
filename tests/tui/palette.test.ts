import { describe, expect, test } from "bun:test";
import { paletteFor } from "../../src/tui/app.ts";

describe("paletteFor", () => {
  test("light terminals get dark-on-light colors", () => {
    expect(paletteFor("light")).toEqual({
      dim: "#5f5f5f",
      accent: "#005f87",
      selected: "#af5f00",
    });
  });

  test("dark and undetected terminals get light-on-dark colors", () => {
    expect(paletteFor("dark")).toEqual(paletteFor(null));
    expect(paletteFor("dark")).toEqual({
      dim: "#8a8a8a",
      accent: "#5fd7ff",
      selected: "#ffd75f",
    });
  });
});
