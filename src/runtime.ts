import type { AppConfig } from "./config/app.ts";
import { messageOf } from "./errors.ts";
import type { ForwardStatus } from "./forward.ts";
import { routesForApps, type ProxyRoute, type ProxyStatus } from "./proxy.ts";
import type { Workspace } from "./workspace.ts";

export interface Runtime {
  start(): Promise<void>;
  stop(): Promise<void>;
  apps(): AppConfig[];
  startForward(appDir: string, portName: string): Promise<void>;
  stopForward(appDir: string, portName: string): Promise<void>;
  restartForward(appDir: string, portName: string): Promise<void>;
  startApp(appDir: string): Promise<void>;
  stopApp(appDir: string): Promise<void>;
  startAll(): Promise<void>;
  stopAll(): Promise<void>;
  /** Re-read the workspace without quitting; keeps the old state on error. */
  rescan(): Promise<void>;
  rescanError(): string | null;
  statuses(): ReadonlyMap<string, ForwardStatus>;
  proxyStatus(): ProxyStatus;
  onChange(listener: () => void): () => void;
}

export interface RuntimeEngine {
  start(appDir: string, portName: string): Promise<void>;
  stop(appDir: string, portName: string): Promise<void>;
  restart(appDir: string, portName: string): Promise<void>;
  startApp(appDir: string): Promise<void>;
  stopApp(appDir: string): Promise<void>;
  startAll(): Promise<void>;
  stopAll(): Promise<void>;
  setApps(apps: AppConfig[]): Promise<void>;
  statuses(): ReadonlyMap<string, ForwardStatus>;
  onChange(listener: () => void): () => void;
}

export interface RuntimeProxy {
  start(): Promise<void>;
  stop(): Promise<void>;
  setRoutes(routes: ProxyRoute[]): Promise<void>;
  status(): ProxyStatus;
  onChange(listener: () => void): () => void;
}

export interface RuntimeOptions {
  engine: RuntimeEngine;
  proxy: RuntimeProxy;
  workspace: Workspace;
  apps: AppConfig[];
}

export function createRuntime(options: RuntimeOptions): Runtime {
  const { engine, proxy, workspace } = options;
  const listeners = new Set<() => void>();
  const unsubscribeEngine = engine.onChange(emit);
  const unsubscribeProxy = proxy.onChange(emit);
  let apps = options.apps;
  let rescanError: string | null = null;
  let rescanChain = Promise.resolve();

  const rescan = (): Promise<void> => {
    rescanChain = rescanChain.then(rescanOnce).catch((cause: unknown) => {
      rescanError = messageOf(cause);
      emit();
    });
    return rescanChain;
  };

  async function rescanOnce(): Promise<void> {
    let scanned: AppConfig[];
    try {
      scanned = workspace.scan();
    } catch (cause) {
      rescanError = messageOf(cause);
      emit();
      return;
    }
    rescanError = null;
    apps = scanned;
    await engine.setApps(scanned);
    await proxy.setRoutes(routesForApps(scanned));
    emit();
  }

  return {
    start: () => proxy.start(),
    stop: async () => {
      await engine.stopAll();
      await proxy.stop();
      unsubscribeEngine();
      unsubscribeProxy();
      listeners.clear();
    },
    apps: () => apps,
    startForward: (appDir, portName) => engine.start(appDir, portName),
    stopForward: (appDir, portName) => engine.stop(appDir, portName),
    restartForward: (appDir, portName) => engine.restart(appDir, portName),
    startApp: (appDir) => engine.startApp(appDir),
    stopApp: (appDir) => engine.stopApp(appDir),
    startAll: () => engine.startAll(),
    stopAll: () => engine.stopAll(),
    rescan,
    rescanError: () => rescanError,
    statuses: () => engine.statuses(),
    proxyStatus: () => proxy.status(),
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  function emit(): void {
    for (const listener of listeners) listener();
  }
}
