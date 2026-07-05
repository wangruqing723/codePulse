import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bootstrapCompanion,
  getPlatformKey,
  resolveCompanionManifestUrl,
  __testing__,
} from "./launch-control";

describe("companion bootstrap launch control", () => {
  beforeEach(() => {
    __testing__.resetDeps();
  });

  it("opens an already installed supportPath companion without downloading", async () => {
    const fetch = vi.fn();
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
      open,
    });

    await expect(
      bootstrapCompanion({ supportPath: "/raycast/support" }),
    ).resolves.toEqual({
      status: "launched",
      path: "/raycast/support/companion/0.1.3/darwin-arm64/CodePulse Companion.app",
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(
      "/raycast/support/companion/0.1.3/darwin-arm64/CodePulse Companion.app",
    );
  });

  it("uses the platform-arch supportPath contract for Windows companion installs", async () => {
    const fetch = vi.fn();
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
      open,
    });

    expect(getPlatformKey("win32", "x64")).toBe("win32-x64");

    await expect(
      bootstrapCompanion({ supportPath: "C:\\Raycast\\Support" }),
    ).resolves.toEqual({
      status: "launched",
      path: "C:\\Raycast\\Support\\companion\\0.1.3\\win32-x64\\CodePulse Companion.exe",
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(
      "C:\\Raycast\\Support\\companion\\0.1.3\\win32-x64\\CodePulse Companion.exe",
    );
  });

  it("derives a public manifest URL from the current repo and release tag", () => {
    expect(
      resolveCompanionManifestUrl({
        packageVersion: "0.1.3",
        releaseTag: undefined,
        manifestUrl: undefined,
      }),
    ).toBe(
      "https://github.com/wangruqing723/codePulse/releases/download/codepulse-companion-v0.1.3/codepulse-companion-manifest.json",
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
      open: vi.fn(async () => undefined),
    });

    await expect(
      bootstrapCompanion({ supportPath: "/raycast/support" }),
    ).resolves.toMatchObject({ status: "release-unavailable" });
  });

  it("reports unsupported-platform when the manifest has no platform artifact", async () => {
    __testing__.setDeps({
      platform: "linux",
      arch: "x64",
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
      platformKey: "linux-x64",
    });
  });

  it("does not extract or launch when the downloaded zip hash mismatches", async () => {
    const rm = vi.fn(async () => undefined);
    const extractZip = vi.fn(async () => undefined);
    const open = vi.fn(async () => undefined);

    __testing__.setDeps({
      platform: "darwin",
      arch: "arm64",
      packageVersion: "0.1.3",
      access: vi.fn(async () => {
        throw new Error("ENOENT");
      }),
      fetch: vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            version: "0.1.3",
            artifacts: {
              "darwin-arm64": {
                url: "https://example.test/companion.zip",
                sha256: "expected",
                entrypoint: "CodePulse Companion.app",
              },
            },
          }),
        )
        .mockResolvedValueOnce(new Response("zip-bytes")),
      rm,
      extractZip,
      open,
    });

    await expect(
      bootstrapCompanion({ supportPath: "/raycast/support" }),
    ).resolves.toMatchObject({ status: "hash-mismatch", expected: "expected" });

    expect(rm).toHaveBeenCalled();
    expect(extractZip).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("reports install-failed without extracting or launching when writing the artifact fails", async () => {
    const zipBytes = new TextEncoder().encode("zip-bytes");
    const expectedHash =
      "4b9a4ac59f3c3aa32273260df6cf4bf358d1c46f8415126aa35b6380d0abb8f7";
    const writeFile = vi.fn(async () => {
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
      fetch: vi
        .fn()
        .mockResolvedValueOnce(
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
        )
        .mockResolvedValueOnce(new Response(zipBytes)),
      mkdir,
      writeFile,
      extractZip,
      open,
    });

    await expect(
      bootstrapCompanion({ supportPath: "/raycast/support" }),
    ).resolves.toEqual({
      status: "install-failed",
      message: "EACCES: support path is not writable",
    });

    expect(writeFile).toHaveBeenCalled();
    expect(extractZip).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("downloads, verifies, extracts, and launches a valid artifact", async () => {
    const zipBytes = new TextEncoder().encode("zip-bytes");
    const expectedHash =
      "4b9a4ac59f3c3aa32273260df6cf4bf358d1c46f8415126aa35b6380d0abb8f7";
    const writeFile = vi.fn(async () => undefined);
    const mkdir = vi.fn(async () => undefined);
    const rm = vi.fn(async () => undefined);
    const rename = vi.fn(async () => undefined);
    const extractZip = vi.fn(async () => undefined);
    const open = vi.fn(async () => undefined);

    __testing__.setDeps({
      platform: "darwin",
      arch: "arm64",
      packageVersion: "0.1.3",
      access: vi.fn(async () => {
        throw new Error("ENOENT");
      }),
      fetch: vi
        .fn()
        .mockResolvedValueOnce(
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
        )
        .mockResolvedValueOnce(new Response(zipBytes)),
      mkdir,
      writeFile,
      rm,
      rename,
      extractZip,
      open,
    });

    await expect(
      bootstrapCompanion({ supportPath: "/raycast/support" }),
    ).resolves.toEqual({
      status: "launched",
      path: "/raycast/support/companion/0.1.3/darwin-arm64/CodePulse Companion.app",
    });

    expect(extractZip).toHaveBeenCalled();
    expect(rename).toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(
      "/raycast/support/companion/0.1.3/darwin-arm64/CodePulse Companion.app",
    );
  });
});
