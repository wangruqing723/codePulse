import { Alert, Toast, confirmAlert, showToast } from "@raycast/api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapCompanion } from "./companion/launch-control";
import {
  CODEPULSE_CENTER_DEEPLINK,
  codexImportHealthPresentation,
  codexImportConflictWarning,
  invalidCodexImportHookStatus,
  openCodePulseCenter,
  runIndependentHookStatusRefresh,
} from "./lib/codex-import-ui";
import {
  handleLaunchCompanion,
  handleRepairCodexImportedHooks,
} from "./setup-hooks";
import type { HookInstallStatus } from "./lib/hooks";

vi.mock("./companion/launch-control", () => ({
  bootstrapCompanion: vi.fn(),
}));

describe("CodePulse Center companion bootstrap action", () => {
  const toast = {
    style: "animated",
    title: "",
    message: undefined as string | undefined,
  };

  beforeEach(() => {
    vi.mocked(showToast).mockClear();
    vi.mocked(bootstrapCompanion).mockReset();
    toast.style = "animated";
    toast.title = "";
    toast.message = undefined;
    vi.mocked(showToast).mockResolvedValue(toast as never);
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
      onProgress: expect.any(Function),
    });
    expect(toast).toMatchObject({
      style: "success",
      title: "Floating Companion 已启动",
      message:
        "/raycast/support/companion/0.1.3/darwin-arm64/CodePulse Companion.app",
    });
  });

  it("updates the in-progress toast while companion bootstrap reports progress", async () => {
    let resolveBootstrap: (
      result: Awaited<ReturnType<typeof bootstrapCompanion>>,
    ) => void = () => undefined;
    vi.mocked(bootstrapCompanion).mockReturnValue(
      new Promise((resolve) => {
        resolveBootstrap = resolve;
      }),
    );

    const launch = handleLaunchCompanion({});
    await Promise.resolve();

    expect(showToast).toHaveBeenCalledWith({
      style: "animated",
      title: "正在安装 / 更新 / 启动 Floating Companion",
      message: "正在检查当前版本；如需更新会下载 release artifact。",
    });

    const onProgress =
      vi.mocked(bootstrapCompanion).mock.calls[0]?.[0].onProgress;
    onProgress?.({ stage: "checking-installed" });

    expect(toast).toMatchObject({
      style: "animated",
      title: "正在检查当前版本 Floating Companion",
      message: "正在查找当前扩展版本对应的本地安装。",
    });

    onProgress?.({
      stage: "downloading",
      downloadedBytes: 1024 * 1024,
      totalBytes: 2 * 1024 * 1024,
    });

    expect(toast).toMatchObject({
      style: "animated",
      title: "正在下载 Floating Companion",
      message: "1.0 MB / 2.0 MB",
    });

    resolveBootstrap({
      status: "launched",
      path: "/raycast/support/companion/0.1.3/darwin-arm64/CodePulse Companion.app",
    });
    await launch;
  });

  it.each([
    [
      { status: "release-unavailable", message: "manifest" },
      "Release artifact 不可用",
      "请先将仓库转为公开并发布 companion release。",
    ],
    [
      { status: "unsupported-platform", platformKey: "linux-x64" },
      "当前平台暂不支持 Floating Companion",
      "linux-x64",
    ],
    [
      { status: "hash-mismatch", expected: "a", actual: "b" },
      "Floating Companion 校验失败",
      "下载内容与 manifest SHA-256 不一致。",
    ],
    [
      { status: "install-failed", message: "ditto failed" },
      "Floating Companion 安装失败",
      "ditto failed",
    ],
  ])(
    "shows a specific failure toast for %s",
    async (result, title, message) => {
      vi.mocked(bootstrapCompanion).mockResolvedValue(result as never);

      await handleLaunchCompanion({});

      expect(toast).toMatchObject({ style: "failure", title, message });
    },
  );
});

