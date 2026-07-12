import type { Dirent, Stats } from "node:fs";
import path from "node:path";
import type { CompanionProcessRecord } from "./process-control";

const STRICT_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

type VersionParts = readonly [bigint, bigint, bigint];

export interface CompanionCleanupResult {
  removedPaths: string[];
  warnings: string[];
}

export interface CompanionCleanupDeps {
  readdir(
    path: string,
    options: { withFileTypes: true },
  ): Promise<
    Array<Pick<Dirent, "name" | "isDirectory" | "isFile" | "isSymbolicLink">>
  >;
  lstat(
    path: string,
  ): Promise<Pick<Stats, "isDirectory" | "isFile" | "isSymbolicLink">>;
  realpath(path: string): Promise<string>;
  rm(
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ): Promise<void>;
}

export interface CleanupCompanionInstallOptions {
  supportPath: string;
  currentVersion: string;
  platformKey: string;
  runningRecord?: CompanionProcessRecord;
  processInspectionError?: string;
}

function parseStrictVersion(version: string): VersionParts | undefined {
  const match = STRICT_VERSION_PATTERN.exec(version);
  if (!match) {
    return undefined;
  }

  return [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])];
}

export function isStrictCompanionVersion(version: string): boolean {
  return parseStrictVersion(version) !== undefined;
}

function compareVersions(left: VersionParts, right: VersionParts): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

function pathApiForPlatform(platformKey: string): typeof path {
  return platformKey.startsWith("win32-") ? path.win32 : path;
}

function normalizedPath(
  pathApi: typeof path,
  platformKey: string,
  value: string,
): string {
  const normalized = pathApi.resolve(value);
  return platformKey.startsWith("win32-")
    ? normalized.toLowerCase()
    : normalized;
}

function isDirectRealChild(
  pathApi: typeof path,
  platformKey: string,
  root: string,
  candidate: string,
): boolean {
  return (
    normalizedPath(pathApi, platformKey, pathApi.dirname(candidate)) ===
    normalizedPath(pathApi, platformKey, root)
  );
}

function pathContains(
  pathApi: typeof path,
  platformKey: string,
  parent: string,
  candidate: string,
): boolean {
  const relative = pathApi.relative(
    normalizedPath(pathApi, platformKey, parent),
    normalizedPath(pathApi, platformKey, candidate),
  );
  return (
    relative === "" ||
    (!relative.startsWith(`..${pathApi.sep}`) &&
      relative !== ".." &&
      !pathApi.isAbsolute(relative))
  );
}

function recordUsesInstall(
  record: CompanionProcessRecord | undefined,
  pathApi: typeof path,
  platformKey: string,
  installPath: string,
  realInstallPath: string,
): boolean {
  if (!record) {
    return false;
  }

  return [record.execPath, ...record.argv].some(
    (marker) =>
      pathApi.isAbsolute(marker) &&
      (pathContains(pathApi, platformKey, installPath, marker) ||
        pathContains(pathApi, platformKey, realInstallPath, marker)),
  );
}

async function validatedCleanupTarget(
  targetPath: string,
  expectedParentRealPath: string,
  expectedType: "directory" | "file",
  pathApi: typeof path,
  platformKey: string,
  warnings: string[],
  deps: CompanionCleanupDeps,
): Promise<string | undefined> {
  try {
    const info = await deps.lstat(targetPath);
    const typeMatches =
      expectedType === "directory" ? info.isDirectory() : info.isFile();
    if (info.isSymbolicLink() || !typeMatches) {
      warnings.push(`已跳过未通过类型校验的清理目标：${targetPath}`);
      return undefined;
    }

    const realTargetPath = await deps.realpath(targetPath);
    if (
      !isDirectRealChild(
        pathApi,
        platformKey,
        expectedParentRealPath,
        realTargetPath,
      )
    ) {
      warnings.push(`已跳过越出 Companion 目录的清理目标：${targetPath}`);
      return undefined;
    }
    return realTargetPath;
  } catch (error) {
    warnings.push(
      `无法校验清理目标，已保留：${targetPath}（${error instanceof Error ? error.message : String(error)}）`,
    );
    return undefined;
  }
}

