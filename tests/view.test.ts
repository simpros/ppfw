import { describe, expect, test } from "bun:test";
import type { AppConfig } from "../src/config/app.ts";
import { buildView } from "../src/view.ts";

const kido: AppConfig = {
  name: "kido",
  dir: "/ws/kido",
  remote: "devbox-a",
  ports: [
    { name: "frontend", port: 5173, forward: true, alias: "frontend.kido.local" },
    { name: "api", port: 3232, forward: true, alias: "api-v2.kido.local" },
    { name: "db", port: 5432, forward: true, alias: null },
    { name: "localui", port: 9000, forward: false, alias: "localui.kido.local" },
  ],
};

const backend: AppConfig = {
  name: "backend",
  dir: "/ws/backend",
  remote: null,
  ports: [{ name: "worker", port: 8080, forward: true, alias: "worker.backend.local" }],
};

function view(collapsed: ReadonlySet<string> = new Set()) {
  return buildView({ workspaceRoot: "/ws", apps: [kido, backend], collapsed });
}

describe("buildView", () => {
  test("header shows workspace, proxy status, and counts", () => {
    const v = view();
    expect(v.header.left).toBe("ppfw  workspace /ws  proxy ○ down");
    expect(v.header.counts).toBe("2 apps · 5 ports · 0 up");
  });

  test("apps render as groups in the given order", () => {
    const v = view();
    expect(v.groups.map((g) => g.name)).toEqual(["kido", "backend"]);
    expect(v.groups.map((g) => g.dir)).toEqual(["/ws/kido", "/ws/backend"]);
  });

  test("expanded group shows a stopped row per named port", () => {
    const group = view().groups[0]!;
    expect(group.collapsedGlyph).toBe("▼");
    expect(group.remoteLabel).toBe("remote devbox-a");
    expect(group.rows).toEqual([
      { state: "○ stop", name: "frontend", port: ":5173", alias: "→  frontend.kido.local", note: "", standalone: false },
      { state: "○ stop", name: "api", port: ":3232", alias: "→  api-v2.kido.local", note: "", standalone: false },
      { state: "○ stop", name: "db", port: ":5432", alias: "(no alias)", note: "", standalone: false },
      { state: "◆ alias", name: "localui", port: ":9000", alias: "→  localui.kido.local", note: "standalone · no forward", standalone: true },
    ]);
  });

  test("app without remote override shows the default remote", () => {
    const group = view().groups[1]!;
    expect(group.remoteLabel).toBe("remote (default)");
  });

  test("default remote applies to apps without an override", () => {
    const v = buildView({
      workspaceRoot: "/ws",
      apps: [kido, backend],
      collapsed: new Set(),
      defaultRemote: "devbox",
    });
    expect(v.groups[0]!.remoteLabel).toBe("remote devbox-a");
    expect(v.groups[1]!.remoteLabel).toBe("remote devbox");
  });

  test("collapsed group hides its rows", () => {
    const group = view(new Set(["/ws/kido"])).groups[0]!;
    expect(group.collapsedGlyph).toBe("▶");
    expect(group.rows).toEqual([]);
  });

  test("collapse is keyed by directory, not name", () => {
    const v = buildView({
      workspaceRoot: "/ws",
      apps: [kido, { ...backend, name: "kido" }],
      collapsed: new Set(["/ws/kido"]),
    });
    expect(v.groups[0]!.collapsedGlyph).toBe("▶");
    expect(v.groups[1]!.collapsedGlyph).toBe("▼");
  });

  test("empty workspace still renders header and footer", () => {
    const v = buildView({ workspaceRoot: "/ws", apps: [], collapsed: new Set() });
    expect(v.header.counts).toBe("0 apps · 0 ports · 0 up");
    expect(v.groups).toEqual([]);
    expect(v.footer.keys.length).toBeGreaterThan(0);
  });

  test("footer lists the keybindings", () => {
    expect(view().footer.keys).toContain("q quit");
  });
});
