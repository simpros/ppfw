import type { AppConfig, PortEntry } from "./config/app.ts";
import { forwardKey, type ForwardStatus } from "./forward.ts";
import type { ProxyStatus } from "./proxy.ts";

export interface HeaderView {
  left: string;
  counts: string;
}

export interface PortRowView {
  state: string;
  name: string;
  port: string;
  alias: string;
  note: string;
  standalone: boolean;
}

export interface AppGroupView {
  name: string;
  dir: string;
  collapsedGlyph: string;
  remoteLabel: string;
  rows: PortRowView[];
}

export interface FooterView {
  keys: string;
}

export interface View {
  header: HeaderView;
  groups: AppGroupView[];
  footer: FooterView;
}

export interface BuildViewOptions {
  workspaceRoot: string;
  apps: AppConfig[];
  collapsed: ReadonlySet<string>;
  defaultRemote?: string | null;
  statuses?: ReadonlyMap<string, ForwardStatus>;
  proxyStatus?: ProxyStatus;
}

const FOOTER_KEYS = "↑/↓ select · space fold/unfold · s start · x stop · q quit";

export function buildView(options: BuildViewOptions): View {
  const portCount = options.apps.reduce((n, app) => n + app.ports.length, 0);
  const upCount = options.apps.reduce(
    (n, app) =>
      n +
      app.ports.filter(
        (port) => port.forward && phaseFor(app, port, options) === "up",
      ).length,
    0,
  );

  return {
    header: {
      left: `ppfw  workspace ${options.workspaceRoot}  proxy ${
        options.proxyStatus?.phase === "up" ? "● up" : "○ down"
      }`,
      counts: `${options.apps.length} apps · ${portCount} ports · ${upCount} up`,
    },
    groups: options.apps.map((app) => buildGroup(app, options)),
    footer: { keys: FOOTER_KEYS },
  };
}

function buildGroup(app: AppConfig, options: BuildViewOptions): AppGroupView {
  const isCollapsed = options.collapsed.has(app.dir);
  const remote = app.remote ?? options.defaultRemote ?? null;
  return {
    name: app.name,
    dir: app.dir,
    collapsedGlyph: isCollapsed ? "▶" : "▼",
    remoteLabel: remote ? `remote ${remote}` : "remote (default)",
    rows: isCollapsed ? [] : app.ports.map((port) => buildRow(app, port, options)),
  };
}

function buildRow(
  app: AppConfig,
  port: PortEntry,
  options: BuildViewOptions,
): PortRowView {
  if (!port.forward) {
    return {
      state: "◆ alias",
      name: port.name,
      port: `:${port.port}`,
      alias: port.alias ? `→  ${port.alias}` : "(no alias)",
      note: "standalone · no forward",
      standalone: true,
    };
  }
  const phase = phaseFor(app, port, options);
  return {
    state: phase === "up" ? "● up" : "○ stop",
    name: port.name,
    port: `:${port.port}`,
    alias: port.alias ? `→  ${port.alias}` : "(no alias)",
    note: phase === "starting" ? "starting…" : "",
    standalone: false,
  };
}

function phaseFor(
  app: AppConfig,
  port: PortEntry,
  options: BuildViewOptions,
): ForwardStatus["phase"] | undefined {
  return options.statuses?.get(forwardKey(app.dir, port.name))?.phase;
}
