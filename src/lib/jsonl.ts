import { createReadStream } from "node:fs";
import { open as openFile } from "node:fs/promises";

export function parseJsonLine(line: string): unknown | undefined {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

export async function readTailJsonLines(
  filePath: string,
  maxLines = 80,
  maxBytes = 512 * 1024,
): Promise<unknown[]> {
  let handle: Awaited<ReturnType<typeof openFile>> | undefined;

  try {
    handle = await openFile(filePath, "r");
    const stats = await handle.stat();
    const length = Math.min(stats.size, maxBytes);
    const start = Math.max(0, stats.size - length);
    const buffer = Buffer.alloc(length);

    await handle.read(buffer, 0, length, start);

    let text = buffer.toString("utf8");
    if (start > 0) {
      const firstBreak = text.indexOf("\n");
      text = firstBreak >= 0 ? text.slice(firstBreak + 1) : "";
    }

    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-maxLines)
      .map(parseJsonLine)
      .filter((line): line is unknown => line !== undefined);
  } catch {
    return [];
  } finally {
    await handle?.close();
  }
}

export async function readFirstJsonLine(
  filePath: string,
  maxBytes = 2 * 1024 * 1024,
): Promise<unknown | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    let buffer = "";
    const stream = createReadStream(filePath, {
      encoding: "utf8",
      start: 0,
      end: maxBytes - 1,
    });

    function finish(value: unknown | undefined) {
      if (settled) {
        return;
      }

      settled = true;
      resolve(value);
    }

    stream.on("data", (chunk) => {
      buffer += chunk;
      const lineBreak = buffer.indexOf("\n");
      if (lineBreak >= 0) {
        finish(parseJsonLine(buffer.slice(0, lineBreak)));
        stream.destroy();
      }
    });

    stream.on("close", () => finish(parseJsonLine(buffer)));
    stream.on("error", () => finish(undefined));
  });
}
