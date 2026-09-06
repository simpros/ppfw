export interface Palette {
  fg: string;
  dim: string;
  accent: string;
  selected: string;
  danger: string;
}

export const DARK_PALETTE: Palette = {
  fg: "#e4e4e4",
  dim: "#8a8a8a",
  accent: "#5fd7ff",
  selected: "#ffd75f",
  danger: "#ff5f5f",
};

export const LIGHT_PALETTE: Palette = {
  fg: "#1a1a1a",
  dim: "#5f5f5f",
  accent: "#005f87",
  selected: "#af5f00",
  danger: "#af0000",
};
