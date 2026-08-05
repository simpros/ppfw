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
        (port) => port.forward && statusFor(app, port, options)?.phase === "up",
      ).length,
    0,
  );

  return {
    header: {
      left: `ppfw  workspace ${options.workspaceRoot}  root proxy ${proxyLabel(
        options.proxyStatus,
      )}`,
      counts: `${options.apps.length} apps · ${portCount} ports · ${upCount} up`,
    },
    groups: options.apps.map((app) => buildGroup(app, options)),
    footer: { keys: FOOTER_KEYS },
  };
}

function proxyLabel(status: ProxyStatus | undefined): string {
  if (status?.phase === "up") return "● up";
  const error = status?.lastError;
  if (error === undefined || error === null || error === "") return "○ down";
  return `○ down (${error.length > 40 ? `${error.slice(0, 37)}…` : error})`;
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
  const status = statusFor(app, port, options);
  let state = "○ stop";
  let note = "";
  if (status?.phase === "up") {
    state = "● up";
  } else if (status?.phase === "starting") {
    note = "starting…";
  } else if (status?.phase === "reconnecting") {
    state = "◐ recon";
    note = reconnectNote(status);
  } else if (status?.phase === "error") {
    state = "✗ err";
    note = status.note ?? "start failed";
  }
  return {
    state,
    name: port.name,
    port: `:${port.port}`,
    alias: port.alias ? `→  ${port.alias}` : "(no alias)",
    note: truncate(note),
    standalone: false,
  };
}

const MAX_NOTE_LENGTH = 80;

function truncate(note: string): string {
  if (note.length <= MAX_NOTE_LENGTH) return note;
  return `${note.slice(0, MAX_NOTE_LENGTH - 1)}…`;
}

function reconnectNote(status: ForwardStatus): string {
  const backoff =
    status.backoffMs !== undefined
      ? `backoff ${Math.round(status.backoffMs / 1000)}s`
      : "reconnecting";
  return status.note ? `${backoff} · ${status.note}` : backoff;
}

function statusFor(
  app: AppConfig,
  port: PortEntry,
  options: BuildViewOptions,
): ForwardStatus | undefined {
  return options.statuses?.get(forwardKey(app.dir, port.name));
}
