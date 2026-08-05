import { join } from "node:path";
import type { AppConfig } from "./config/app.ts";
import {
  bunSpawnWithStdin,
  runStartupWatch,
  tcpProbe,
  type ProbeFn,
  type SpawnFn,
  type SpawnedChild,
} from "./supervisor.ts";

export interface ProxyRoute {
  host: string;
  port: number;
}

export type ProxyPhase = "down" | "starting" | "up";

export interface ProxyStatus {
  phase: ProxyPhase;
}

export interface RootProxyOptions {
  routes: ProxyRoute[];
  port?: number;
  scriptPath?: string;
  spawn?: SpawnFn;
  probe?: ProbeFn;
  pollIntervalMs?: number;
  startupTimeoutMs?: number;
}

const DEFAULT_PORT = 80;
const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;

export function proxyRoutesJson(routes: ProxyRoute[]): string {
  const map: Record<string, number> = {};
  for (const route of routes) map[route.host] = route.port;
  return JSON.stringify(map);
}

export function buildRootProxyArgs(
  scriptPath: string,
  port: number,
  routes: ProxyRoute[],
  bunPath: string = process.execPath,
): string[] {
  return [
    "sudo",
    "--",
    bunPath,
    scriptPath,
    "--routes",
    proxyRoutesJson(routes),
    "--port",
    String(port),
  ];
}

export function routesForApps(apps: AppConfig[]): ProxyRoute[] {
  const routes: ProxyRoute[] = [];
  for (const app of apps) {
    for (const port of app.ports) {
      if (port.alias !== null) routes.push({ host: port.alias, port: port.port });
    }
  }
  return routes;
}

export class RootProxy {
  private phase: ProxyPhase = "down";
  private child: SpawnedChild | null = null;
  private generation = 0;
  private readonly listeners = new Set<() => void>();
  private readonly routes: ProxyRoute[];
  private readonly port: number;
  private readonly scriptPath: string;
  private readonly spawn: SpawnFn;
  private readonly probe: ProbeFn;
  private readonly pollIntervalMs: number;
  private readonly startupTimeoutMs: number;

  constructor(options: RootProxyOptions) {
    this.routes = options.routes;
    this.port = options.port ?? DEFAULT_PORT;
    this.scriptPath = options.scriptPath ?? join(import.meta.dir, "root-proxy.ts");
    this.spawn = options.spawn ?? bunSpawnWithStdin;
    this.probe = options.probe ?? tcpProbe;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  }

  status(): ProxyStatus {
    return { phase: this.phase };
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.phase !== "down") return;

    this.phase = "starting";
    this.generation += 1;
    const generation = this.generation;
    this.emit();

    let child: SpawnedChild;
    try {
      child = this.spawn(buildRootProxyArgs(this.scriptPath, this.port, this.routes));
    } catch {
      this.markDown();
      return;
    }
    this.child = child;

    await this.runStartup(child, generation);
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.generation += 1;
    this.markDown();
    if (child) {
      this.shutdown(child);
      await child.exited.catch(() => 0);
    }
  }

  private async runStartup(
    child: SpawnedChild,
    generation: number,
  ): Promise<void> {
    await runStartupWatch({
      child,
      probe: this.probe,
      port: this.port,
      pollIntervalMs: this.pollIntervalMs,
      startupTimeoutMs: this.startupTimeoutMs,
      isCurrent: () =>
        this.generation === generation && this.phase === "starting",
      onUp: () => {
        this.phase = "up";
        this.emit();
        this.watchExit(child, generation);
      },
      onFailed: () => this.markDown(),
      shutdown: (c) => this.shutdown(c),
    });
  }

  private shutdown(child: SpawnedChild): void {
    if (child.closeStdin) child.closeStdin();
    else child.kill("SIGTERM");
  }

  private watchExit(child: SpawnedChild, generation: number): void {
    void child.exited.then(() => {
      if (this.generation === generation && this.phase === "up") {
        this.markDown();
      }
    });
  }

  private markDown(): void {
    this.phase = "down";
    this.child = null;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
