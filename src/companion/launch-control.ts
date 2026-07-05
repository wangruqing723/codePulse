import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { promisify } from "node:util";
import { environment, open } from "@raycast/api";
import packageJson from "../../package.json";

const REPO_RELEASE_BASE =
  "https://github.com/wangruqing723/codePulse/releases/download";
const execFileAsync = promisify(execFile);

interface CompanionReleaseArtifact {
  url: string;
  sha256: string;
  entrypoint: string;
}

export interface CompanionReleaseManifest {
  version: string;
  artifacts: Record<string, CompanionReleaseArtifact>;
}

export type CompanionBootstrapResult =
  | { status: "launched"; path: string }
  | { status: "release-unavailable"; message?: string }
  | { status: "unsupported-platform"; platformKey: string }
  | { status: "hash-mismatch"; expected: string; actual: string }
  | { status: "install-failed"; message: string };

export type CompanionLaunchResult =
  | {
      status: "launched";
      path: string;
    }
  | {
      status: "not-found";
    };

export interface ManifestUrlOptions {
  packageVersion: string;
  releaseTag?: string;
  manifestUrl?: string;
}

export interface BootstrapCompanionOptions {
  supportPath: string;
  releaseTag?: string;
  manifestUrl?: string;
  onProgress?: (progress: CompanionBootstrapProgress) => void;
}

interface DownloadFileResult {
  sha256: string;
}

interface DownloadFileProgress {
  downloadedBytes: number;
  totalBytes?: number;
}

export type CompanionBootstrapProgress =
  | { stage: "checking-installed" }
  | { stage: "fetching-manifest"; manifestUrl: string }
  | {
      stage: "downloading";
      downloadedBytes: number;
      totalBytes?: number;
    }
  | { stage: "verifying" }
  | { stage: "extracting" }
  | { stage: "launching" };

interface BootstrapDeps {
  platform: NodeJS.Platform;
  arch: string;
  packageVersion: string;
  access(path: string): Promise<void>;
  fetch(input: string): Promise<Response>;
  downloadFile(
    url: string,
    destinationPath: string,
    onProgress?: (progress: DownloadFileProgress) => void,
  ): Promise<DownloadFileResult | undefined>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  rm(
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  extractZip(
    zipPath: string,
    destinationPath: string,
    platform: NodeJS.Platform,
  ): Promise<void>;
  open(target: string): Promise<void>;
}

async function extractZip(
  zipPath: string,
  destinationPath: string,
  platform: NodeJS.Platform,
): Promise<void> {
  if (platform === "darwin") {
    await execFileAsync("ditto", ["-x", "-k", zipPath, destinationPath]);
    return;
  }

  if (platform === "win32") {
    await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Expand-Archive",
      "-LiteralPath",
      zipPath,
      "-DestinationPath",
      destinationPath,
      "-Force",
    ]);
    return;
  }

  throw new Error(`Unsupported extraction platform: ${platform}`);
}

async function downloadFile(
  url: string,
  destinationPath: string,
  onProgress?: (progress: DownloadFileProgress) => void,
): Promise<DownloadFileResult | undefined> {
  const response = await fetch(url);
  if (!response.ok) return undefined;
  if (!response.body) {
    throw new Error(`Download response did not include a body: ${url}`);
  }

  const contentLength = response.headers.get("content-length");
  const totalBytes = contentLength ? Number(contentLength) : undefined;
  const hash = createHash("sha256");
  const file = createWriteStream(destinationPath, { flags: "w" });
  let downloadedBytes = 0;
  let writeError: unknown;

  file.on("error", (error) => {
    writeError = error;
  });

  try {
    for await (const chunk of Readable.fromWeb(
      response.body as unknown as NodeReadableStream<Uint8Array>,
    )) {
      const bytes =
        chunk instanceof Uint8Array ? chunk : Buffer.from(String(chunk));
      hash.update(bytes);
      downloadedBytes += bytes.byteLength;
      if (!file.write(bytes)) {
        await waitForStreamDrain(file);
      }
      onProgress?.({
        downloadedBytes,
        totalBytes:
          totalBytes && Number.isFinite(totalBytes) ? totalBytes : undefined,
      });
      if (writeError) throw writeError;
    }
  } catch (error) {
    file.destroy();
    throw error;
  }

  file.end();
  await once(file, "finish");
  if (writeError) throw writeError;

  return { sha256: hash.digest("hex") };
}

async function waitForStreamDrain(file: NodeJS.WritableStream): Promise<void> {
  await Promise.race([
    once(file, "drain"),
    once(file, "error").then(([error]) => {
      throw error;
    }),
  ]);
}

function createDefaultDeps(): BootstrapDeps {
  return {
    platform: process.platform,
    arch: process.arch,
    packageVersion: packageJson.version,
    access,
    fetch: async (input) => fetch(input),
    downloadFile,
    mkdir: async (targetPath, options) => {
      await mkdir(targetPath, options);
    },
    writeFile,
    rm,
    rename,
    extractZip,
    open,
  };
}

let deps = createDefaultDeps();

export function getPlatformKey(
  platform: NodeJS.Platform,
  arch: string,
): string {
  return `${platform}-${arch}`;
}

