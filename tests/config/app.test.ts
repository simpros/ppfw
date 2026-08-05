import { describe, expect, test } from "bun:test";
import { ConfigError } from "../../src/errors.ts";
import { parseAppConfig } from "../../src/config/app.ts";

const opts = { dir: "/ws/kido", aliasSuffix: "local" };

describe("parseAppConfig", () => {
  test("bare-number port is forward + derived alias", () => {
    const app = parseAppConfig("ports:\n  frontend: 5173\n", opts);
    expect(app.name).toBe("kido");
    expect(app.dir).toBe("/ws/kido");
    expect(app.remote).toBeNull();
    expect(app.ports).toEqual([
      {
        name: "frontend",
        port: 5173,
        forward: true,
        alias: "frontend.kido.local",
      },
    ]);
  });

  test("app name defaults to directory basename", () => {
    const app = parseAppConfig("ports:\n  a: 1\n", { dir: "/ws/my-app", aliasSuffix: "local" });
    expect(app.name).toBe("my-app");
  });

  test("explicit name overrides directory basename and feeds alias", () => {
    const app = parseAppConfig("name: kido\nports:\n  web: 80\n", {
      dir: "/ws/some-dir",
      aliasSuffix: "local",
    });
    expect(app.name).toBe("kido");
    expect(app.ports[0]!.alias).toBe("web.kido.local");
  });

  test("remote override is captured", () => {
    const app = parseAppConfig("remote: devbox-a\nports:\n  a: 1\n", opts);
    expect(app.remote).toBe("devbox-a");
  });

  test("object entry with port only is forward + derived alias", () => {
    const app = parseAppConfig("ports:\n  api:\n    port: 3232\n", opts);
    expect(app.ports).toEqual([
      { name: "api", port: 3232, forward: true, alias: "api.kido.local" },
    ]);
  });

  test("alias string overrides derivation", () => {
    const app = parseAppConfig(
      "ports:\n  api:\n    port: 3232\n    alias: api-v2.kido.local\n",
      opts,
    );
    expect(app.ports[0]!.alias).toBe("api-v2.kido.local");
    expect(app.ports[0]!.forward).toBe(true);
  });

  test("alias false yields forward-only (no alias)", () => {
    const app = parseAppConfig(
      "ports:\n  db:\n    port: 5432\n    alias: false\n",
      opts,
    );
    expect(app.ports[0]).toEqual({
      name: "db",
      port: 5432,
      forward: true,
      alias: null,
    });
  });

  test("forward false yields standalone alias", () => {
    const app = parseAppConfig(
      "ports:\n  localui:\n    port: 9000\n    forward: false\n",
      opts,
    );
    expect(app.ports[0]).toEqual({
      name: "localui",
      port: 9000,
      forward: false,
      alias: "localui.kido.local",
    });
  });

  test("alias true is treated as derived", () => {
    const app = parseAppConfig(
      "ports:\n  web:\n    port: 80\n    alias: true\n",
      opts,
    );
    expect(app.ports[0]!.alias).toBe("web.kido.local");
  });

  test("spec full example parses", () => {
    const yaml = [
      "name: kido",
      "remote: devbox-a",
      "ports:",
      "  frontend: 5173",
      "  api:",
      "    port: 3232",
      "    alias: api-v2.kido.local",
      "  db:",
      "    port: 5432",
      "    alias: false",
      "  localui:",
      "    port: 9000",
      "    forward: false",
    ].join("\n");
    const app = parseAppConfig(yaml, { dir: "/ws/x", aliasSuffix: "local" });
    expect(app.name).toBe("kido");
    expect(app.remote).toBe("devbox-a");
    expect(app.ports.map((p) => [p.name, p.port, p.forward, p.alias])).toEqual([
      ["frontend", 5173, true, "frontend.kido.local"],
      ["api", 3232, true, "api-v2.kido.local"],
      ["db", 5432, true, null],
      ["localui", 9000, false, "localui.kido.local"],
    ]);
  });

  test("forward false + alias false fails fast", () => {
    expect(() =>
      parseAppConfig("ports:\n  dead:\n    port: 1\n    forward: false\n    alias: false\n", opts),
    ).toThrow(/dead/);
    expect(() =>
      parseAppConfig("ports:\n  dead:\n    port: 1\n    forward: false\n    alias: false\n", opts),
    ).toThrow(ConfigError);
  });

  test("missing ports fails fast", () => {
    expect(() => parseAppConfig("name: kido\n", opts)).toThrow(/ports/);
  });

  test("empty ports fails fast", () => {
    expect(() => parseAppConfig("ports: {}\n", opts)).toThrow(/ports/);
  });

  test("object entry missing port fails fast", () => {
    expect(() => parseAppConfig("ports:\n  api:\n    alias: false\n", opts)).toThrow(
      /api/,
    );
  });

  test("non-integer port fails fast", () => {
    expect(() => parseAppConfig("ports:\n  api: 32.5\n", opts)).toThrow(/api/);
    expect(() => parseAppConfig("ports:\n  api: abc\n", opts)).toThrow(/api/);
  });

  test("out-of-range port fails fast", () => {
    expect(() => parseAppConfig("ports:\n  api: 0\n", opts)).toThrow(/api/);
    expect(() => parseAppConfig("ports:\n  api: 70000\n", opts)).toThrow(/api/);
    expect(() => parseAppConfig("ports:\n  api: -1\n", opts)).toThrow(/api/);
  });

  test("invalid YAML fails fast", () => {
    expect(() => parseAppConfig("ports: [unclosed", opts)).toThrow(ConfigError);
  });

  test("non-mapping document fails fast", () => {
    expect(() => parseAppConfig("- a\n- b\n", opts)).toThrow(ConfigError);
  });

  test("unknown port-entry key fails fast", () => {
    expect(() =>
      parseAppConfig("ports:\n  api:\n    port: 1\n    prot: 2\n", opts),
    ).toThrow(/prot|unknown/i);
  });

  test("unknown top-level key fails fast", () => {
    expect(() => parseAppConfig("ports:\n  a: 1\nremot: devbox\n", opts)).toThrow(
      /remot|unknown/i,
    );
  });
});
