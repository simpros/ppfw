import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError } from "../../src/errors.ts";
import {
  DEFAULT_ALIAS_SUFFIX,
  globalConfigDir,
  loadGlobalConfig,
} from "../../src/config/global.ts";

async function configDirWith(content: string | null): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ppfw-config-"));
  if (content !== null) {
    await writeFile(join(dir, "config.yaml"), content, "utf8");
  }
  return dir;
}

describe("globalConfigDir", () => {
  test("honors $XDG_CONFIG_HOME", () => {
    expect(globalConfigDir({ XDG_CONFIG_HOME: "/xdg" }, "/home/u")).toBe("/xdg/ppfw");
  });

  test("falls back to ~/.config", () => {
    expect(globalConfigDir({}, "/home/u")).toBe("/home/u/.config/ppfw");
  });

  test("ignores empty $XDG_CONFIG_HOME", () => {
    expect(globalConfigDir({ XDG_CONFIG_HOME: "" }, "/home/u")).toBe(
      "/home/u/.config/ppfw",
    );
  });
});

describe("loadGlobalConfig", () => {
  test("missing file yields all defaults", async () => {
    const configDir = await configDirWith(null);
    const config = loadGlobalConfig({ configDir, cwd: "/work" });
    expect(config).toEqual({
      workspace: "/work",
      defaultRemote: null,
      aliasSuffix: DEFAULT_ALIAS_SUFFIX,
    });
  });

  test("parses all three settings", async () => {
    const configDir = await configDirWith(
      [
        "workspace: ~/dev",
        "default_remote: devbox",
        "alias_suffix: example.test",
      ].join("\n"),
    );
    const config = loadGlobalConfig({
      configDir,
      cwd: "/work",
      homeDir: "/home/u",
    });
    expect(config).toEqual({
      workspace: "/home/u/dev",
      defaultRemote: "devbox",
      aliasSuffix: "example.test",
    });
  });

  test("relative workspace resolves against cwd", async () => {
    const configDir = await configDirWith("workspace: projects");
    const config = loadGlobalConfig({ configDir, cwd: "/work" });
    expect(config.workspace).toBe("/work/projects");
  });

  test("partial file leaves other settings at defaults", async () => {
    const configDir = await configDirWith("default_remote: devbox-a\n");
    const config = loadGlobalConfig({ configDir, cwd: "/work" });
    expect(config).toEqual({
      workspace: "/work",
      defaultRemote: "devbox-a",
      aliasSuffix: DEFAULT_ALIAS_SUFFIX,
    });
  });

  test("unknown keys are ignored", async () => {
    const configDir = await configDirWith("future_knob: on\nalias_suffix: s.test\n");
    const config = loadGlobalConfig({ configDir, cwd: "/work" });
    expect(config.aliasSuffix).toBe("s.test");
  });

  test("empty file yields all defaults", async () => {
    const configDir = await configDirWith("");
    const config = loadGlobalConfig({ configDir, cwd: "/work" });
    expect(config.workspace).toBe("/work");
  });

  test("invalid YAML fails fast naming the file", async () => {
    const configDir = await configDirWith("workspace: [unclosed");
    expect(() => loadGlobalConfig({ configDir, cwd: "/work" })).toThrow(
      new RegExp(`config\\.yaml`),
    );
    expect(() => loadGlobalConfig({ configDir, cwd: "/work" })).toThrow(ConfigError);
  });

  test("wrong-typed workspace fails fast naming the key", async () => {
    const configDir = await configDirWith("workspace: 42");
    expect(() => loadGlobalConfig({ configDir, cwd: "/work" })).toThrow(/workspace/);
  });

  test("wrong-typed default_remote fails fast", async () => {
    const configDir = await configDirWith("default_remote: [a, b]");
    expect(() => loadGlobalConfig({ configDir, cwd: "/work" })).toThrow(
      /default_remote/,
    );
  });

  test("non-mapping document fails fast", async () => {
    const configDir = await configDirWith("- just\n- a list\n");
    expect(() => loadGlobalConfig({ configDir, cwd: "/work" })).toThrow(ConfigError);
  });
});