export function resolveCompanionManifestUrl(
  options: ManifestUrlOptions,
): string {
  const override = options.manifestUrl?.trim();
  if (override) return override;

  const tag =
    options.releaseTag?.trim() ||
    `codepulse-companion-v${options.packageVersion}`;
  return `${REPO_RELEASE_BASE}/${tag}/codepulse-companion-manifest.json`;
}

function entrypointForPlatform(platformKey: string): string | undefined {
  if (platformKey === "darwin-arm64") return "CodePulse Companion.app";
  if (platformKey === "win32-x64") return "CodePulse Companion.exe";
  return undefined;
}

function installedEntrypointPath(
  supportPath: string,
  version: string,
  platformKey: string,
): string | undefined {
  const entrypoint = entrypointForPlatform(platformKey);
  if (!entrypoint) return undefined;
  return joinForPlatform(platformKey, supportPath, [
    "companion",
    version,
    platformKey,
    entrypoint,
  ]);
}

function joinForPlatform(
  platformKey: string,
  basePath: string,
  segments: string[],
): string {
  const pathApi = platformKey.startsWith("win32-") ? path.win32 : path;
  return pathApi.join(basePath, ...segments);
}

async function fetchJson(
  url: string,
): Promise<CompanionReleaseManifest | undefined> {
  try {
    const response = await deps.fetch(url);
    if (!response.ok) return undefined;
    return (await response.json()) as CompanionReleaseManifest;
  } catch {
    return undefined;
  }
}

function emitProgress(
  onProgress: BootstrapCompanionOptions["onProgress"],
  progress: CompanionBootstrapProgress,
): void {
  try {
    onProgress?.(progress);
  } catch {
    // Progress UI must never interrupt the install pipeline.
  }
}

export async function bootstrapCompanion(
  options: BootstrapCompanionOptions,
): Promise<CompanionBootstrapResult> {
  const platformKey = getPlatformKey(deps.platform, deps.arch);
  emitProgress(options.onProgress, { stage: "checking-installed" });
  const installed = installedEntrypointPath(
    options.supportPath,
    deps.packageVersion,
    platformKey,
  );

  if (installed) {
    try {
      await deps.access(installed);
      await deps.open(installed);
      return { status: "launched", path: installed };
    } catch {
      // Fall through to public release manifest download.
    }
  }

  const manifestUrl = resolveCompanionManifestUrl({
    packageVersion: deps.packageVersion,
    releaseTag: options.releaseTag,
    manifestUrl: options.manifestUrl,
  });
  emitProgress(options.onProgress, { stage: "fetching-manifest", manifestUrl });
  const manifest = await fetchJson(manifestUrl);
  if (!manifest) return { status: "release-unavailable", message: manifestUrl };

  const artifact = manifest.artifacts[platformKey];
  if (!artifact) return { status: "unsupported-platform", platformKey };

  const downloadsDir = joinForPlatform(platformKey, options.supportPath, [
    "companion",
    "downloads",
  ]);
  const zipPath = joinForPlatform(platformKey, downloadsDir, [
    `${manifest.version}-${platformKey}.zip`,
  ]);
  const partialZipPath = `${zipPath}.part`;
  const installDir = joinForPlatform(platformKey, options.supportPath, [
    "companion",
    manifest.version,
    platformKey,
  ]);
  const tempDir = `${installDir}.tmp-${Date.now()}`;
  const entrypointPath = joinForPlatform(platformKey, installDir, [
    artifact.entrypoint,
  ]);

  try {
    await deps.mkdir(downloadsDir, { recursive: true });
    await deps.rm(partialZipPath, { force: true });

    const download = await deps.downloadFile(
      artifact.url,
      partialZipPath,
      (progress) => {
        emitProgress(options.onProgress, {
          stage: "downloading",
          ...progress,
        });
      },
    );
    if (!download) {
      return { status: "release-unavailable", message: artifact.url };
    }

    emitProgress(options.onProgress, { stage: "verifying" });
    if (download.sha256 !== artifact.sha256) {
      await deps.rm(partialZipPath, { force: true });
      await deps.rm(zipPath, { force: true });
      return {
        status: "hash-mismatch",
        expected: artifact.sha256,
        actual: download.sha256,
      };
    }

    await deps.rename(partialZipPath, zipPath);
    await deps.rm(tempDir, { recursive: true, force: true });
    await deps.mkdir(tempDir, { recursive: true });
    emitProgress(options.onProgress, { stage: "extracting" });
    await deps.extractZip(zipPath, tempDir, deps.platform);
    await deps.rm(installDir, { recursive: true, force: true });
    await deps.rename(tempDir, installDir);
    emitProgress(options.onProgress, { stage: "launching" });
    await deps.open(entrypointPath);
    return { status: "launched", path: entrypointPath };
  } catch (error) {
    try {
      await deps.rm(partialZipPath, { force: true });
      await deps.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Preserve the original install failure for the Raycast toast.
    }
    return {
      status: "install-failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function launchCompanionApp(): Promise<CompanionLaunchResult> {
  const result = await bootstrapCompanion({
    supportPath: environment.supportPath,
  });
  if (result.status !== "launched") {
    return { status: "not-found" };
  }

  return result;
}

export const __testing__ = {
  setDeps(nextDeps: Partial<BootstrapDeps>) {
    deps = { ...createDefaultDeps(), ...nextDeps };
  },
  resetDeps() {
    deps = createDefaultDeps();
  },
};
