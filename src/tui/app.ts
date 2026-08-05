import {
  BoxRenderable,
  createCliRenderer,
  createTextAttributes,
  type KeyEvent,
  ScrollBoxRenderable,
  TextRenderable,
  type ThemeMode,
} from "@opentui/core";
import type { AppConfig } from "../config/app.ts";
import type { ForwardEngine } from "../forward.ts";
import type { RootProxy } from "../proxy.ts";
import { buildView, type PortRowView } from "../view.ts";

export interface TuiOptions {
  workspaceRoot: string;
  apps: AppConfig[];
  defaultRemote: string | null;
  engine: ForwardEngine;
  proxy: RootProxy;
}

export interface Palette {
  fg: string;
  dim: string;
  accent: string;
  selected: string;
}

const DARK_PALETTE: Palette = {
  fg: "#e4e4e4",
  dim: "#8a8a8a",
  accent: "#5fd7ff",
  selected: "#ffd75f",
};

const LIGHT_PALETTE: Palette = {
  fg: "#1a1a1a",
  dim: "#5f5f5f",
  accent: "#005f87",
  selected: "#af5f00",
};

export function paletteFor(themeMode: ThemeMode | null): Palette {
  return themeMode === "light" ? LIGHT_PALETTE : DARK_PALETTE;
}

/**
 * Fallback for terminals that never answer the OSC 10/11 theme query:
 * COLORFGBG (set by several terminal families) is "fg;bg" ANSI indices.
 */
export function themeFromEnv(
  env: Record<string, string | undefined>,
): ThemeMode | null {
  const bg = env.COLORFGBG?.split(";").pop();
  if (bg === "7" || bg === "15") return "light";
  if (bg !== undefined && bg !== "" && bg !== "default") return "dark";
  return null;
}

const THEME_DETECT_TIMEOUT_MS = 300;

type Item =
  | { kind: "group"; dir: string }
  | { kind: "row"; dir: string; portName: string };

export async function runTui(options: TuiOptions): Promise<void> {
  const renderer = await createCliRenderer({ exitOnCtrlC: true });
  await renderer.waitForThemeMode(THEME_DETECT_TIMEOUT_MS);
  let themeMode: ThemeMode | null = renderer.themeMode ?? themeFromEnv(process.env);
  const collapsed = new Set<string>();
  let selected = 0;
  let content: BoxRenderable | null = null;

  const frame = new BoxRenderable(renderer, {
    flexDirection: "column",
    width: "100%",
    height: "100%",
  });
  const header = new BoxRenderable(renderer, {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 1,
  });
  const body = new ScrollBoxRenderable(renderer, { flexGrow: 1, scrollY: true });
  const footer = new BoxRenderable(renderer, { border: ["top"] });
  renderer.root.add(frame);
  frame.add(header);
  frame.add(body);
  frame.add(footer);

  const setText = (box: BoxRenderable, ...texts: TextRenderable[]): void => {
    for (const child of box.getChildren()) {
      box.remove(child);
      child.destroyRecursively();
    }
    for (const text of texts) box.add(text);
  };

  const renderRow = (
    row: PortRowView,
    widths: { state: number; name: number; port: number },
    colors: Palette,
    isSelected: boolean,
  ): TextRenderable => {
    const line =
      `  ${row.state.padEnd(widths.state)}  ` +
      `${row.name.padEnd(widths.name)} ${row.port.padEnd(widths.port)}  ` +
      `${row.alias}${row.note ? `   ${row.note}` : ""}`;
    return new TextRenderable(renderer, {
      content: line,
      fg: isSelected ? colors.selected : row.standalone ? colors.accent : colors.fg,
    });
  };

  let items: Item[] = [];

  const render = (): void => {
    const colors = paletteFor(themeMode);
    const view = buildView({
      workspaceRoot: options.workspaceRoot,
      apps: options.apps,
      collapsed,
      defaultRemote: options.defaultRemote,
      statuses: options.engine.statuses(),
      proxyStatus: options.proxy.status(),
    });

    setText(
      header,
      new TextRenderable(renderer, { content: view.header.left, fg: colors.fg }),
      new TextRenderable(renderer, { content: view.header.counts, fg: colors.dim }),
    );
    setText(
      footer,
      new TextRenderable(renderer, { content: view.footer.keys, fg: colors.dim }),
    );
    footer.borderColor = colors.dim;

    if (content) {
      body.remove(content);
      content.destroyRecursively();
    }
    const rows = view.groups.flatMap((group) => group.rows);
    const widths = {
      state: Math.max(0, ...rows.map((row) => row.state.length)),
      name: Math.max(0, ...rows.map((row) => row.name.length)),
      port: Math.max(0, ...rows.map((row) => row.port.length)),
    };
    content = new BoxRenderable(renderer, {
      flexDirection: "column",
      width: "100%",
      rowGap: 1,
    });
    const box = content;
    items = view.groups.flatMap((group) => [
      { kind: "group", dir: group.dir } as Item,
      ...group.rows.map(
        (row): Item => ({ kind: "row", dir: group.dir, portName: row.name }),
      ),
    ]);
    selected = Math.min(selected, Math.max(0, items.length - 1));
    if (view.groups.length === 0) {
      box.add(
        new TextRenderable(renderer, {
          content: "no apps found — add a .ppfw.config to an app directory",
          fg: colors.dim,
        }),
      );
    }
    let itemIndex = -1;
    view.groups.forEach((group) => {
      itemIndex += 1;
      const groupBox = new BoxRenderable(renderer, { flexDirection: "column" });
      const groupHeader = new BoxRenderable(renderer, {
        flexDirection: "row",
        justifyContent: "space-between",
      });
      groupHeader.add(
        new TextRenderable(renderer, {
          content: `${group.collapsedGlyph} ${group.name}`,
          fg: itemIndex === selected ? colors.selected : colors.fg,
          attributes: createTextAttributes({ bold: true }),
        }),
      );
      groupHeader.add(
        new TextRenderable(renderer, { content: group.remoteLabel, fg: colors.dim }),
      );
      groupBox.add(groupHeader);
      for (const row of group.rows) {
        itemIndex += 1;
        groupBox.add(renderRow(row, widths, colors, itemIndex === selected));
      }
      box.add(groupBox);
    });
    body.add(box);
  };

  const move = (delta: number): void => {
    if (items.length === 0) return;
    selected = Math.min(Math.max(selected + delta, 0), items.length - 1);
    render();
  };

  const toggleSelected = (): void => {
    const item = items[selected];
    if (item?.kind !== "group") return;
    if (collapsed.has(item.dir)) collapsed.delete(item.dir);
    else collapsed.add(item.dir);
    render();
  };

  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    if (key.name === "q") {
      void options.engine.stopAll().finally(() => renderer.destroy());
      return;
    }
    if (key.name === "up" || key.name === "k") move(-1);
    if (key.name === "down" || key.name === "j") move(1);
    if (key.name === "space") toggleSelected();
    const item = items[selected];
    if (item?.kind === "row") {
      if (key.name === "s") void options.engine.start(item.dir, item.portName);
      if (key.name === "x") void options.engine.stop(item.dir, item.portName);
    }
  });

  options.engine.onChange(render);
  options.proxy.onChange(render);

  renderer.on("theme_mode", (mode: ThemeMode) => {
    themeMode = mode;
    render();
  });

  render();
}