describe("CodePulse Center Codex imported Hook repair action", () => {
  beforeEach(() => {
    vi.mocked(confirmAlert).mockReset();
    vi.mocked(confirmAlert).mockResolvedValue(true);
    vi.mocked(showToast).mockReset();
    vi.mocked(showToast).mockResolvedValue(undefined as never);
  });

  it("does nothing when the user cancels the repair", async () => {
    const repair = vi.fn();
    const refresh = vi.fn(async () => undefined);
    vi.mocked(confirmAlert).mockResolvedValue(false);

    await handleRepairCodexImportedHooks(repair as never, refresh);

    expect(confirmAlert).toHaveBeenCalledWith({
      title: "修复 Codex 导入冲突?",
      message:
        "只会移除 Codex hooks.json 中以 Claude 身份运行的 CodePulse Hook；其他导入配置保持不变，并会在修改前自动创建备份。",
      primaryAction: {
        title: "修复",
        style: Alert.ActionStyle.Destructive,
      },
      dismissAction: {
        title: "取消",
      },
    });
    expect(repair).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows the removed count and backup path before refreshing", async () => {
    const repair = vi.fn(async () => ({
      status: {
        codexImportedHooks: {
          state: "clean",
          hooksPath: "/tmp/hooks.json",
          count: 0,
          eventNames: [],
        },
      },
      removedCount: 2,
      eventNames: ["Notification", "Stop"],
      backupPath:
        "/tmp/hooks.json.codepulse-import-20260711-010203-456-a1b2.bak",
    }));
    const refresh = vi.fn(async () => undefined);

    await handleRepairCodexImportedHooks(repair as never, refresh);

    expect(repair).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith({
      style: Toast.Style.Success,
      title: "已修复 2 项 Codex 导入冲突",
      message:
        "备份：/tmp/hooks.json.codepulse-import-20260711-010203-456-a1b2.bak",
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(vi.mocked(showToast).mock.invocationCallOrder[0]).toBeLessThan(
      refresh.mock.invocationCallOrder[0],
    );
  });

  it("reports a clean zero-removal race as no longer needing repair", async () => {
    const repair = vi.fn(async () => ({
      status: {
        codexImportedHooks: {
          state: "clean",
          hooksPath: "/tmp/hooks.json",
          count: 0,
          eventNames: [],
        },
      },
      removedCount: 0,
      eventNames: [],
    }));
    const refresh = vi.fn(async () => undefined);

    await handleRepairCodexImportedHooks(repair as never, refresh);

    expect(showToast).toHaveBeenCalledWith({
      style: Toast.Style.Success,
      title: "Codex 导入冲突已不存在",
      message: "无需修复",
    });
    expect(showToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "已修复 0 项 Codex 导入冲突" }),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("reports the latest invalid health instead of a repair success", async () => {
    const repair = vi.fn(async () => ({
      status: {
        codexImportedHooks: {
          state: "invalid",
          hooksPath: "/tmp/hooks.json",
          count: 0,
          eventNames: [],
          error: "hooks.json 已损坏",
        },
      },
      removedCount: 0,
      eventNames: [],
    }));
    const refresh = vi.fn(async () => undefined);

    await handleRepairCodexImportedHooks(repair as never, refresh);

    expect(showToast).toHaveBeenCalledWith({
      style: Toast.Style.Failure,
      title: "Codex 导入冲突修复失败",
      message: "hooks.json 已损坏",
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("reports a latest conflict even when this attempt removed entries", async () => {
    const repair = vi.fn(async () => ({
      status: {
        codexImportedHooks: {
          state: "conflict",
          hooksPath: "/tmp/hooks.json",
          count: 3,
          eventNames: ["Stop"],
        },
      },
      removedCount: 1,
      eventNames: ["Notification"],
      backupPath: "/tmp/hooks.json.backup",
    }));
    const refresh = vi.fn(async () => undefined);

    await handleRepairCodexImportedHooks(repair as never, refresh);

    expect(showToast).toHaveBeenCalledWith({
      style: Toast.Style.Failure,
      title: "Codex 导入冲突仍存在",
      message: "仍有 3 项冲突，请刷新后重试。",
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("shows the failure reason before refreshing", async () => {
    const repair = vi.fn(async () => {
      throw new Error("Codex hooks.json 已发生变化，请刷新后重试");
    });
    const refresh = vi.fn(async () => undefined);

    await handleRepairCodexImportedHooks(repair as never, refresh);

    expect(showToast).toHaveBeenCalledWith({
      style: Toast.Style.Failure,
      title: "Codex 导入冲突修复失败",
      message: "Codex hooks.json 已发生变化，请刷新后重试",
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(vi.mocked(showToast).mock.invocationCallOrder[0]).toBeLessThan(
      refresh.mock.invocationCallOrder[0],
    );
  });

  it("contains a refresh rejection and reports it separately", async () => {
    const repair = vi.fn(async () => ({
      status: {
        codexImportedHooks: {
          state: "clean",
          hooksPath: "/tmp/hooks.json",
          count: 0,
          eventNames: [],
        },
      },
      removedCount: 1,
      eventNames: ["Stop"],
      backupPath: "/tmp/hooks.json.backup",
    }));
    const refresh = vi.fn(async () => {
      throw new Error("refresh failed");
    });

    await expect(
      handleRepairCodexImportedHooks(repair as never, refresh),
    ).resolves.toBeUndefined();

    expect(showToast).toHaveBeenNthCalledWith(1, {
      style: Toast.Style.Success,
      title: "已修复 1 项 Codex 导入冲突",
      message: "备份：/tmp/hooks.json.backup",
    });
    expect(showToast).toHaveBeenNthCalledWith(2, {
      style: Toast.Style.Failure,
      title: "Codex 导入状态刷新失败",
      message: "refresh failed",
    });
  });
});

describe("Codex imported Hook menu warning", () => {
  it.each([
    undefined,
    {
      state: "clean",
      hooksPath: "/tmp/hooks.json",
      count: 0,
      eventNames: [],
    },
    {
      state: "invalid",
      hooksPath: "/tmp/hooks.json",
      count: 0,
      eventNames: [],
      error: "Unexpected token",
    },
  ])("does not add menu noise for %s", (health) => {
    expect(codexImportConflictWarning(health as never)).toBeUndefined();
  });

  it("returns the warning title only for conflicts", () => {
    expect(
      codexImportConflictWarning({
        state: "conflict",
        hooksPath: "/tmp/hooks.json",
        count: 3,
        eventNames: ["Notification", "Stop"],
      } as never),
    ).toBe("Codex 导入冲突：3 项");
  });

  it("opens the CodePulse Center deeplink", async () => {
    const opener = vi.fn(async () => undefined);

    await openCodePulseCenter(opener);

    expect(opener).toHaveBeenCalledTimes(1);
    expect(opener).toHaveBeenCalledWith(CODEPULSE_CENTER_DEEPLINK);
    expect(CODEPULSE_CENTER_DEEPLINK).toBe(
      "raycast://extensions/code-pulse/code-pulse/setup-hooks",
    );
  });
});

describe("Codex imported Hook health presentation", () => {
  it("shows a non-actionable loading state before status is available", () => {
    expect(codexImportHealthPresentation(undefined)).toEqual({
      state: "loading",
      statusText: "检查中",
      error: undefined,
      canRepair: false,
    });
  });

  it("shows clean status without a repair action", () => {
    expect(
      codexImportHealthPresentation({
        state: "clean",
        hooksPath: "/tmp/hooks.json",
        count: 0,
        eventNames: [],
      } as never),
    ).toEqual({
      state: "clean",
      statusText: "正常",
      error: undefined,
      canRepair: false,
    });
  });

  it("shows the conflict count and enables the repair action", () => {
    expect(
      codexImportHealthPresentation({
        state: "conflict",
        hooksPath: "/tmp/hooks.json",
        count: 4,
        eventNames: ["Notification", "Stop"],
      } as never),
    ).toEqual({
      state: "conflict",
      statusText: "4 项需修复",
      error: undefined,
      canRepair: true,
    });
  });

  it("shows invalid details without a repair action", () => {
    expect(
      codexImportHealthPresentation({
        state: "invalid",
        hooksPath: "/tmp/hooks.json",
        count: 0,
        eventNames: [],
        error: "Unexpected token at position 0",
      } as never),
    ).toEqual({
      state: "invalid",
      statusText: "无法检查 hooks.json",
      error: "Unexpected token at position 0",
      canRepair: false,
    });
  });
});

describe("Codex imported Hook independent refresh", () => {
  const conflictStatus: HookInstallStatus = {
    installed: false,
    claudeInstalled: false,
    codexInstalled: false,
    hookPath: "/tmp/support/bin/codepulse-hook",
    claudeSettingsPath: "/tmp/settings.json",
    codexConfigPath: "/tmp/config.toml",
    codexImportedHooks: {
      state: "conflict" as const,
      hooksPath: "/tmp/hooks.json",
      count: 2,
      eventNames: ["Stop"],
    },
  };

  it.each(["save", "build", "notify"] as const)(
    "commits Hook health when the primary %s stage fails",
    async (failedStage) => {
      const commitHookStatus = vi.fn();
      const commitHookError = vi.fn();
      const onPrimaryError = vi.fn(async () => undefined);
      const stages = {
        save: vi.fn(async () => undefined),
        build: vi.fn(async () => undefined),
        notify: vi.fn(async () => undefined),
      };
      stages[failedStage].mockRejectedValueOnce(
        new Error(`${failedStage} failed`),
      );

      const result = await runIndependentHookStatusRefresh({
        loadHookStatus: async () => conflictStatus,
        commitHookStatus,
        commitHookError,
        runPrimaryRefresh: async () => {
          await stages.save();
          await stages.build();
          await stages.notify();
        },
        onPrimaryError,
      });

      expect(commitHookStatus).toHaveBeenCalledWith(conflictStatus);
      expect(commitHookError).not.toHaveBeenCalled();
      expect(onPrimaryError).toHaveBeenCalledWith(
        expect.objectContaining({ message: `${failedStage} failed` }),
      );
      expect(result.hookError).toBeUndefined();
      expect(result.primaryError).toEqual(
        expect.objectContaining({ message: `${failedStage} failed` }),
      );
    },
  );

  it("commits invalid health and never leaves the presentation loading", async () => {
    let committedStatus: HookInstallStatus = conflictStatus;
    const loadError = new Error("health load failed");

    const result = await runIndependentHookStatusRefresh({
      loadHookStatus: async () => {
        throw loadError;
      },
      commitHookStatus: (status) => {
        committedStatus = status;
      },
      commitHookError: (error) => {
        committedStatus = invalidCodexImportHookStatus(committedStatus, error);
      },
      runPrimaryRefresh: async () => undefined,
    });

    expect(result.hookError).toBe(loadError);
    expect(
      codexImportHealthPresentation(committedStatus.codexImportedHooks),
    ).toMatchObject({
      state: "invalid",
      statusText: "无法检查 hooks.json",
      canRepair: false,
      error: expect.stringContaining("health load failed"),
    });
  });

  it("resolves even when error callbacks fail", async () => {
    await expect(
      runIndependentHookStatusRefresh({
        loadHookStatus: async () => {
          throw new Error("health failed");
        },
        commitHookStatus: vi.fn(),
        commitHookError: () => {
          throw new Error("commit failed");
        },
        runPrimaryRefresh: async () => {
          throw new Error("primary failed");
        },
        onHookError: async () => {
          throw new Error("hook callback failed");
        },
        onPrimaryError: async () => {
          throw new Error("primary callback failed");
        },
      }),
    ).resolves.toMatchObject({
      hookError: expect.objectContaining({ message: "health failed" }),
      primaryError: expect.objectContaining({ message: "primary failed" }),
    });
  });
});
