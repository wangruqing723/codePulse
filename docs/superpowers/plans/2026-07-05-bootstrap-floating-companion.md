---
change: bootstrap-floating-companion
design-doc: docs/superpowers/specs/2026-07-05-bootstrap-floating-companion-design.md
base-ref: bda68bf22bbf97e565b83e520afdd2280f6974a1
archived-with: 2026-07-05-bootstrap-floating-companion
---

# Bootstrap Floating Companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a CodePulse Center action that installs a verified Floating Companion from public GitHub Release artifacts into Raycast support storage and then launches it.

**Architecture:** Replace the current launch-only `src/companion/launch-control.ts` draft with a bootstrap helper that checks the versioned support-path install first, downloads a public release manifest and platform zip when missing, verifies SHA-256, extracts safely, then opens the installed entrypoint through Raycast. Keep public URL bootstrap as the first version; private GitHub token support is explicitly out of scope.

**Tech Stack:** Raycast API (`environment.supportPath`, `open`, preferences, toasts), Node 22 (`crypto`, `fs/promises`, `child_process`, `fetch`), Vitest, existing Electron companion packaging.

## Global Constraints

- The repository is currently private; this first implementation assumes the repository will be made public before release assets are used.
- No private GitHub release token support in this change.
- Install path is `environment.supportPath/companion/<version>/<platform-arch>/`.
- Platform key is `${process.platform}-${process.arch}`.
- Downloaded zips must match manifest `sha256` before extraction or launch.
- Do not install into `/Applications` or `%LOCALAPPDATA%`.
- Preserve the existing `强制退出 Floating Companion` action.
- Windows bootstrap contract must exist in code and tests, but Windows artifact production remains target-platform or CI validated.

## File Structure

- Modify `package.json`: add optional Raycast preferences for `companionReleaseTag` and `companionManifestUrl`, and add a release packaging script entry.
- Modify `src/lib/types.ts`: extend Raycast `Preferences` with the optional companion release fields.
- Replace `src/companion/launch-control.ts`: implement manifest resolution, installed lookup, download/hash/install, zip extraction, and launch result typing.
- Replace `src/companion/launch-control.test.ts`: cover local installed launch, release unavailable, unsupported platform, hash mismatch, and successful install.
- Modify `src/setup-hooks.tsx`: rename the action to `Install / Start Floating Companion`, pass `environment.supportPath` and preferences into the helper, and map typed results to toasts.
- Modify `src/setup-hooks.test.ts`: cover result-specific toasts and preserve force-exit action behavior.
- Create `scripts/package-companion-release.mjs`: generate macOS arm64 release zip plus SHA-256 manifest entries from `npm run companion:package` output.
- Modify `README.md`: document public repo/release prerequisite, install action behavior, unsigned companion limitation, and Windows packaging caveat.
- Modify `openspec/changes/bootstrap-floating-companion/tasks.md`: check off tasks only after code and verification pass.

### Task 1: Bootstrap Contract, Preferences, And Installed Lookup

**Files:**
- Modify: `package.json`
- Modify: `src/lib/types.ts`
- Replace: `src/companion/launch-control.ts`
- Replace: `src/companion/launch-control.test.ts`

**Interfaces:**
- Produces: `bootstrapCompanion(options: BootstrapCompanionOptions): Promise<CompanionBootstrapResult>`
- Produces: `resolveCompanionManifestUrl(options: ManifestUrlOptions): string`
- Produces: `getPlatformKey(platform: NodeJS.Platform, arch: string): string`
- Produces: `__testing__.setDeps(nextDeps: BootstrapDeps): void`

- [x] **Step 1: Write failing tests for local installed companion resolution**

