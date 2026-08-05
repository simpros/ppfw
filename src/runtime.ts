import type { ForwardEngine, ForwardStatus } from "./forward.ts";
import type { ProxyStatus, RootProxy } from "./proxy.ts";

export interface Runtime {
  start(): Promise<void>;
  stop(): Promise<void>;
  startForward(appDir: string, portName: string): Promise<void>;
  stopForward(appDir: string, portName: string): Promise<void>;
  statuses(): ReadonlyMap<string, ForwardStatus>;
  proxyStatus(): ProxyStatus;
  onChange(listener: () => void): () => void;
}

export interface RuntimeOptions {
  engine: ForwardEngine;
  proxy: RootProxy;
}

export function createRuntime(options: RuntimeOptions): Runtime {
  const { engine, proxy } = options;
  const listeners = new Set<() => void>();
  const unsubscribeEngine = engine.onChange(emit);
  const unsubscribeProxy = proxy.onChange(emit);

  return {
    start: () => proxy.start(),
    stop: async () => {
      await engine.stopAll();
      await proxy.stop();
      unsubscribeEngine();
      unsubscribeProxy();
      listeners.clear();
    },
    startForward: (appDir, portName) => engine.start(appDir, portName),
    stopForward: (appDir, portName) => engine.stop(appDir, portName),
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
