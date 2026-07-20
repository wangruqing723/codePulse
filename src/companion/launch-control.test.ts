import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bootstrapCompanion,
  getPlatformKey,
  resolveCompanionManifestUrl,
  __testing__,
} from "./launch-control";
import { cleanupCompanionInstall } from "./install-cleanup";

function dirent(name: string, kind: "directory" | "file" | "symlink") {
  return {
    name,
    isDirectory: () => kind === "directory",
    isFile: () => kind === "file",
    isSymbolicLink: () => kind === "symlink",
  };
}

describe("companion bootstrap launch control", () => {
  beforeEach(() => {
    __testing__.resetDeps();
  });

  it("opens an already installed supportPath companion without downloading", async () => {
    const expectedHash =
      "4b9a4ac59f3c3aa32273260df6cf4bf358d1c46f8415126aa35b6380d0abb8f7";
    const fetch = vi.fn(async () =>
      Response.json({
        version: "0.1.3",
        artifacts: {
          "darwin-arm64": {
            url: "https://example.test/companion.zip",
            sha256: expectedHash,
            entrypoint: "CodePulse Companion.app",
          },
        },
      }),
    );
    const downloadFile = vi.fn();
    const open = vi.fn(async () => undefined);

    __testing__.setDeps({
      platform: "darwin",
      arch: "arm64",
      packageVersion: "0.1.3",
      access: vi.fn(async (filePath: string) => {
        if (
          filePath.endsWith(
            "companion/0.1.3/darwin-arm64/CodePulse Companion.app",
          )
        ) {
          return;
        }
        throw new Error("ENOENT");
      }),
      fetch,
      downloadFile,
      open,
    });

    await expect(
      bootstrapCompanion({ supportPath: "/raycast/support" }),
    ).resolves.toMatchObject({
      status: "launched",
      path: "/raycast/support/companion/0.1.3/darwin-arm64/CodePulse Companion.app",
    });

    expect(downloadFile).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(
      "/raycast/support/companion/0.1.3/darwin-arm64/CodePulse Companion.app",
    );
  });

  it("uses the platform-arch supportPath contract for Windows companion installs", async () => {
    const expectedHash =
      "4b9a4ac59f3c3aa32273260df6cf4bf358d1c46f8415126aa35b6380d0abb8f7";
    const fetch = vi.fn(async () =>
      Response.json({
        version: "0.1.3",
        artifacts: {
          "win32-x64": {
            url: "https://example.test/companion.zip",
            sha256: expectedHash,
            entrypoint: "CodePulse Companion.exe",
          },
        },
      }),
    );
    const downloadFile = vi.fn();
    const open = vi.fn(async () => undefined);

    __testing__.setDeps({
      platform: "win32",
      arch: "x64",
      packageVersion: "0.1.3",
      access: vi.fn(async (filePath: string) => {
        if (
          filePath ===
          "C:\\Raycast\\Support\\companion\\0.1.3\\win32-x64\\CodePulse Companion.exe"
        ) {
          return;
        }
        throw new Error("ENOENT");
      }),
      fetch,
      downloadFile,
      open,
    });

    expect(getPlatformKey("win32", "x64")).toBe("win32-x64");

    await expect(
      bootstrapCompanion({ supportPath: "C:\\Raycast\\Support" }),
    ).resolves.toMatchObject({
      status: "launched",
      path: "C:\\Raycast\\Support\\companion\\0.1.3\\win32-x64\\CodePulse Companion.exe",
    });

    expect(downloadFile).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(
      "C:\\Raycast\\Support\\companion\\0.1.3\\win32-x64\\CodePulse Companion.exe",
    );
  });

  it("derives a public manifest URL from the fixed latest release tag", () => {
    expect(
      resolveCompanionManifestUrl({
        packageVersion: "0.1.3",
        releaseTag: undefined,
        manifestUrl: undefined,
      }),
    ).toBe(
      "https://github.com/wangruqing723/codePulse/releases/download/codepulse-companion-latest/codepulse-companion-manifest.json",
    );
  });

  it("reports release-unavailable when the public manifest cannot be fetched", async () => {
    __testing__.setDeps({
      platform: "darwin",
      arch: "arm64",
      packageVersion: "0.1.3",
      access: vi.fn(async () => {
        throw new Error("ENOENT");
      }),
      fetch: vi.fn(async () => new Response("not found", { status: 404 })),
      // 无本地已装版本可回退。
      readdir: vi.fn(async () => {
        throw new Error("ENOENT");
      }),
      open: vi.fn(async () => undefined),
    });

    await expect(
      bootstrapCompanion({ supportPath: "/raycast/support" }),
    ).resolves.toMatchObject({ status: "release-unavailable" });
  });

  it.each([
    ["linux", "x64", "linux-x64"],
    ["darwin", "arm64", "darwin-arm64"],
  ] as const)(
    "reports unsupported-platform on %s when the manifest has no platform artifact",
    async (platform, arch, platformKey) => {
      __testing__.setDeps({
        platform,
        arch,
        packageVersion: "0.1.3",
        access: vi.fn(async () => {
          throw new Error("ENOENT");
        }),
        fetch: vi.fn(async () =>
          Response.json({ version: "0.1.3", artifacts: {} }),
        ),
        open: vi.fn(async () => undefined),
      });

      await expect(
        bootstrapCompanion({ supportPath: "/raycast/support" }),
      ).resolves.toEqual({
        status: "unsupported-platform",
        platformKey,
      });
    },
  );

  it("shares one bootstrap pipeline for concurrent requests to the same target", async () => {
    const expectedHash =
      "4b9a4ac59f3c3aa32273260df6cf4bf358d1c46f8415126aa35b6380d0abb8f7";
    const fetch = vi.fn(async () =>
      Response.json({
        version: "0.1.10",
        artifacts: {
          "darwin-arm64": {
            url: "https://example.test/companion.zip",
            sha256: expectedHash,
            entrypoint: "CodePulse Companion.app",
          },
        },
      }),
    );
    const downloadFile = vi.fn(async () => ({ sha256: expectedHash }));

    __testing__.setDeps({
      platform: "darwin",
      arch: "arm64",
      packageVersion: "0.1.10",
      access: vi.fn(async () => {
        throw new Error("ENOENT");
      }),
      fetch,
      downloadFile,
      mkdir: vi.fn(async () => undefined),
      rm: vi.fn(async () => undefined),
      rename: vi.fn(async () => undefined),
      extractZip: vi.fn(async () => undefined),
      open: vi.fn(async () => undefined),
    });

    const [first, second] = await Promise.all([
      bootstrapCompanion({ supportPath: "/raycast/support" }),
      bootstrapCompanion({ supportPath: "/raycast/support" }),
    ]);

    expect(first).toEqual(second);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(downloadFile).toHaveBeenCalledTimes(1);
  });

  it("runs different manifest sources separately and serializes writes to the same target", async () => {
    const expectedHash =
      "4b9a4ac59f3c3aa32273260df6cf4bf358d1c46f8415126aa35b6380d0abb8f7";
    let releaseFirstDownload: (() => void) | undefined;
    let notifyFirstDownload: (() => void) | undefined;
    const firstDownloadStarted = new Promise<void>((resolve) => {
      notifyFirstDownload = resolve;
    });
    const firstDownloadGate = new Promise<void>((resolve) => {
      releaseFirstDownload = resolve;
    });
    let activeDownloads = 0;
    let maxActiveDownloads = 0;
    let installed = false;
    const fetch = vi.fn(async (manifestUrl: string) =>
      Response.json({
        version: "0.1.10",
        artifacts: {
          "darwin-arm64": {
            url: `${manifestUrl}/companion.zip`,
            sha256: expectedHash,
            entrypoint: "CodePulse Companion.app",
          },
        },
      }),
    );
    const downloadFile = vi.fn(async () => {
      activeDownloads += 1;
      maxActiveDownloads = Math.max(maxActiveDownloads, activeDownloads);
      if (downloadFile.mock.calls.length === 1) {
        notifyFirstDownload?.();
        await firstDownloadGate;
      }
      activeDownloads -= 1;
      return { sha256: expectedHash };
    });

    __testing__.setDeps({
      platform: "darwin",
      arch: "arm64",
      packageVersion: "0.1.10",
      access: vi.fn(async () => {
        if (!installed) throw new Error("ENOENT");
      }),
      fetch,
      downloadFile,
      mkdir: vi.fn(async () => undefined),
      rm: vi.fn(async () => undefined),
      rename: vi.fn(async (_source: string, destination: string) => {
        if (destination === "/raycast/support/companion/0.1.10/darwin-arm64") {
          installed = true;
        }
      }),
      extractZip: vi.fn(async () => undefined),
      open: vi.fn(async () => undefined),
    });

    const first = bootstrapCompanion({
      supportPath: "/raycast/support",
      manifestUrl: "https://example.test/manifest-a.json",
    });
    await firstDownloadStarted;
    const second = bootstrapCompanion({
      supportPath: "/raycast/support",
      manifestUrl: "https://example.test/manifest-b.json",
    });

    await Promise.resolve();
    expect(downloadFile).toHaveBeenCalledTimes(1);
    releaseFirstDownload?.();
    await Promise.all([first, second]);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://example.test/manifest-a.json",
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://example.test/manifest-b.json",
    );
    expect(downloadFile).toHaveBeenCalledTimes(2);
    expect(maxActiveDownloads).toBe(1);
  });

  it("rejects a manifest version that cannot be a safe install directory", async () => {
    const rm = vi.fn(
      async (
        _target: string,
        _options?: { recursive?: boolean; force?: boolean },
      ) => {
        void _target;
        void _options;
      },
    );
    const downloadFile = vi.fn(async () => ({ sha256: "expected" }));

    __testing__.setDeps({
      platform: "darwin",
      arch: "arm64",
      packageVersion: "0.1.10",
      access: vi.fn(async () => {
        throw new Error("ENOENT");
      }),
      fetch: vi.fn(async () =>
        Response.json({
          version: "../outside",
          artifacts: {
            "darwin-arm64": {
              url: "https://example.test/companion.zip",
              sha256: "expected",
              entrypoint: "CodePulse Companion.app",
            },
          },
        }),
      ),
      mkdir: vi.fn(async () => undefined),
      rm,
      downloadFile,
      rename: vi.fn(async () => undefined),
      extractZip: vi.fn(async () => undefined),
      open: vi.fn(async () => undefined),
    });

    await expect(
      bootstrapCompanion({ supportPath: "/raycast/support" }),
    ).resolves.toMatchObject({ status: "install-failed" });

    expect(downloadFile).not.toHaveBeenCalled();
    expect(
      rm.mock.calls.some(([target]) => String(target).includes("outside")),
    ).toBe(false);
  });

  it("does not extract or launch when the downloaded zip hash mismatches", async () => {
    const expectedHash =
      "4b9a4ac59f3c3aa32273260df6cf4bf358d1c46f8415126aa35b6380d0abb8f7";
    const mkdir = vi.fn(async () => undefined);
    const rm = vi.fn(
      async (
        _target: string,
        _options?: { recursive?: boolean; force?: boolean },
      ) => {
        void _target;
        void _options;
      },
    );
    const downloadFile = vi.fn(async () => ({ sha256: "actual" }));
    const extractZip = vi.fn(async () => undefined);
    const open = vi.fn(async () => undefined);

    __testing__.setDeps({
      platform: "darwin",
      arch: "arm64",
      packageVersion: "0.1.3",
      access: vi.fn(async () => {
        throw new Error("ENOENT");
      }),
      fetch: vi.fn().mockResolvedValueOnce(
        Response.json({
          version: "0.1.3",
          artifacts: {
            "darwin-arm64": {
              url: "https://example.test/companion.zip",
              sha256: expectedHash,
              entrypoint: "CodePulse Companion.app",
            },
          },
        }),
      ),
      mkdir,
      rm,
      downloadFile,
      extractZip,
      open,
    });

    await expect(
      bootstrapCompanion({ supportPath: "/raycast/support" }),
    ).resolves.toMatchObject({
      status: "hash-mismatch",
      expected: expectedHash,
    });

    expect(downloadFile).toHaveBeenCalledWith(
      "https://example.test/companion.zip",
      "/raycast/support/companion/downloads/0.1.3-darwin-arm64.zip.part",
      expect.any(Function),
    );
    expect(rm).toHaveBeenCalledWith(
      "/raycast/support/companion/downloads/0.1.3-darwin-arm64.zip.part",
      { force: true },
    );
    expect(extractZip).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("accepts an uppercase manifest SHA-256 digest", async () => {
    const downloadedHash =
      "4b9a4ac59f3c3aa32273260df6cf4bf358d1c46f8415126aa35b6380d0abb8f7";
    const manifestHash = downloadedHash.toUpperCase();

    __testing__.setDeps({
      platform: "darwin",
      arch: "arm64",
      packageVersion: "0.1.10",
      access: vi.fn(async () => {
        throw new Error("ENOENT");
      }),
      fetch: vi.fn(async () =>
        Response.json({
          version: "0.1.10",
          artifacts: {
            "darwin-arm64": {
              url: "https://example.test/companion.zip",
              sha256: manifestHash,
              entrypoint: "CodePulse Companion.app",
            },
          },
        }),
      ),
      downloadFile: vi.fn(async () => ({ sha256: downloadedHash })),
      mkdir: vi.fn(async () => undefined),
      rm: vi.fn(async () => undefined),
      rename: vi.fn(async () => undefined),
      extractZip: vi.fn(async () => undefined),
      open: vi.fn(async () => undefined),
    });

    await expect(
      bootstrapCompanion({ supportPath: "/raycast/support" }),
    ).resolves.toMatchObject({ status: "launched" });
  });

  it("reports install-failed without extracting or launching when streaming the artifact fails", async () => {
    const expectedHash =
      "4b9a4ac59f3c3aa32273260df6cf4bf358d1c46f8415126aa35b6380d0abb8f7";
    const downloadFile = vi.fn(async () => {
      throw new Error("EACCES: support path is not writable");
    });
    const mkdir = vi.fn(async () => undefined);
    const extractZip = vi.fn(async () => undefined);
    const open = vi.fn(async () => undefined);

    __testing__.setDeps({
      platform: "darwin",
      arch: "arm64",
      packageVersion: "0.1.3",
      access: vi.fn(async () => {
        throw new Error("ENOENT");
      }),
      fetch: vi.fn().mockResolvedValueOnce(
        Response.json({
          version: "0.1.3",
          artifacts: {
            "darwin-arm64": {
              url: "https://example.test/companion.zip",
              sha256: expectedHash,
              entrypoint: "CodePulse Companion.app",
            },
          },
        }),
      ),
      mkdir,
      downloadFile,
      extractZip,
      open,
    });

    await expect(
      bootstrapCompanion({ supportPath: "/raycast/support" }),
    ).resolves.toEqual({
      status: "install-failed",
      message: "EACCES: support path is not writable",
    });

    expect(downloadFile).toHaveBeenCalledWith(
      "https://example.test/companion.zip",
      "/raycast/support/companion/downloads/0.1.3-darwin-arm64.zip.part",
      expect.any(Function),
    );
    expect(extractZip).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("streams, verifies, extracts, and launches a valid artifact", async () => {
    const expectedHash =
      "4b9a4ac59f3c3aa32273260df6cf4bf358d1c46f8415126aa35b6380d0abb8f7";
    const downloadFile = vi.fn(
      async (
        _url: string,
        _destinationPath: string,
        onProgress?: (progress: {
          downloadedBytes: number;
          totalBytes?: number;
        }) => void,
      ) => {
        onProgress?.({
          downloadedBytes: 1024 * 1024,
          totalBytes: 2 * 1024 * 1024,
        });
        return { sha256: expectedHash };
      },
    );
    const mkdir = vi.fn(async () => undefined);
    const rm = vi.fn(
      async (
        _target: string,
        _options?: { recursive?: boolean; force?: boolean },
      ) => {
        void _target;
        void _options;
      },
    );
    const rename = vi.fn(async () => undefined);
    const extractZip = vi.fn(async () => undefined);
    const open = vi.fn(async () => undefined);
    const onProgress = vi.fn();

    __testing__.setDeps({
      platform: "darwin",
      arch: "arm64",
      packageVersion: "0.1.3",
      access: vi.fn(async () => {
        throw new Error("ENOENT");
      }),
      fetch: vi.fn().mockResolvedValueOnce(
        Response.json({
          version: "0.1.3",
          artifacts: {
            "darwin-arm64": {
              url: "https://example.test/companion.zip",
              sha256: expectedHash,
              entrypoint: "CodePulse Companion.app",
            },
          },
        }),
      ),
      mkdir,
      downloadFile,
      rm,
      rename,
      extractZip,
      open,
    });

    await expect(
      bootstrapCompanion({ supportPath: "/raycast/support", onProgress }),
    ).resolves.toMatchObject({
      status: "launched",
      path: "/raycast/support/companion/0.1.3/darwin-arm64/CodePulse Companion.app",
    });

    expect(mkdir).toHaveBeenCalledWith("/raycast/support/companion/downloads", {
      recursive: true,
    });
    expect(downloadFile).toHaveBeenCalledWith(
      "https://example.test/companion.zip",
      "/raycast/support/companion/downloads/0.1.3-darwin-arm64.zip.part",
      expect.any(Function),
    );
    expect(onProgress).toHaveBeenCalledWith({
      stage: "fetching-manifest",
      manifestUrl:
        "https://github.com/wangruqing723/codePulse/releases/download/codepulse-companion-latest/codepulse-companion-manifest.json",
    });
    expect(onProgress).toHaveBeenCalledWith({
      stage: "downloading",
      downloadedBytes: 1024 * 1024,
      totalBytes: 2 * 1024 * 1024,
    });
    expect(onProgress).toHaveBeenCalledWith({ stage: "extracting" });
    expect(onProgress).toHaveBeenCalledWith({ stage: "launching" });
    expect(rename).toHaveBeenCalledWith(
      "/raycast/support/companion/downloads/0.1.3-darwin-arm64.zip.part",
      "/raycast/support/companion/downloads/0.1.3-darwin-arm64.zip",
    );
    expect(mkdir.mock.invocationCallOrder[0]).toBeLessThan(
      downloadFile.mock.invocationCallOrder[0],
    );
    expect(extractZip).toHaveBeenCalled();
    expect(rename).toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(
      "/raycast/support/companion/0.1.3/darwin-arm64/CodePulse Companion.app",
    );
  });

  it("cleans only validated obsolete installs after a successful launch", async () => {
    const expectedHash =
      "4b9a4ac59f3c3aa32273260df6cf4bf358d1c46f8415126aa35b6380d0abb8f7";
    const companionRoot = "/raycast/support/companion";
    const downloadsRoot = `${companionRoot}/downloads`;
    const rm = vi.fn(
      async (
        _target: string,
        _options?: { recursive?: boolean; force?: boolean },
      ) => {
        void _target;
        void _options;
      },
    );
    const rootEntries = [
      dirent("0.1.5", "directory"),
      dirent("0.1.6", "directory"),
      dirent("0.1.7", "directory"),
      dirent("0.1.8", "symlink"),
      dirent("0.1.9", "directory"),
      dirent("0.1.10", "directory"),
      dirent("0.2.0", "directory"),
      dirent("downloads", "directory"),
      dirent("notes.txt", "file"),
    ];
    const downloadEntries = [
      dirent("0.1.7-darwin-arm64.zip", "file"),
      dirent("0.1.9-darwin-arm64.zip", "file"),
      dirent("0.1.10-darwin-arm64.zip", "file"),
      dirent("0.2.0-darwin-arm64.zip", "file"),
      dirent("0.1.8-darwin-arm64.zip.part", "file"),
      dirent("0.1.8-win32-x64.zip", "file"),
      dirent("notes.txt", "file"),
    ];

    __testing__.setDeps({
      platform: "darwin",
      arch: "arm64",
      packageVersion: "0.1.10",
      access: vi.fn(async () => {
        throw new Error("ENOENT");
      }),
      fetch: vi.fn(async () =>
        Response.json({
          version: "0.1.10",
          artifacts: {
            "darwin-arm64": {
              url: "https://example.test/companion.zip",
              sha256: expectedHash,
              entrypoint: "CodePulse Companion.app",
            },
          },
        }),
      ),
      mkdir: vi.fn(async () => undefined),
      rm,
      downloadFile: vi.fn(async () => ({ sha256: expectedHash })),
      rename: vi.fn(async () => undefined),
      extractZip: vi.fn(async () => undefined),
      open: vi.fn(async () => undefined),
      readdir: vi.fn(async (target: string) =>
        target === downloadsRoot ? downloadEntries : rootEntries,
      ),
      lstat: vi.fn(async (target: string) => ({
        isDirectory: () => !target.endsWith(".zip"),
        isFile: () => target.endsWith(".zip"),
        isSymbolicLink: () => false,
      })),
      realpath: vi.fn(async (target: string) =>
        target === `${companionRoot}/0.1.5` ? "/outside/0.1.5" : target,
      ),
      readCompanionProcessRecord: vi.fn(async () => ({
        pid: 42,
        startedAt: "2026-07-12T00:00:00.000Z",
        platform: "darwin",
        mode: "packaged",
        execPath: `${companionRoot}/0.1.7/darwin-arm64/CodePulse Companion.app/Contents/MacOS/CodePulse Companion`,
        argv: [],
      })),
    } as never);

    const result = await bootstrapCompanion({
      supportPath: "/raycast/support",
    });
    const removedTargets = rm.mock.calls.map(([target]) => String(target));

    expect(result).toMatchObject({ status: "launched" });
    expect(result.status === "launched" && result.cleanup?.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("0.1.5"),
        expect.stringContaining("0.1.8"),
      ]),
    );
    expect(removedTargets).toContain(`${companionRoot}/0.1.6`);
    expect(removedTargets).not.toContain(`${companionRoot}/0.1.5`);
    expect(removedTargets).not.toContain(`${companionRoot}/0.1.7`);
    expect(removedTargets).not.toContain(`${companionRoot}/0.1.8`);
    expect(removedTargets).not.toContain(`${companionRoot}/0.1.9`);
    expect(
      removedTargets.filter(
        (target) => target === `${companionRoot}/0.1.10/darwin-arm64`,
      ),
    ).toHaveLength(1);
    expect(removedTargets).not.toContain(`${companionRoot}/0.2.0`);
    expect(removedTargets).toEqual(
      expect.arrayContaining([
        `${downloadsRoot}/0.1.7-darwin-arm64.zip`,
        `${downloadsRoot}/0.1.9-darwin-arm64.zip`,
        `${downloadsRoot}/0.1.10-darwin-arm64.zip`,
      ]),
    );
    expect(removedTargets).not.toContain(
      `${downloadsRoot}/0.2.0-darwin-arm64.zip`,
    );
    expect(removedTargets).not.toContain(
      `${downloadsRoot}/0.1.8-darwin-arm64.zip.part`,
    );
    expect(removedTargets).not.toContain(
      `${downloadsRoot}/0.1.8-win32-x64.zip`,
    );
  });

  it("installs the latest companion even when its version differs from the extension version", async () => {
    // 扩展升到 0.1.20，但 companion 最新仍是 0.1.10：应正常安装 0.1.10，
    // 不再因版本不匹配报错。
    const expectedHash =
      "4b9a4ac59f3c3aa32273260df6cf4bf358d1c46f8415126aa35b6380d0abb8f7";
    const downloadFile = vi.fn(async () => ({ sha256: expectedHash }));
    const rename = vi.fn(async () => undefined);
    const open = vi.fn(async () => undefined);

    __testing__.setDeps({
      platform: "darwin",
      arch: "arm64",
      packageVersion: "0.1.20",
      access: vi.fn(async () => {
        throw new Error("ENOENT");
      }),
      fetch: vi.fn(async () =>
        Response.json({
          version: "0.1.10",
          artifacts: {
            "darwin-arm64": {
              url: "https://example.test/companion.zip",
              sha256: expectedHash,
              entrypoint: "CodePulse Companion.app",
            },
          },
        }),
      ),
      mkdir: vi.fn(async () => undefined),
      rm: vi.fn(async () => undefined),
      downloadFile,
      rename,
      extractZip: vi.fn(async () => undefined),
      open,
    });

    await expect(
      bootstrapCompanion({ supportPath: "/raycast/support" }),
    ).resolves.toMatchObject({
      status: "launched",
      path: "/raycast/support/companion/0.1.10/darwin-arm64/CodePulse Companion.app",
    });

    // 安装目录与下载包用 companion 自身版本命名，而非扩展版本。
    expect(downloadFile).toHaveBeenCalledWith(
      "https://example.test/companion.zip",
      "/raycast/support/companion/downloads/0.1.10-darwin-arm64.zip.part",
      expect.any(Function),
    );
    expect(open).toHaveBeenCalledWith(
      "/raycast/support/companion/0.1.10/darwin-arm64/CodePulse Companion.app",
    );
  });

  it("falls back to the newest installed companion when the manifest is unavailable", async () => {
    const open = vi.fn(async () => undefined);
    const companionRoot = "/raycast/support/companion";

    __testing__.setDeps({
      platform: "darwin",
      arch: "arm64",
      packageVersion: "0.1.20",
      // manifest 拉取失败（离线）。
      fetch: vi.fn(async () => new Response("boom", { status: 500 })),
      access: vi.fn(async (filePath: string) => {
        if (
          filePath ===
          `${companionRoot}/0.1.10/darwin-arm64/CodePulse Companion.app`
        ) {
          return;
        }
        throw new Error("ENOENT");
      }),
      readdir: vi.fn(async () => [
        dirent("0.1.6", "directory"),
        dirent("0.1.10", "directory"),
        dirent("downloads", "directory"),
      ]),
      lstat: vi.fn(async () => ({
        isDirectory: () => true,
        isFile: () => false,
        isSymbolicLink: () => false,
      })),
      realpath: vi.fn(async (target: string) => target),
      readCompanionProcessRecord: vi.fn(async () => undefined),
      rm: vi.fn(async () => undefined),
      open,
    } as never);

    await expect(
      bootstrapCompanion({ supportPath: "/raycast/support" }),
    ).resolves.toMatchObject({
      status: "launched",
      path: `${companionRoot}/0.1.10/darwin-arm64/CodePulse Companion.app`,
    });
    expect(open).toHaveBeenCalledWith(
      `${companionRoot}/0.1.10/darwin-arm64/CodePulse Companion.app`,
    );
  });

  it("skips every deletion when the Companion root is a symbolic link", async () => {
    const companionRoot = "/raycast/support/companion";
    const outsideRoot = "/outside/companion";
    const rm = vi.fn(async () => undefined);

    const result = await cleanupCompanionInstall(
      {
        supportPath: "/raycast/support",
        currentVersion: "0.1.10",
        platformKey: "darwin-arm64",
      },
      {
        readdir: vi.fn(async (target: string) =>
          target === `${companionRoot}/downloads`
            ? [dirent("0.1.6-darwin-arm64.zip", "file")]
            : [
                dirent("0.1.6", "directory"),
                dirent("0.1.9", "directory"),
                dirent("downloads", "directory"),
              ],
        ),
        lstat: vi.fn(async (target: string) => ({
          isDirectory: () => target !== companionRoot,
          isFile: () => target.endsWith(".zip"),
          isSymbolicLink: () => target === companionRoot,
        })),
        realpath: vi.fn(async (target: string) => {
          if (target === "/raycast/support") return target;
          return target.replace(companionRoot, outsideRoot);
        }),
        rm,
      },
    );

    expect(result.removedPaths).toEqual([]);
    expect(result.warnings).toEqual([
      expect.stringContaining("Companion 根目录"),
    ]);
    expect(rm).not.toHaveBeenCalled();
  });

  it("skips every deletion when the Companion root resolves outside supportPath", async () => {
    const companionRoot = "/raycast/support/companion";
    const rm = vi.fn(async () => undefined);

    const result = await cleanupCompanionInstall(
      {
        supportPath: "/raycast/support",
        currentVersion: "0.1.10",
        platformKey: "darwin-arm64",
      },
      {
        readdir: vi.fn(async () => [
          dirent("0.1.6", "directory"),
          dirent("0.1.9", "directory"),
        ]),
        lstat: vi.fn(async () => ({
          isDirectory: () => true,
          isFile: () => false,
          isSymbolicLink: () => false,
        })),
        realpath: vi.fn(async (target: string) =>
          target === companionRoot ? "/outside/companion" : target,
        ),
        rm,
      },
    );

    expect(result.removedPaths).toEqual([]);
    expect(result.warnings).toEqual([
      expect.stringContaining("越出 supportPath"),
    ]);
    expect(rm).not.toHaveBeenCalled();
  });

  it("cleans obsolete installs after launching an already installed version", async () => {
    const expectedHash =
      "4b9a4ac59f3c3aa32273260df6cf4bf358d1c46f8415126aa35b6380d0abb8f7";
    const companionRoot = "/raycast/support/companion";
    const downloadsRoot = `${companionRoot}/downloads`;
    const obsoletePath = `${companionRoot}/0.1.6`;
    const rm = vi.fn(async () => undefined);
    const downloadFile = vi.fn();
    const fetch = vi.fn(async () =>
      Response.json({
        version: "0.1.10",
        artifacts: {
          "darwin-arm64": {
            url: "https://example.test/companion.zip",
            sha256: expectedHash,
            entrypoint: "CodePulse Companion.app",
          },
        },
      }),
    );

    __testing__.setDeps({
      platform: "darwin",
      arch: "arm64",
      packageVersion: "0.1.10",
      access: vi.fn(async () => undefined),
      fetch,
      downloadFile,
      open: vi.fn(async () => undefined),
      rm,
      readdir: vi.fn(async (target: string) =>
        target === downloadsRoot
          ? []
          : [
              dirent("0.1.6", "directory"),
              dirent("0.1.9", "directory"),
              dirent("0.1.10", "directory"),
              dirent("downloads", "directory"),
            ],
      ),
      lstat: vi.fn(async (target: string) => ({
        isDirectory: () => !target.endsWith(".zip"),
        isFile: () => target.endsWith(".zip"),
        isSymbolicLink: () => false,
      })),
      realpath: vi.fn(async (target: string) => target),
      readCompanionProcessRecord: vi.fn(async () => undefined),
    } as never);

    const result = await bootstrapCompanion({
      supportPath: "/raycast/support",
    });

    expect(result).toMatchObject({
      status: "launched",
      cleanup: { removedPaths: [obsoletePath] },
    });
    expect(downloadFile).not.toHaveBeenCalled();
    expect(rm).toHaveBeenCalledWith(obsoletePath, {
      recursive: true,
      force: true,
    });
  });

  it("keeps every old install when the running version cannot be verified", async () => {
    const expectedHash =
      "4b9a4ac59f3c3aa32273260df6cf4bf358d1c46f8415126aa35b6380d0abb8f7";
    const companionRoot = "/raycast/support/companion";
    const downloadsRoot = `${companionRoot}/downloads`;
    const rm = vi.fn(
      async (
        _target: string,
        _options?: { recursive?: boolean; force?: boolean },
      ) => {
        void _target;
        void _options;
      },
    );

    __testing__.setDeps({
      platform: "darwin",
      arch: "arm64",
      packageVersion: "0.1.10",
      access: vi.fn(async () => {
        throw new Error("ENOENT");
      }),
      fetch: vi.fn(async () =>
        Response.json({
          version: "0.1.10",
          artifacts: {
            "darwin-arm64": {
              url: "https://example.test/companion.zip",
              sha256: expectedHash,
              entrypoint: "CodePulse Companion.app",
            },
          },
        }),
      ),
      mkdir: vi.fn(async () => undefined),
      rm,
      downloadFile: vi.fn(async () => ({ sha256: expectedHash })),
      rename: vi.fn(async () => undefined),
      extractZip: vi.fn(async () => undefined),
      open: vi.fn(async () => undefined),
      readdir: vi.fn(async (target: string) =>
        target === downloadsRoot
          ? []
          : [
              dirent("0.1.6", "directory"),
              dirent("0.1.9", "directory"),
              dirent("0.1.10", "directory"),
              dirent("downloads", "directory"),
            ],
      ),
      lstat: vi.fn(async (target: string) => ({
        isDirectory: () => !target.endsWith(".zip"),
        isFile: () => target.endsWith(".zip"),
        isSymbolicLink: () => false,
      })),
      realpath: vi.fn(async (target: string) => target),
      readCompanionProcessRecord: vi.fn(async () => {
        throw new Error("process inspection unavailable");
      }),
    } as never);

    const result = await bootstrapCompanion({
      supportPath: "/raycast/support",
    });
    const removedTargets = rm.mock.calls.map(([target]) => String(target));

    expect(result).toMatchObject({
      status: "launched",
      cleanup: {
        warnings: [expect.stringContaining("运行中的 Companion")],
      },
    });
    expect(removedTargets).not.toContain(`${companionRoot}/0.1.6`);
    expect(removedTargets).not.toContain(`${companionRoot}/0.1.9`);
  });

  it("rechecks an old install immediately before deleting it", async () => {
    const expectedHash =
      "4b9a4ac59f3c3aa32273260df6cf4bf358d1c46f8415126aa35b6380d0abb8f7";
    const companionRoot = "/raycast/support/companion";
    const downloadsRoot = `${companionRoot}/downloads`;
    const obsoletePath = `${companionRoot}/0.1.6`;
    const rm = vi.fn(
      async (
        _target: string,
        _options?: { recursive?: boolean; force?: boolean },
      ) => {
        void _target;
        void _options;
      },
    );
    let obsoleteRealpathChecks = 0;

    __testing__.setDeps({
      platform: "darwin",
      arch: "arm64",
      packageVersion: "0.1.10",
      access: vi.fn(async () => {
        throw new Error("ENOENT");
      }),
      fetch: vi.fn(async () =>
        Response.json({
          version: "0.1.10",
          artifacts: {
            "darwin-arm64": {
              url: "https://example.test/companion.zip",
              sha256: expectedHash,
              entrypoint: "CodePulse Companion.app",
            },
          },
        }),
      ),
      mkdir: vi.fn(async () => undefined),
      rm,
      downloadFile: vi.fn(async () => ({ sha256: expectedHash })),
      rename: vi.fn(async () => undefined),
      extractZip: vi.fn(async () => undefined),
      open: vi.fn(async () => undefined),
      readdir: vi.fn(async (target: string) =>
        target === downloadsRoot
          ? []
          : [
              dirent("0.1.6", "directory"),
              dirent("0.1.9", "directory"),
              dirent("0.1.10", "directory"),
              dirent("downloads", "directory"),
            ],
      ),
      lstat: vi.fn(async (target: string) => ({
        isDirectory: () => !target.endsWith(".zip"),
        isFile: () => target.endsWith(".zip"),
        isSymbolicLink: () => false,
      })),
      realpath: vi.fn(async (target: string) => {
        if (target === obsoletePath) {
          obsoleteRealpathChecks += 1;
          return obsoleteRealpathChecks === 1 ? obsoletePath : "/outside/0.1.6";
        }
        return target;
      }),
      readCompanionProcessRecord: vi.fn(async () => undefined),
    } as never);

    const result = await bootstrapCompanion({
      supportPath: "/raycast/support",
    });
    const removedTargets = rm.mock.calls.map(([target]) => String(target));

    expect(result).toMatchObject({ status: "launched" });
    expect(result.status === "launched" && result.cleanup?.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("0.1.6")]),
    );
    expect(obsoleteRealpathChecks).toBe(2);
    expect(removedTargets).not.toContain(obsoletePath);
  });
});
