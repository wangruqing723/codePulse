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
          throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
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

    __testing__.setExecFileResult({
      stdout:
        "21707 21706 /Applications/Electron.app/Contents/MacOS/Electron dist-companion/main.cjs",
      stderr: "",
    });

    await expect(readCompanionProcessRecord()).resolves.toMatchObject({
      pid: 21707,
      launcherPid: 21706,
      mode: "dev",
    });
  });

  it("accepts a valid Windows process record", async () => {
    const kill = vi.fn();
    __testing__.setDeps({
      platform: "win32",
      readFile: vi.fn(async () =>
        JSON.stringify({
          pid: 21707,
          launcherPid: 0,
          startedAt: "2026-07-04T03:00:00.000Z",
          platform: "win32",
          mode: "packaged",
          execPath:
            "C:\\Program Files\\CodePulse Companion\\CodePulse Companion.exe",
          argv: [],
        }),
      ),
      kill,
    });

    await expect(readCompanionProcessRecord()).resolves.toMatchObject({
      pid: 21707,
      platform: "win32",
    });
    expect(kill).toHaveBeenCalledWith(21707, 0);
  });

  it("does not pass a zero Windows launcher pid to taskkill", async () => {
    const execFile = vi.fn(async () => ({ stdout: "", stderr: "" }));
    __testing__.setDeps({
      platform: "win32",
      readFile: vi.fn(async () =>
        JSON.stringify({
          pid: 21707,
          launcherPid: 0,
          startedAt: "2026-07-04T03:00:00.000Z",
          platform: "win32",
          mode: "packaged",
          execPath:
            "C:\\Program Files\\CodePulse Companion\\CodePulse Companion.exe",
          argv: [],
        }),
      ),
      execFile,
      rm: vi.fn(async () => undefined),
    });

    await expect(killCompanionProcess()).resolves.toEqual({
      status: "killed",
      matchedPids: [21707],
    });
    expect(execFile).toHaveBeenCalledWith("taskkill", [
      "/PID",
      "21707",
      "/T",
      "/F",
    ]);
  });

  it("propagates a malformed process record instead of treating it as absent", async () => {
    __testing__.setDeps({
      readFile: vi.fn(async () => "{not-json"),
    });

    await expect(readCompanionProcessRecord()).rejects.toThrow(
      "Companion 进程记录 JSON 无效",
    );
  });

  it("rejects an invalid process record value instead of treating it as absent", async () => {
    __testing__.setDeps({
      readFile: vi.fn(async () => "null"),
    });

    await expect(readCompanionProcessRecord()).rejects.toThrow(
      "Companion 进程记录格式无效",
    );
  });

  it.each([
    ["zero pid", { pid: 0 }],
    ["negative launcher pid", { launcherPid: -1 }],
    ["empty executable path", { execPath: "" }],
    ["relative executable path", { execPath: "bin/electron" }],
    [
      "mismatched platform",
      {
        platform: "win32",
        execPath:
          "C:\\Program Files\\CodePulse Companion\\CodePulse Companion.exe",
      },
    ],
  ])("rejects an unsafe %s process record", async (_, override) => {
    const execFile = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const rm = vi.fn(async () => undefined);
    __testing__.setDeps({
      readFile: vi.fn(async () =>
        JSON.stringify({
          pid: 21707,
          launcherPid: 21706,
          startedAt: "2026-07-04T03:00:00.000Z",
          platform: "darwin",
          mode: "packaged",
          execPath:
            "/Applications/CodePulse Companion.app/Contents/MacOS/CodePulse Companion",
          argv: [],
          ...override,
        }),
      ),
      execFile,
      rm,
    });

    await expect(readCompanionProcessRecord()).rejects.toThrow(
      "Companion 进程记录格式无效",
    );
    expect(execFile).not.toHaveBeenCalled();
    expect(rm).not.toHaveBeenCalled();
  });

  it("propagates process record read errors other than a missing file", async () => {
    __testing__.setDeps({
      readFile: vi.fn(async () => {
        throw Object.assign(new Error("EACCES: permission denied"), {
          code: "EACCES",
        });
      }),
    });

    await expect(readCompanionProcessRecord()).rejects.toThrow(
      "EACCES: permission denied",
    );
  });

  it("clears a stale record when the recorded companion process is gone", async () => {
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
21706     1 /Applications/Electron.app/Contents/MacOS/Electron unrelated-launcher
33001 21706 /Applications/Electron.app/Contents/MacOS/Electron unrelated-child
`.trim(),
      stderr: "",
    });

    await expect(readCompanionProcessRecord()).resolves.toBeUndefined();
    await expect(readCompanionProcessRecord()).resolves.toBeUndefined();
  });

  it("clears a stale record even when another matching companion is running", async () => {
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
22999     1 /Applications/Electron.app/Contents/MacOS/Electron dist-companion/main.cjs --codepulse-companion
23000 22999 /Applications/Electron.app/Contents/Frameworks/CodePulse Helper.app/Contents/MacOS/CodePulse Helper
`.trim(),
      stderr: "",
    });

    await expect(readCompanionProcessRecord()).resolves.toBeUndefined();
    await expect(readCompanionProcessRecord()).resolves.toBeUndefined();
  });

  it.each([
    ["partial JSON", "{partial-json"],
    ["invalid structure", "null"],
  ])(
    "clears a corrupted %s record so forced exit can recover",
    async (_, raw) => {
      let storedRecord: string | undefined = raw;
      const rm = vi.fn(async () => {
        storedRecord = undefined;
      });
      __testing__.setDeps({
        homedir: () => "/Users/tester",
        readFile: vi.fn(async () => {
          if (storedRecord === undefined) {
            throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
          }
          return storedRecord;
        }),
        rm,
      });

      await expect(killCompanionProcess()).resolves.toEqual({
        status: "not-found",
        matchedPids: [],
      });
      await expect(readCompanionProcessRecord()).resolves.toBeUndefined();
      expect(rm).toHaveBeenCalledWith(
        "/Users/tester/.codepulse/companion/process.json",
        { force: true },
      );
    },
  );

  it.each(["EIO", "EMFILE", "EACCES"])(
    "preserves the process record when forced exit hits %s",
    async (code) => {
      const rm = vi.fn(async () => undefined);
      __testing__.setDeps({
        readFile: vi.fn(async () => {
          throw Object.assign(new Error(`${code}: temporary read failure`), {
            code,
          });
        }),
        rm,
      });

      await expect(killCompanionProcess()).rejects.toMatchObject({ code });
      expect(rm).not.toHaveBeenCalled();
    },
  );

  it("surfaces a failure to clear a corrupted process record", async () => {
    const clearError = Object.assign(
      new Error("EACCES: cannot remove record"),
      {
        code: "EACCES",
      },
    );
    const rm = vi.fn(async () => {
      throw clearError;
    });
    __testing__.setDeps({
      readFile: vi.fn(async () => "{partial-json"),
      rm,
    });

    await expect(killCompanionProcess()).rejects.toBe(clearError);
    expect(rm).toHaveBeenCalledTimes(1);
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

  it("does not kill unrelated children under the same launcher", async () => {
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
21706     1 /Applications/Electron.app/Contents/MacOS/Electron launcher
21707 21706 /Applications/Electron.app/Contents/MacOS/Electron dist-companion/main.cjs --codepulse-companion
21708 21707 /Applications/Electron.app/Contents/Frameworks/CodePulse Helper (GPU).app/Contents/MacOS/CodePulse Helper (GPU)
33001 21706 /Applications/Electron.app/Contents/MacOS/Electron unrelated-child
33002 33001 /Applications/Electron.app/Contents/Frameworks/Unrelated Helper.app/Contents/MacOS/Unrelated Helper
`.trim(),
      stderr: "",
    });

    await expect(killCompanionProcess()).resolves.toEqual({
      status: "killed",
      matchedPids: [21707, 21708],
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
