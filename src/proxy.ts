import { join } from "node:path";
import type { AppConfig } from "./config/app.ts";
import { RouteTable, type Route } from "./route-table.ts";
import {
  ChildSupervisor,
  DEFAULT_BASE_BACKOFF_MS,
  DEFAULT_CAPTURE_TIMEOUT_MS,
  DEFAULT_MAX_BACKOFF_MS,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_STARTUP_TIMEOUT_MS,
  bunSpawnWithStdin,
  sudoValidateEscalation,
  tcpProbe,
  type EscalateFn,
  type ProbeFn,
  type SpawnFn,
} from "./supervisor.ts";

export type ProxyPhase = "down" | "starting" | "up";

export interface ProxyStatus {
  phase: ProxyPhase;
  lastError: string | null;
}

export interface RootProxyOptions {
  routes: Route[];
  port?: number;
  hostsPath?: string;
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

export function proxyRoutesJson(routes: Route[]): string {
  return new RouteTable(routes).toJson();
}

export function buildRootProxyArgs(
  scriptPath: string,
  port: number,
  routes: Route[],
  bunPath: string = process.execPath,
  hostsPath?: string,
): string[] {
  const args = [
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
  if (hostsPath !== undefined) args.push("--hosts-path", hostsPath);
  return args;
}

export function routesForApps(apps: AppConfig[]): Route[] {
  const routes: Route[] = [];
  for (const app of apps) {
    for (const port of app.ports) {
      if (port.alias !== null) routes.push({ host: port.alias, port: port.port });
    }
  }
  return routes;
}

export class RootProxy {
  private readonly port: number;
  private readonly scriptPath: string;
  private readonly hostsPath: string | undefined;
  private readonly supervisor: ChildSupervisor;
  private routesJson: string;

  constructor(options: RootProxyOptions) {
    this.port = options.port ?? DEFAULT_PORT;
    this.scriptPath = options.scriptPath ?? join(import.meta.dir, "root-proxy.ts");
    this.hostsPath = options.hostsPath;
    this.routesJson = proxyRoutesJson(options.routes);
    const escalate = options.escalate ?? sudoValidateEscalation(this.port);
    this.supervisor = new ChildSupervisor({
      label: "root proxy",
      argv: buildRootProxyArgs(
        this.scriptPath,
        this.port,
        options.routes,
        process.execPath,
        options.hostsPath,
      ),
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

  onChange(listener: () => void): () => void {
    return this.supervisor.onChange(listener);
  }

  async start(): Promise<void> {
    await this.supervisor.start();
  }

  async stop(): Promise<void> {
    await this.supervisor.stop();
  }

  /**
   * Serve a new route table. A running proxy is restarted with the new
   * routes; a proxy that is down or halted picks them up on its next start,
   * and one mid-backoff retries with them on its next attempt.
   */
  async setRoutes(routes: Route[]): Promise<void> {
    const json = proxyRoutesJson(routes);
    if (json === this.routesJson) return;
    this.routesJson = json;
    const phase = this.supervisor.status().phase;
    const active = phase === "up" || phase === "starting";
    if (active) await this.supervisor.stop();
    this.supervisor.setArgv(
      buildRootProxyArgs(this.scriptPath, this.port, routes, process.execPath, this.hostsPath),
    );
    if (active) await this.supervisor.start();
  }
}