Replace the old `/Applications`-based tests in `src/companion/launch-control.test.ts` with bootstrap-path tests:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapCompanion, resolveCompanionManifestUrl, __testing__ } from "./launch-control";

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
        if (filePath.endsWith("companion/0.1.3/darwin-arm64/CodePulse Companion.app")) return;
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
});
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- src/companion/launch-control.test.ts`

Expected: FAIL because `bootstrapCompanion` and `resolveCompanionManifestUrl` do not exist yet.

- [x] **Step 3: Add Raycast preferences and preference types**

In `package.json`, append these preferences after `monitorProjects`:

```json
{
  "name": "companionReleaseTag",
  "type": "textfield",
  "title": "Companion Release Tag",
  "description": "可选。默认使用当前扩展版本，例如 codepulse-companion-v0.1.3。",
  "required": false
},
{
  "name": "companionManifestUrl",
  "type": "textfield",
  "title": "Companion Manifest URL",
  "description": "可选。覆盖默认 GitHub Release manifest URL。",
  "required": false
}
```

In `src/lib/types.ts`, extend `Preferences`:

```ts
export interface Preferences {
  activeWindowMinutes?: string;
  menuBarStyle?: "icon" | "count" | "session";
  enableSound?: boolean;
  monitorProjects?: string;
  companionReleaseTag?: string;
  companionManifestUrl?: string;
}
```

- [x] **Step 4: Implement the minimal installed-lookup helper**

Replace `src/companion/launch-control.ts` with the initial bootstrap contract:

```ts
import { access } from "node:fs/promises";
import path from "node:path";
import { open } from "@raycast/api";
import packageJson from "../../package.json";

const REPO_RELEASE_BASE = "https://github.com/wangruqing723/codePulse/releases/download";

export type CompanionBootstrapResult =
  | { status: "launched"; path: string }
  | { status: "release-unavailable"; message?: string }
  | { status: "unsupported-platform"; platformKey: string }
  | { status: "hash-mismatch"; expected: string; actual: string }
  | { status: "install-failed"; message: string };

export interface ManifestUrlOptions {
  packageVersion: string;
  releaseTag?: string;
  manifestUrl?: string;
}

export interface BootstrapCompanionOptions {
  supportPath: string;
  releaseTag?: string;
  manifestUrl?: string;
}

interface BootstrapDeps {
  platform: NodeJS.Platform;
  arch: string;
  packageVersion: string;
  access(path: string): Promise<void>;
  fetch(input: string): Promise<Response>;
  open(target: string): Promise<void>;
}

function createDefaultDeps(): BootstrapDeps {
  return {
    platform: process.platform,
    arch: process.arch,
    packageVersion: packageJson.version,
    access,
    fetch: async (input) => fetch(input),
    open,
  };
}

let deps = createDefaultDeps();

export function getPlatformKey(platform: NodeJS.Platform, arch: string): string {
  return `${platform}-${arch}`;
}

export function resolveCompanionManifestUrl(options: ManifestUrlOptions): string {
  const override = options.manifestUrl?.trim();
  if (override) return override;

  const tag = options.releaseTag?.trim() || `codepulse-companion-v${options.packageVersion}`;
  return `${REPO_RELEASE_BASE}/${tag}/codepulse-companion-manifest.json`;
}

function entrypointForPlatform(platformKey: string): string | undefined {
  if (platformKey === "darwin-arm64") return "CodePulse Companion.app";
  if (platformKey === "win32-x64") return "CodePulse Companion.exe";
  return undefined;
}

function installedEntrypointPath(supportPath: string, version: string, platformKey: string): string | undefined {
  const entrypoint = entrypointForPlatform(platformKey);
  if (!entrypoint) return undefined;
  return path.join(supportPath, "companion", version, platformKey, entrypoint);
}

export async function bootstrapCompanion(options: BootstrapCompanionOptions): Promise<CompanionBootstrapResult> {
  const platformKey = getPlatformKey(deps.platform, deps.arch);
  const installed = installedEntrypointPath(options.supportPath, deps.packageVersion, platformKey);

  if (!installed) {
    return { status: "unsupported-platform", platformKey };
  }

  try {
    await deps.access(installed);
    await deps.open(installed);
    return { status: "launched", path: installed };
  } catch {
    return { status: "release-unavailable", message: "Companion release manifest is not available yet." };
  }
}

