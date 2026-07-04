import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCompanionProcessRecord,
  killCompanionProcess,
  readCompanionProcessRecord,
  registerCompanionProcess,
  __testing__,
} from "./process-control";

describe("companion process control", () => {
  beforeEach(() => {
    const files = new Map<string, string>();

    __testing__.setDeps({
      platform: "darwin",
      homedir: () => "/Users/tester",
      mkdir: vi.fn(async () => undefined),
      readFile: vi.fn(async (filePath: string) => {
        const value = files.get(filePath);
        if (value === undefined) {
          throw new Error("ENOENT");
        }
        return value;
      }),
      writeFile: vi.fn(async (filePath: string, content: string) => {
        files.set(filePath, content);
      }),
      rm: vi.fn(async (filePath: string) => {
        files.delete(filePath);
      }),
      execFile: vi.fn(async () => ({
        stdout: "",
        stderr: "",
      })),
      kill: vi.fn(),
    });
  });

  it("round-trips the companion record under the shared control root", async () => {
    await registerCompanionProcess({
      pid: 21707,
      launcherPid: 21706,
      startedAt: "2026-07-04T03:00:00.000Z",
      platform: "darwin",
      mode: "dev",
      execPath: "/Applications/Electron.app/Contents/MacOS/Electron",
      argv: ["dist-companion/main.cjs"],
    });

    await expect(readCompanionProcessRecord()).resolves.toMatchObject({
      pid: 21707,
      launcherPid: 21706,
      mode: "dev",
    });
  });

  it("kills the recorded companion tree without touching unrelated Electron processes", async () => {
    await registerCompanionProcess({
      pid: 21707,
      launcherPid: 21706,
      startedAt: "2026-07-04T03:00:00.000Z",
      platform: "darwin",
      mode: "dev",
      execPath: "/Applications/Electron.app/Contents/MacOS/Electron",
      argv: ["dist-companion/main.cjs", "--codepulse-companion"],
    });

    __testing__.setExecFileResult({
      stdout: `
21706     1 /Applications/Electron.app/Contents/MacOS/Electron dist-companion/main.cjs --codepulse-companion
21707 21706 /Applications/Electron.app/Contents/MacOS/Electron dist-companion/main.cjs --codepulse-companion
21708 21707 /Applications/Electron.app/Contents/Frameworks/CodePulse Helper (GPU).app/Contents/MacOS/CodePulse Helper (GPU)
21709 21707 /Applications/Electron.app/Contents/Frameworks/CodePulse Helper (Renderer).app/Contents/MacOS/CodePulse Helper (Renderer)
21710 21707 /Applications/Electron.app/Contents/Frameworks/CodePulse Helper.app/Contents/MacOS/CodePulse Helper --type=utility
33001     1 /Applications/Unrelated.app/Contents/MacOS/Unrelated --type=renderer
`.trim(),
      stderr: "",
    });

    await expect(killCompanionProcess()).resolves.toEqual({
      status: "killed",
      matchedPids: [21706, 21707, 21708, 21709, 21710],
    });
  });

  it("clears the record file", async () => {
    await registerCompanionProcess({
      pid: 1,
      startedAt: "2026-07-04T03:00:00.000Z",
      platform: "darwin",
      mode: "dev",
      execPath: "/bin/node",
      argv: ["dist-companion/main.cjs"],
    });

    await clearCompanionProcessRecord();

    await expect(readCompanionProcessRecord()).resolves.toBeUndefined();
  });
});
