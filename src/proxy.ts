import { join } from "node:path";
import type { AppConfig } from "./config/app.ts";
import { RouteTable, type Route } from "./route-table.ts";
import {
  ChildSupervisor,
  bunSpawnWithStdin,
  sudoValidateEscalation,
  tcpProbe,
  type EscalateFn,
  type ProbeFn,
  type SpawnFn,
} from "./supervisor.ts";

export type ProxyRoute = Route;

export type ProxyPhase = "down" | "starting" | "up";

export interface ProxyStatus {
  phase: ProxyPhase;
  lastError: string | null;
}

export interface RootProxyOptions {
  routes: ProxyRoute[];
  port?: number;
  scriptPath?: string;
  spawn?: SpawnFn;
  escalate?: EscalateFn;
  probe?: ProbeFn;
  pollIntervalMs?: number;
  startupTimeoutMs?: number;
  captureTimeoutMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

const DEFAULT_PORT = 80;
const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const DEFAULT_CAPTURE_TIMEOUT_MS = 2_000;
const DEFAULT_BASE_BACKOFF_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 30_000;

export function proxyRoutesJson(routes: ProxyRoute[]): string {
  return new RouteTable(routes).toJson();
}

export function buildRootProxyArgs(
  scriptPath: string,
  port: number,
  routes: ProxyRoute[],
  bunPath: string = process.execPath,
): string[] {
  return [
    "sudo",
    "-n",
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
  private readonly routes: ProxyRoute[];
  private readonly port: number;
  private readonly supervisor: ChildSupervisor;

  constructor(options: RootProxyOptions) {
    this.routes = options.routes;
    this.port = options.port ?? DEFAULT_PORT;
    const scriptPath = options.scriptPath ?? join(import.meta.dir, "root-proxy.ts");
    const escalate = options.escalate ?? sudoValidateEscalation(this.port);
    this.supervisor = new ChildSupervisor({
      label: "root proxy",
      argv: buildRootProxyArgs(scriptPath, this.port, this.routes),
      port: this.port,
      prepare: async () => {
        const code = await escalate();
        if (code !== 0) {
          throw new Error(`sudo authentication failed (exit code ${code})`);
        }
      },
      spawn: options.spawn ?? bunSpawnWithStdin,
      probe: options.probe ?? tcpProbe,
      shutdown: (child) => {
        if (child.closeStdin) child.closeStdin();
        else child.kill("SIGTERM");
      },
      pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      startupTimeoutMs: options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
      captureTimeoutMs: options.captureTimeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS,
      baseBackoffMs: options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS,
      maxBackoffMs: options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS,
    });
  }

  status(): ProxyStatus {
    const status = this.supervisor.status();
    return {
      phase: status.phase === "up" ? "up" : status.phase === "starting" ? "starting" : "down",
      lastError: status.lastError,
    };
  }

  get lastError(): string | null {
    return this.status().lastError;
  }

  onChange(listener: () => void): () => void {
    return this.supervisor.onChange(listener);
  }

  async start(): Promise<void> {
    await this.supervisor.start();
  }

  async stop(): Promise<void> {
    await this.supervisor.stop();
  }
}