async function removeValidatedTarget(
  targetPath: string,
  options: { recursive?: boolean; force: true },
  removedPaths: string[],
  warnings: string[],
  deps: CompanionCleanupDeps,
): Promise<void> {
  try {
    await deps.rm(targetPath, options);
    removedPaths.push(targetPath);
  } catch (error) {
    warnings.push(
      `清理失败，已保留：${targetPath}（${error instanceof Error ? error.message : String(error)}）`,
    );
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function cleanupCompanionInstall(
  {
    supportPath,
    currentVersion,
    platformKey,
    runningRecord,
    processInspectionError,
  }: CleanupCompanionInstallOptions,
  deps: CompanionCleanupDeps,
): Promise<CompanionCleanupResult> {
  const removedPaths: string[] = [];
  const warnings: string[] = [];
  const current = parseStrictVersion(currentVersion);
  if (!current) {
    return {
      removedPaths,
      warnings: [
        `当前 Companion 版本无法安全解析，已跳过清理：${currentVersion}`,
      ],
    };
  }

  const pathApi = pathApiForPlatform(platformKey);
  const companionRoot = pathApi.join(supportPath, "companion");
  let rootRealPath: string;
  let rootEntries: Awaited<ReturnType<CompanionCleanupDeps["readdir"]>>;
  try {
    const rootInfo = await deps.lstat(companionRoot);
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
      return {
        removedPaths,
        warnings: ["Companion 根目录不是普通目录，已跳过全部清理"],
      };
    }

    const supportRealPath = await deps.realpath(supportPath);
    rootRealPath = await deps.realpath(companionRoot);
    if (
      !isDirectRealChild(pathApi, platformKey, supportRealPath, rootRealPath)
    ) {
      return {
        removedPaths,
        warnings: ["Companion 根目录越出 supportPath，已跳过全部清理"],
      };
    }
    rootEntries = await deps.readdir(companionRoot, { withFileTypes: true });
  } catch (error) {
    return {
      removedPaths,
      warnings: [
        `无法校验 Companion 根目录，已跳过清理：${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }

  if (processInspectionError) {
    warnings.push(
      `无法确认运行中的 Companion，已跳过旧版本目录清理：${processInspectionError}`,
    );
  } else {
    const validatedOldInstalls: Array<{
      name: string;
      path: string;
      realPath: string;
      version: VersionParts;
    }> = [];

    for (const entry of rootEntries) {
      const version = parseStrictVersion(entry.name);
      if (!version || compareVersions(version, current) >= 0) {
        continue;
      }

      const installPath = pathApi.join(companionRoot, entry.name);
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        warnings.push(`已跳过非普通目录的旧版本：${installPath}`);
        continue;
      }
      const realInstallPath = await validatedCleanupTarget(
        installPath,
        rootRealPath,
        "directory",
        pathApi,
        platformKey,
        warnings,
        deps,
      );
      if (realInstallPath) {
        validatedOldInstalls.push({
          name: entry.name,
          path: installPath,
          realPath: realInstallPath,
          version,
        });
      }
    }

    validatedOldInstalls.sort((left, right) =>
      compareVersions(right.version, left.version),
    );
    const retainedPreviousVersion = validatedOldInstalls[0]?.name;
    for (const install of validatedOldInstalls) {
      if (
        install.name === retainedPreviousVersion ||
        recordUsesInstall(
          runningRecord,
          pathApi,
          platformKey,
          install.path,
          install.realPath,
        )
      ) {
        continue;
      }
      const recheckedRealPath = await validatedCleanupTarget(
        install.path,
        rootRealPath,
        "directory",
        pathApi,
        platformKey,
        warnings,
        deps,
      );
      if (!recheckedRealPath) {
        continue;
      }
      if (
        normalizedPath(pathApi, platformKey, recheckedRealPath) !==
        normalizedPath(pathApi, platformKey, install.realPath)
      ) {
        warnings.push(`旧版本目录在清理前发生变化，已保留：${install.path}`);
        continue;
      }
      await removeValidatedTarget(
        install.path,
        { recursive: true, force: true },
        removedPaths,
        warnings,
        deps,
      );
    }
  }

  const downloadsEntry = rootEntries.find(
    (entry) => entry.name === "downloads",
  );
  if (
    !downloadsEntry ||
    downloadsEntry.isSymbolicLink() ||
    !downloadsEntry.isDirectory()
  ) {
    if (downloadsEntry) {
      warnings.push("已跳过非普通目录的 Companion downloads");
    }
    return { removedPaths, warnings };
  }

  const downloadsPath = pathApi.join(companionRoot, "downloads");
  const downloadsRealPath = await validatedCleanupTarget(
    downloadsPath,
    rootRealPath,
    "directory",
    pathApi,
    platformKey,
    warnings,
    deps,
  );
  if (!downloadsRealPath) {
    return { removedPaths, warnings };
  }

  let downloadEntries: Awaited<ReturnType<CompanionCleanupDeps["readdir"]>>;
  try {
    downloadEntries = await deps.readdir(downloadsPath, {
      withFileTypes: true,
    });
  } catch (error) {
    warnings.push(
      `无法读取 Companion downloads，已跳过清理：${error instanceof Error ? error.message : String(error)}`,
    );
    return { removedPaths, warnings };
  }

  const completedZipPattern = new RegExp(
    `^((?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*))-${escapeRegExp(platformKey)}\\.zip$`,
  );
  for (const entry of downloadEntries) {
    const match = completedZipPattern.exec(entry.name);
    const version = match ? parseStrictVersion(match[1]) : undefined;
    if (!version || compareVersions(version, current) > 0) {
      continue;
    }

    const downloadPath = pathApi.join(downloadsPath, entry.name);
    if (entry.isSymbolicLink() || !entry.isFile()) {
      warnings.push(`已跳过非普通文件的下载包：${downloadPath}`);
      continue;
    }
    const realDownloadPath = await validatedCleanupTarget(
      downloadPath,
      downloadsRealPath,
      "file",
      pathApi,
      platformKey,
      warnings,
      deps,
    );
    if (!realDownloadPath) {
      continue;
    }
    await removeValidatedTarget(
      downloadPath,
      { force: true },
      removedPaths,
      warnings,
      deps,
    );
  }

  return { removedPaths, warnings };
}
