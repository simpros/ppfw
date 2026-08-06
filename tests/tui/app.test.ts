import { beforeEach, describe, expect, test } from "bun:test";
import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing";
import type { AppConfig } from "../../src/config/app.ts";
import { forwardKey, type ForwardStatus } from "../../src/forward.ts";
import type { ProxyStatus } from "../../src/proxy.ts";
import type { Runtime } from "../../src/runtime.ts";
import { runTuiWith } from "../../src/tui/app.ts";

const kido: AppConfig = {
  name: "kido",
  dir: "/ws/kido",
  remote: "devbox-a",
  ports: [
    { name: "frontend", port: 5173, forward: true, alias: "frontend.kido.local" },
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

interface FakeRuntime extends Runtime {
  calls: string[];
  setApps(apps: AppConfig[]): void;
  setStatuses(statuses: Map<string, ForwardStatus>): void;
  setRescanError(error: string | null): void;
  notify(): void;
}

function fakeRuntime(apps: AppConfig[]): FakeRuntime {
  const calls: string[] = [];
  let current = apps;
  let statuses = new Map<string, ForwardStatus>();
  let rescanError: string | null = null;
  const listeners = new Set<() => void>();
  const runtime: FakeRuntime = {
    calls,
    start: async () => {},
    stop: async () => {},
    apps: () => current,
    startForward: async (dir, port) => {
      calls.push(`startForward ${dir} ${port}`);
    },
    stopForward: async (dir, port) => {
      calls.push(`stopForward ${dir} ${port}`);
    },
    restartForward: async (dir, port) => {
      calls.push(`restartForward ${dir} ${port}`);
    },
    startApp: async (dir) => {
      calls.push(`startApp ${dir}`);
    },
    stopApp: async (dir) => {
      calls.push(`stopApp ${dir}`);
    },
    startAll: async () => {
      calls.push("startAll");
    },
    stopAll: async () => {
      calls.push("stopAll");
    },
    rescan: async () => {
      calls.push("rescan");
    },
    rescanError: () => rescanError,
    statuses: () => statuses,
    proxyStatus: (): ProxyStatus => ({ phase: "up", lastError: null }),
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setApps: (apps) => {
      current = apps;
    },
    setStatuses: (next) => {
      statuses = next;
    },
    setRescanError: (error) => {
      rescanError = error;
    },
    notify: () => {
      for (const listener of listeners) listener();
    },
  };
  return runtime;
}

let setup: TestRendererSetup;
let runtime: FakeRuntime;
let done: Promise<void>;

beforeEach(async () => {
  setup = await createTestRenderer({ width: 132, height: 24 });
  runtime = fakeRuntime([kido, backend]);
  done = runTuiWith(
    setup.renderer,
    { workspaceRoot: "/ws", defaultRemote: "devbox", runtime },
    null,
  );
  await setup.flush();
});

async function quit(): Promise<void> {
  setup.mockInput.pressKey("q");
  await done;
}

describe("runTui control surface", () => {
  test("renders all five states with inline reasons", async () => {
    runtime.setStatuses(
      new Map<string, ForwardStatus>([
        [forwardKey("/ws/kido", "frontend"), { phase: "up" }],
        [
          forwardKey("/ws/kido", "db"),
          { phase: "reconnecting", note: "Connection reset by peer", backoffMs: 4000 },
        ],
        [
          forwardKey("/ws/backend", "worker"),
          { phase: "error", note: "auth failed · Permission denied (publickey)" },
        ],
      ]),
    );
    runtime.notify();
    const frame = await setup.waitForFrame((candidate) => candidate.includes("✗ err"));
    expect(frame).toContain("kido");
    expect(frame).toContain("backend");
    expect(frame).toContain("● up");
    expect(frame).toContain("◐ recon");
    expect(frame).toContain("backoff 4s · Connection reset by peer");
    expect(frame).toContain("✗ err");
    expect(frame).toContain("auth failed · Permission denied (publickey)");
    expect(frame).toContain("◆ alias");
    expect(frame).toContain("standalone · no forward");
    expect(frame).toContain(". rescan");
    await quit();
  });

  test("a stopped forward renders with the stopped glyph", async () => {
    const frame = setup.captureCharFrame();
    expect(frame).toContain("○ stop");
    await quit();
  });

  test("row keys start, stop, and restart the selected forward", async () => {
    setup.mockInput.pressKey("j");
    setup.mockInput.pressKey("s");
    setup.mockInput.pressKey("x");
    setup.mockInput.pressKey("r");
    await setup.flush();
    expect(runtime.calls).toEqual([
      "startForward /ws/kido frontend",
      "stopForward /ws/kido frontend",
      "restartForward /ws/kido frontend",
    ]);
    await quit();
  });

  test("row keys are inert on a group header", async () => {
    setup.mockInput.pressKey("s");
    setup.mockInput.pressKey("x");
    setup.mockInput.pressKey("r");
    await setup.flush();
    expect(runtime.calls).toEqual([]);
    await quit();
  });

  test("shift S/X act on the app of the selected group", async () => {
    setup.mockInput.pressKey("s", { shift: true });
    setup.mockInput.pressKey("x", { shift: true });
    await setup.flush();
    expect(runtime.calls).toEqual(["startApp /ws/kido", "stopApp /ws/kido"]);
    await quit();
  });

  test("shift S/X act on the app of the selected row", async () => {
    setup.mockInput.pressKey("j");
    setup.mockInput.pressKey("s", { shift: true });
    setup.mockInput.pressKey("x", { shift: true });
    await setup.flush();
    expect(runtime.calls).toEqual(["startApp /ws/kido", "stopApp /ws/kido"]);
    await quit();
  });

  test("a starts all and shift Z stops all", async () => {
    setup.mockInput.pressKey("a");
    setup.mockInput.pressKey("z");
    setup.mockInput.pressKey("z", { shift: true });
    await setup.flush();
    expect(runtime.calls).toEqual(["startAll", "stopAll"]);
    await quit();
  });

  test(". rescans the workspace", async () => {
    setup.mockInput.pressKey(".");
    await setup.flush();
    expect(runtime.calls).toEqual(["rescan"]);
    await quit();
  });

  test("a rescan error renders in the header", async () => {
    runtime.setRescanError("/ws/broken/.ppfw.config: `ports` is required");
    runtime.notify();
    const frame = await setup.waitForFrame((candidate) =>
      candidate.includes("rescan failed"),
    );
    expect(frame).toContain("rescan failed");
    await quit();
  });

  test("rescanned apps are rendered", async () => {
    runtime.setApps([
      kido,
      backend,
      {
        name: "api",
        dir: "/ws/api",
        remote: null,
        ports: [{ name: "svc", port: 9001, forward: true, alias: null }],
      },
    ]);
    runtime.notify();
    const frame = await setup.waitForFrame((candidate) => candidate.includes("api"));
    expect(frame).toContain("svc");
    await quit();
  });

  test("q quits the TUI", async () => {
    await quit();
    expect(runtime.calls).toEqual([]);
  });
});
