import {
  BoxRenderable,
  createCliRenderer,
  createTextAttributes,
  type KeyEvent,
  ScrollBoxRenderable,
  TextRenderable,
} from "@opentui/core";
import type { AppConfig } from "../config/app.ts";
import { buildView, type PortRowView } from "../view.ts";

export interface TuiOptions {
  workspaceRoot: string;
  apps: AppConfig[];
  defaultRemote: string | null;
}

const DIM = "#8a8a8a";
const ACCENT = "#5fd7ff";
const SELECTED = "#ffd75f";

export async function runTui(options: TuiOptions): Promise<void> {
  const renderer = await createCliRenderer({ exitOnCtrlC: true });
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
  ): TextRenderable => {
    const line =
      `  ${row.state.padEnd(widths.state)}  ` +
      `${row.name.padEnd(widths.name)} ${row.port.padEnd(widths.port)}  ` +
      `${row.alias}${row.note ? `   ${row.note}` : ""}`;
    return new TextRenderable(renderer, {
      content: line,
      fg: row.standalone ? ACCENT : undefined,
    });
  };

  const render = (): void => {
    const view = buildView({
      workspaceRoot: options.workspaceRoot,
      apps: options.apps,
      collapsed,
      defaultRemote: options.defaultRemote,
    });

    setText(
      header,
      new TextRenderable(renderer, { content: view.header.left }),
      new TextRenderable(renderer, { content: view.header.counts, fg: DIM }),
    );
    setText(
      footer,
      new TextRenderable(renderer, { content: view.footer.keys, fg: DIM }),
    );

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
    if (view.groups.length === 0) {
      box.add(
        new TextRenderable(renderer, {
          content: "no apps found — add a .ppfw.config to an app directory",
          fg: DIM,
        }),
      );
    }
    view.groups.forEach((group, index) => {
      const groupBox = new BoxRenderable(renderer, { flexDirection: "column" });
      const groupHeader = new BoxRenderable(renderer, {
        flexDirection: "row",
        justifyContent: "space-between",
      });
      groupHeader.add(
        new TextRenderable(renderer, {
          content: `${group.collapsedGlyph} ${group.name}`,
          fg: index === selected ? SELECTED : undefined,
          attributes: createTextAttributes({ bold: true }),
        }),
      );
      groupHeader.add(
        new TextRenderable(renderer, { content: group.remoteLabel, fg: DIM }),
      );
      groupBox.add(groupHeader);
      for (const row of group.rows) groupBox.add(renderRow(row, widths));
      box.add(groupBox);
    });
    body.add(box);
  };

  const move = (delta: number): void => {
    if (options.apps.length === 0) return;
    selected = Math.min(Math.max(selected + delta, 0), options.apps.length - 1);
    render();
  };

  const toggleSelected = (): void => {
    const app = options.apps[selected];
    if (!app) return;
    if (collapsed.has(app.dir)) collapsed.delete(app.dir);
    else collapsed.add(app.dir);
    render();
  };

  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    if (key.name === "q") {
      renderer.destroy();
      return;
    }
    if (key.name === "up" || key.name === "k") move(-1);
    if (key.name === "down" || key.name === "j") move(1);
    if (key.name === "space") toggleSelected();
  });

  render();
}
