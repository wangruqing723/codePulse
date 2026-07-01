import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function walkJsonlFiles(
  root: string,
  maxDepth: number,
): Promise<string[]> {
  const files: string[] = [];

  async function visit(current: string, depth: number) {
    if (depth > maxDepth) {
      return;
    }

    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    await Promise.all(
      entries.map(async (entry) => {
        const entryName = String(entry.name);
        const fullPath = path.join(current, entryName);
        if (entry.isDirectory()) {
          await visit(fullPath, depth + 1);
          return;
        }

        if (entry.isFile() && entryName.endsWith(".jsonl")) {
          files.push(fullPath);
        }
      }),
    );
  }

  await visit(root, 0);
  return files;
}
