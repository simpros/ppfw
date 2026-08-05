import type { AppConfig, PortEntry } from "./config/app.ts";

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
}

const FOOTER_KEYS = "↑/↓ select app · space fold/unfold · q quit";

export function buildView(options: BuildViewOptions): View {
  const portCount = options.apps.reduce((n, app) => n + app.ports.length, 0);

  return {
    header: {
      left: `ppfw  workspace ${options.workspaceRoot}  proxy ○ down`,
      counts: `${options.apps.length} apps · ${portCount} ports · 0 up`,
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
    rows: isCollapsed ? [] : app.ports.map(buildRow),
  };
}

function buildRow(port: PortEntry): PortRowView {
  const standalone = !port.forward;
  return {
    state: standalone ? "◆ alias" : "○ stop",
    name: port.name,
    port: `:${port.port}`,
    alias: port.alias ? `→  ${port.alias}` : "(no alias)",
    note: standalone ? "standalone · no forward" : "",
    standalone,
  };
}
