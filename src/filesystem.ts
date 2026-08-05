import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  type Dirent,
} from "node:fs";

export interface FileEntry {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
}

export interface FileSystem {
  exists(path: string): boolean;
  isDirectory(path: string): boolean;
  readDirectory(path: string): FileEntry[];
  readFile(path: string): string;
}

export const nodeFileSystem: FileSystem = {
  exists: (path) => existsSync(path),
  isDirectory: (path) => statSync(path).isDirectory(),
  readDirectory: (path) => readdirSync(path, { withFileTypes: true }) as Dirent[],
  readFile: (path) => readFileSync(path, "utf8"),
};
