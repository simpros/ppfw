import { describe, expect, test } from "bun:test";
import { expandPath } from "../src/paths.ts";

describe("expandPath", () => {
  test("bare tilde expands to the home directory", () => {
    expect(expandPath("~", "/home/u", "/work")).toBe("/home/u");
  });

  test("leading tilde expands against the home directory", () => {
    expect(expandPath("~/dev", "/home/u", "/work")).toBe("/home/u/dev");
  });

  test("absolute paths pass through", () => {
    expect(expandPath("/abs/path", "/home/u", "/work")).toBe("/abs/path");
  });

  test("relative paths resolve against the working directory", () => {
    expect(expandPath("projects", "/home/u", "/work")).toBe("/work/projects");
  });
});