export const __testing__ = {
  setDeps(nextDeps: Partial<BootstrapDeps>) {
    deps = { ...createDefaultDeps(), ...nextDeps };
  },
  resetDeps() {
    deps = createDefaultDeps();
  },
};
```

- [x] **Step 5: Run the focused test and verify it passes**

Run: `npm test -- src/companion/launch-control.test.ts`

Expected: PASS for installed lookup and URL derivation; download scenarios are still unimplemented and covered in Task 2.

### Task 2: Public Manifest Download, Hash Verification, Extraction, And Launch

**Files:**
- Modify: `src/companion/launch-control.ts`
- Modify: `src/companion/launch-control.test.ts`

**Interfaces:**
- Consumes: `bootstrapCompanion(options)`
- Produces: manifest type:

```ts
interface CompanionReleaseManifest {
  version: string;
  artifacts: Record<string, { url: string; sha256: string; entrypoint: string }>;
}
```

- [x] **Step 1: Add failing tests for release unavailable, unsupported platform, hash mismatch, and successful install**

Append tests to `src/companion/launch-control.test.ts`:

```ts
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
  ).resolves.toEqual({ status: "unsupported-platform", platformKey: "linux-x64" });
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

it("downloads, verifies, extracts, and launches a valid artifact", async () => {
  const zipBytes = new TextEncoder().encode("zip-bytes");
  const expectedHash = "0a5727f85c93fbe2f25d72c95640be7bd314297f172750ced8bd45dca6d26f5b";
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
```

- [x] **Step 2: Run tests and verify they fail for missing implementation**

Run: `npm test -- src/companion/launch-control.test.ts`

Expected: FAIL because `rm`, `extractZip`, `rename`, and download behavior are not in `BootstrapDeps` yet.

- [x] **Step 3: Expand dependencies and implement download/hash/install**

In `src/companion/launch-control.ts`, add Node imports:

```ts
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
```

Extend `BootstrapDeps`:

```ts
mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
writeFile(path: string, data: Uint8Array): Promise<void>;
rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
rename(oldPath: string, newPath: string): Promise<void>;
extractZip(zipPath: string, destinationPath: string, platform: NodeJS.Platform): Promise<void>;
```

Add helpers:

```ts
const execFileAsync = promisify(execFile);

async function extractZip(zipPath: string, destinationPath: string, platform: NodeJS.Platform): Promise<void> {
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

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

async function fetchJson(url: string): Promise<CompanionReleaseManifest | undefined> {
  const response = await deps.fetch(url);
  if (!response.ok) return undefined;
  return (await response.json()) as CompanionReleaseManifest;
}

async function fetchBytes(url: string): Promise<Uint8Array | undefined> {
  const response = await deps.fetch(url);
  if (!response.ok) return undefined;
  return new Uint8Array(await response.arrayBuffer());
}
```

Then update `bootstrapCompanion()` to:

```ts
const manifestUrl = resolveCompanionManifestUrl({
  packageVersion: deps.packageVersion,
  releaseTag: options.releaseTag,
  manifestUrl: options.manifestUrl,
});
const manifest = await fetchJson(manifestUrl);
if (!manifest) return { status: "release-unavailable", message: manifestUrl };

const artifact = manifest.artifacts[platformKey];
if (!artifact) return { status: "unsupported-platform", platformKey };

const downloadsDir = path.join(options.supportPath, "companion", "downloads");
const zipPath = path.join(downloadsDir, `${manifest.version}-${platformKey}.zip`);
const installDir = path.join(options.supportPath, "companion", manifest.version, platformKey);
const tempDir = `${installDir}.tmp-${Date.now()}`;
const entrypointPath = path.join(installDir, artifact.entrypoint);

const bytes = await fetchBytes(artifact.url);
if (!bytes) return { status: "release-unavailable", message: artifact.url };

await deps.mkdir(downloadsDir, { recursive: true });
await deps.writeFile(zipPath, bytes);

const actual = sha256(bytes);
if (actual !== artifact.sha256) {
  await deps.rm(zipPath, { force: true });
  return { status: "hash-mismatch", expected: artifact.sha256, actual };
}

try {
  await deps.rm(tempDir, { recursive: true, force: true });
  await deps.mkdir(tempDir, { recursive: true });
  await deps.extractZip(zipPath, tempDir, deps.platform);
  await deps.rm(installDir, { recursive: true, force: true });
  await deps.rename(tempDir, installDir);
  await deps.open(entrypointPath);
  return { status: "launched", path: entrypointPath };
} catch (error) {
  await deps.rm(tempDir, { recursive: true, force: true });
  return { status: "install-failed", message: error instanceof Error ? error.message : String(error) };
}
```

- [x] **Step 4: Run focused tests and verify they pass**

Run: `npm test -- src/companion/launch-control.test.ts`

Expected: PASS.

### Task 3: CodePulse Center UX And Toast Mapping

**Files:**
- Modify: `src/setup-hooks.tsx`
- Modify: `src/setup-hooks.test.ts`
- Modify: `test/raycast-api.ts` only if the Raycast test stub lacks needed preference or action support.

**Interfaces:**
- Consumes: `bootstrapCompanion({ supportPath, releaseTag, manifestUrl })`
- Produces: `handleLaunchCompanion(preferences?: Pick<Preferences, "companionReleaseTag" | "companionManifestUrl">): Promise<void>`

- [x] **Step 1: Write failing toast mapping tests**

Update `src/setup-hooks.test.ts` to mock `bootstrapCompanion` instead of `launchCompanionApp`:

```ts
import { showToast } from "@raycast/api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapCompanion } from "./companion/launch-control";
import { handleLaunchCompanion } from "./setup-hooks";

vi.mock("./companion/launch-control", () => ({
  bootstrapCompanion: vi.fn(),
}));

describe("CodePulse Center companion bootstrap action", () => {
  beforeEach(() => {
    vi.mocked(showToast).mockClear();
    vi.mocked(bootstrapCompanion).mockReset();
  });

  it("shows a success toast after launching the companion", async () => {
    vi.mocked(bootstrapCompanion).mockResolvedValue({
      status: "launched",
      path: "/raycast/support/companion/0.1.3/darwin-arm64/CodePulse Companion.app",
    });

    await handleLaunchCompanion({
      companionReleaseTag: "codepulse-companion-v0.1.3",
      companionManifestUrl: "",
    });

    expect(bootstrapCompanion).toHaveBeenCalledWith({
      supportPath: expect.any(String),
      releaseTag: "codepulse-companion-v0.1.3",
      manifestUrl: "",
    });
    expect(showToast).toHaveBeenCalledWith({
      style: "success",
      title: "Floating Companion 已启动",
      message: "/raycast/support/companion/0.1.3/darwin-arm64/CodePulse Companion.app",
    });
  });

  it.each([
    [{ status: "release-unavailable", message: "manifest" }, "Release artifact 不可用", "请先将仓库转为公开并发布 companion release。"],
    [{ status: "unsupported-platform", platformKey: "linux-x64" }, "当前平台暂不支持 Floating Companion", "linux-x64"],
    [{ status: "hash-mismatch", expected: "a", actual: "b" }, "Floating Companion 校验失败", "下载内容与 manifest SHA-256 不一致。"],
    [{ status: "install-failed", message: "ditto failed" }, "Floating Companion 安装失败", "ditto failed"],
  ])("shows a specific failure toast for %s", async (result, title, message) => {
    vi.mocked(bootstrapCompanion).mockResolvedValue(result as never);

    await handleLaunchCompanion({});

    expect(showToast).toHaveBeenCalledWith({
      style: "failure",
      title,
      message,
    });
  });
});
```

- [x] **Step 2: Run the setup test and verify it fails**

Run: `npm test -- src/setup-hooks.test.ts`

Expected: FAIL because the command still imports `launchCompanionApp` and uses old copy.

- [x] **Step 3: Wire the bootstrap helper into CodePulse Center**

In `src/setup-hooks.tsx`:

```ts
import { bootstrapCompanion } from "./companion/launch-control";
```

Replace `handleLaunchCompanion()` with:

```ts
export async function handleLaunchCompanion(
  preferences: Pick<Preferences, "companionReleaseTag" | "companionManifestUrl"> = {},
): Promise<void> {
  const result = await bootstrapCompanion({
    supportPath: environment.supportPath,
    releaseTag: preferences.companionReleaseTag,
    manifestUrl: preferences.companionManifestUrl,
  });

  if (result.status === "launched") {
    await showToast({
      style: Toast.Style.Success,
      title: "Floating Companion 已启动",
      message: result.path,
    });
    return;
  }

  if (result.status === "release-unavailable") {
    await showToast({
      style: Toast.Style.Failure,
      title: "Release artifact 不可用",
      message: "请先将仓库转为公开并发布 companion release。",
    });
    return;
  }

  if (result.status === "unsupported-platform") {
    await showToast({
      style: Toast.Style.Failure,
      title: "当前平台暂不支持 Floating Companion",
      message: result.platformKey,
    });
    return;
  }

  if (result.status === "hash-mismatch") {
    await showToast({
      style: Toast.Style.Failure,
      title: "Floating Companion 校验失败",
      message: "下载内容与 manifest SHA-256 不一致。",
    });
    return;
  }

  await showToast({
    style: Toast.Style.Failure,
    title: "Floating Companion 安装失败",
    message: result.message,
  });
}
```

Change the action title and call site:

```tsx
<Action
  icon={Icon.Play}
  title="Install / Start Floating Companion"
  onAction={() => {
    void handleLaunchCompanion(preferences);
  }}
/>
```

- [x] **Step 4: Run setup tests and verify they pass**

Run: `npm test -- src/setup-hooks.test.ts`

Expected: PASS.

### Task 4: Release Manifest And macOS arm64 Artifact Packaging Path

**Files:**
- Create: `scripts/package-companion-release.mjs`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Produces: `npm run companion:release:mac`
- Produces: `release/codepulse-companion-manifest.json`
- Produces: `release/CodePulse-Companion-darwin-arm64.zip`

- [x] **Step 1: Add the npm script**

In `package.json`, add:

```json
"companion:release:mac": "npm run companion:package && node scripts/package-companion-release.mjs"
```

- [x] **Step 2: Create the release packaging script**

Create `scripts/package-companion-release.mjs`:

```js
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import packageJson from "../package.json" with { type: "json" };

const execFileAsync = promisify(execFile);
const rootDir = process.cwd();
const releaseDir = path.join(rootDir, "release");
const version = packageJson.version;
const tag = `codepulse-companion-v${version}`;
const appPath = path.join(releaseDir, "mac-arm64", "CodePulse Companion.app");
const zipName = "CodePulse-Companion-darwin-arm64.zip";
const zipPath = path.join(releaseDir, zipName);
const manifestPath = path.join(releaseDir, "codepulse-companion-manifest.json");

await mkdir(releaseDir, { recursive: true });
await execFileAsync("ditto", ["-c", "-k", "--keepParent", appPath, zipPath]);

const zipBytes = await readFile(zipPath);
const sha256 = createHash("sha256").update(zipBytes).digest("hex");
const manifest = {
  version,
  artifacts: {
    "darwin-arm64": {
      url: `https://github.com/wangruqing723/codePulse/releases/download/${tag}/${zipName}`,
      sha256,
      entrypoint: "CodePulse Companion.app",
    },
  },
};

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Wrote ${zipPath}`);
console.log(`Wrote ${manifestPath}`);
```

- [x] **Step 3: Document the public release flow**

In `README.md`, add a short section:

```md
## Floating Companion Bootstrap

`CodePulse Center` includes `Install / Start Floating Companion`. The action first checks Raycast's support directory for a verified companion install. If it is missing, it downloads `codepulse-companion-manifest.json` and the matching platform zip from the current repository's public GitHub Release, verifies SHA-256, extracts to `environment.supportPath/companion/<version>/<platform-arch>/`, and launches the installed artifact.

The current repository must be public, or the manifest URL must point to a public release asset. This version does not support private GitHub release tokens.

Maintainers can produce the current macOS arm64 release files with:

```bash
npm run companion:release:mac
```

Upload `release/CodePulse-Companion-darwin-arm64.zip` and `release/codepulse-companion-manifest.json` to GitHub Release tag `codepulse-companion-v<version>`.

Windows bootstrap is represented by the manifest contract, but Windows companion packaging should be generated and validated on a Windows runner or target Windows machine before publishing `win32-x64` artifacts.

Unsigned macOS companion builds may still be blocked by Gatekeeper; signing and notarization are tracked as a follow-up.
```

- [x] **Step 4: Run packaging script syntax validation**

Run: `node --check scripts/package-companion-release.mjs`

Expected: PASS.

### Task 5: Verification, OpenSpec Task Sync, And Handoff

**Files:**
- Modify: `openspec/changes/bootstrap-floating-companion/tasks.md`
- Possibly modify: `docs/superpowers/specs/2026-07-05-bootstrap-floating-companion-design.md` only if implementation reveals small spec gaps.

**Interfaces:**
- Consumes: all previous task outputs.
- Produces: checked OpenSpec task list and verification evidence.

- [x] **Step 1: Run focused tests**

Run:

```bash
npm test -- src/companion/launch-control.test.ts src/setup-hooks.test.ts
```

Expected: PASS.

- [x] **Step 2: Run the full test suite**

Run: `npm test`

Expected: PASS.

- [x] **Step 3: Run lint**

Run: `npm run lint`

Expected: PASS.

- [x] **Step 4: Run Raycast extension build**

Run: `npm run build`

Expected: PASS.

- [x] **Step 5: Run companion build**

Run: `npm run companion:build`

Expected: PASS.

- [x] **Step 6: Check off completed OpenSpec tasks**

After the above verification passes, update `openspec/changes/bootstrap-floating-companion/tasks.md` so each implemented line changes from `- [x]` to `- [x]`.

- [x] **Step 7: Run Comet build guard**

Run:

```bash
COMET_ENV="${COMET_ENV:-$(find . "$HOME"/.*/skills "$HOME/.config" "$HOME/.gemini" -path '*/comet/scripts/comet-env.sh' -type f -print -quit 2>/dev/null)}"
. "$COMET_ENV"
"$COMET_BASH" "$COMET_GUARD" bootstrap-floating-companion build --apply
```

Expected: PASS and `.comet.yaml` advances to `phase: verify`.

## Self-Review

- Spec coverage: Tasks 1-3 cover Raycast bootstrap, installed launch, public release unavailable, unsupported platform, hash mismatch, and user-facing toasts. Task 4 covers the release manifest and macOS arm64 artifact path. Task 5 covers verification.
- Placeholder scan: No `TBD`, `TODO`, or unspecified "add tests" steps remain.
- Type consistency: The plan consistently uses `bootstrapCompanion`, `CompanionBootstrapResult`, `ManifestUrlOptions`, `BootstrapCompanionOptions`, and `__testing__.setDeps`.
