import {
  Action,
  ActionPanel,
  Alert,
  Icon,
  List,
  Toast,
  confirmAlert,
  environment,
  getPreferenceValues,
  showToast,
} from "@raycast/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  bootstrapCompanion,
  type CompanionBootstrapProgress,
} from "./companion/launch-control";
import { killCompanionProcess } from "./companion/process-control";
import {
  companionPreferencesRoot,
  saveCompanionPreferencesSnapshot,
} from "./lib/companion-preferences";
import { eventsPath } from "./lib/state";
import {
  CodexNotifyConflictError,
  getHookInstallStatus,
  installHooks,
  repairCodexImportedClaudeHooks,
  uninstallHooks,
  type HookInstallStatus,
  type RepairCodexImportedHooksResult,
  type HookTarget,
} from "./lib/hooks";
import {
  codexImportHealthPresentation,
  invalidCodexImportHookStatus,
  runIndependentHookStatusRefresh,
} from "./lib/codex-import-ui";
import type { Preferences } from "./lib/types";

type SetupTarget = Exclude<HookTarget, "all">;
type RaycastToast = Awaited<ReturnType<typeof showToast>>;
type RepairCodexImportedHooksAction =
  () => Promise<RepairCodexImportedHooksResult>;

const TARGETS: Array<{
  id: SetupTarget;
  title: string;
  subtitle: string;
  icon: Icon;
}> = [
  {
    id: "claude",
    title: "Claude Code",
    subtitle: "写入 ~/.claude/settings.json 的 hooks",
    icon: Icon.Terminal,
  },
  {
    id: "codex",
    title: "Codex",
    subtitle: "写入 ~/.codex/config.toml 的 notify",
    icon: Icon.Code,
  },
];

const IS_MACOS = process.platform === "darwin";

function targetInstalled(
  status: HookInstallStatus | undefined,
  target: SetupTarget,
): boolean {
  if (!status) {
    return false;
  }

  return target === "claude" ? status.claudeInstalled : status.codexInstalled;
}

let launchCompanionInFlight: Promise<void> | undefined;

async function handleLaunchCompanionOnce(
  preferences: Pick<
    Preferences,
    "companionReleaseTag" | "companionManifestUrl"
  > = {},
): Promise<void> {
  const toast = await showToast({
    style: Toast.Style.Animated,
    title: "正在安装 / 更新 / 启动 Floating Companion",
    message: "正在检查当前版本；如需更新会下载 release artifact。",
  });

  const result = await bootstrapCompanion({
    supportPath: environment.supportPath,
    releaseTag: preferences.companionReleaseTag,
    manifestUrl: preferences.companionManifestUrl,
    onProgress: (progress) => {
      updateCompanionProgressToast(toast, progress);
    },
  });

  if (result.status === "launched") {
    toast.style = Toast.Style.Success;
    const warningCount = result.cleanup?.warnings.length ?? 0;
    toast.title = warningCount
      ? "Floating Companion 已启动（旧文件未完全清理）"
      : "Floating Companion 已启动";
    toast.message = warningCount
      ? `${result.path}\n已安全保留 ${warningCount} 项未清理内容。`
      : result.path;
    return;
  }

  if (result.status === "release-unavailable") {
    toast.style = Toast.Style.Failure;
    toast.title = "Release artifact 不可用";
    toast.message = "请先将仓库转为公开并发布 companion release。";
    return;
  }

  if (result.status === "unsupported-platform") {
    toast.style = Toast.Style.Failure;
    toast.title = "当前平台暂不支持 Floating Companion";
    toast.message = result.platformKey;
    return;
  }

  if (result.status === "hash-mismatch") {
    toast.style = Toast.Style.Failure;
    toast.title = "Floating Companion 校验失败";
    toast.message = "下载内容与 manifest SHA-256 不一致。";
    return;
  }

  toast.style = Toast.Style.Failure;
  toast.title = "Floating Companion 安装失败";
  toast.message = result.message;
}

export function handleLaunchCompanion(
  preferences: Pick<
    Preferences,
    "companionReleaseTag" | "companionManifestUrl"
  > = {},
): Promise<void> {
  if (launchCompanionInFlight) {
    return launchCompanionInFlight;
  }

  const launch = handleLaunchCompanionOnce(preferences).finally(() => {
    if (launchCompanionInFlight === launch) {
      launchCompanionInFlight = undefined;
    }
  });
  launchCompanionInFlight = launch;
  return launch;
}

export async function handleRepairCodexImportedHooks(
  repair: RepairCodexImportedHooksAction,
  refresh: () => Promise<void>,
): Promise<void> {
  const shouldRepair = await confirmAlert({
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

  if (!shouldRepair) {
    return;
  }

  try {
    const result = await repair();
    const latestHealth = result.status.codexImportedHooks;
    if (latestHealth.state === "invalid") {
      await showToast({
        style: Toast.Style.Failure,
        title: "Codex 导入冲突修复失败",
        message: latestHealth.error ?? "无法检查 Codex hooks.json",
      });
    } else if (latestHealth.state === "conflict") {
      await showToast({
        style: Toast.Style.Failure,
        title: "Codex 导入冲突仍存在",
        message: `仍有 ${latestHealth.count} 项冲突，请刷新后重试。`,
      });
    } else if (result.removedCount > 0) {
      await showToast({
        style: Toast.Style.Success,
        title: `已修复 ${result.removedCount} 项 Codex 导入冲突`,
        message: result.backupPath ? `备份：${result.backupPath}` : undefined,
      });
    } else {
      await showToast({
        style: Toast.Style.Success,
        title: "Codex 导入冲突已不存在",
        message: "无需修复",
      });
    }
  } catch (error) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Codex 导入冲突修复失败",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await refresh();
  } catch (error) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Codex 导入状态刷新失败",
      message: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
  }
}

function updateCompanionProgressToast(
  toast: RaycastToast,
  progress: CompanionBootstrapProgress,
): void {
  toast.style = Toast.Style.Animated;

  if (progress.stage === "checking-installed") {
    toast.title = "正在检查当前版本 Floating Companion";
    toast.message = "正在查找当前扩展版本对应的本地安装。";
    return;
  }

  if (progress.stage === "fetching-manifest") {
    toast.title = "正在检查 release artifact";
    toast.message = progress.manifestUrl;
    return;
  }

  if (progress.stage === "downloading") {
    toast.title = "正在下载 Floating Companion";
    toast.message = progress.totalBytes
      ? `${formatBytes(progress.downloadedBytes)} / ${formatBytes(progress.totalBytes)}`
      : formatBytes(progress.downloadedBytes);
    return;
  }

  if (progress.stage === "verifying") {
    toast.title = "正在校验 Floating Companion";
    toast.message = "正在校验 SHA-256。";
    return;
  }

  if (progress.stage === "extracting") {
    toast.title = "正在安装 Floating Companion";
    toast.message = "正在解压 release artifact。";
    return;
  }

  toast.title = "正在启动 Floating Companion";
  toast.message = "正在打开 companion app。";
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  if (unitIndex === 0) {
    return `${value} ${units[unitIndex]}`;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export default function Command() {
  const preferences = useMemo(() => getPreferenceValues<Preferences>(), []);
  const [status, setStatus] = useState<HookInstallStatus>();
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      await runIndependentHookStatusRefresh({
        loadHookStatus: () => getHookInstallStatus(environment.supportPath),
        commitHookStatus: setStatus,
        commitHookError: (error) => {
          setStatus((current) => invalidCodexImportHookStatus(current, error));
        },
        runPrimaryRefresh: async () => {
          await saveCompanionPreferencesSnapshot(
            companionPreferencesRoot(),
            preferences,
            eventsPath(environment.supportPath),
          );
        },
        onPrimaryError: async (error) => {
          await showToast({
            style: Toast.Style.Failure,
            title: "CodePulse Center 刷新失败",
            message: error instanceof Error ? error.message : String(error),
          });
        },
      });
    } finally {
      setIsLoading(false);
    }
  }, [preferences]);

  const forceExitCompanion = useCallback(async () => {
    const shouldKill = await confirmAlert({
      title: "强制退出 Floating Companion?",
      message:
        "仅终止 CodePulse 记录的 companion 进程树，并清理 stale record。",
      primaryAction: {
        title: "强制退出",
        style: Alert.ActionStyle.Destructive,
      },
      dismissAction: {
        title: "取消",
      },
    });

    if (!shouldKill) {
      return;
    }

    try {
      const result = await killCompanionProcess();
      await showToast({
        style: Toast.Style.Success,
        title:
          result.status === "killed"
            ? "Floating companion 已退出"
            : "未找到 Floating companion",
        message:
          result.matchedPids.length > 0
            ? `PID: ${result.matchedPids.join(", ")}`
            : undefined,
      });
      await refresh();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Floating companion 强制退出失败",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [refresh]);

  const repairImportedHooks = useCallback(
    async () =>
      handleRepairCodexImportedHooks(
        () => repairCodexImportedClaudeHooks(environment.supportPath),
        refresh,
      ),
    [refresh],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const installTarget = useCallback(
    async (target: SetupTarget, title: string) => {
      const shouldInstall = await confirmAlert({
        title: `安装 ${title} Hook?`,
        message: "会先备份对应配置；脚本异常时会静默退出，不阻塞 CLI。",
        primaryAction: {
          title: "安装",
        },
        dismissAction: {
          title: "取消",
        },
      });

      if (!shouldInstall) {
        return;
      }

      try {
        const next = await installHooks(environment.supportPath, target);
        setStatus(next);
        await showToast({
          style: Toast.Style.Success,
          title: `${title} Hook 已安装`,
        });
      } catch (error) {
        // Codex 的 notify 是单一键；检测到用户既有的非 CodePulse notify 时不静默
        // 覆盖，先提示用户确认，确认后再以 force 覆盖并备份原配置。
        if (error instanceof CodexNotifyConflictError) {
          const shouldOverwrite = await confirmAlert({
            title: "Codex 已有其他 notify 配置",
            message: `检测到既有配置：\n${error.existingNotify}\n\nCodex 只支持一个 notify，覆盖后原配置将失效（已自动备份）。是否覆盖？`,
            primaryAction: {
              title: "覆盖",
              style: Alert.ActionStyle.Destructive,
            },
            dismissAction: {
              title: "取消",
            },
          });

          if (!shouldOverwrite) {
            return;
          }

          try {
            const next = await installHooks(environment.supportPath, target, {
              force: true,
            });
            setStatus(next);
            await showToast({
              style: Toast.Style.Success,
              title: `${title} Hook 已安装`,
            });
          } catch (forceError) {
            await showToast({
              style: Toast.Style.Failure,
              title: `${title} Hook 安装失败`,
              message:
                forceError instanceof Error
                  ? forceError.message
                  : String(forceError),
            });
          }
          return;
        }

        await showToast({
          style: Toast.Style.Failure,
          title: `${title} Hook 安装失败`,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [],
  );

  const uninstallTarget = useCallback(
    async (target: SetupTarget, title: string) => {
      const shouldUninstall = await confirmAlert({
        title: `卸载 ${title} Hook?`,
        message: "只移除 CodePulse 写入的对应配置，保留其他配置。",
        primaryAction: {
          title: "卸载",
          style: Alert.ActionStyle.Destructive,
        },
        dismissAction: {
          title: "取消",
        },
      });

      if (!shouldUninstall) {
        return;
      }

      try {
        const next = await uninstallHooks(environment.supportPath, target);
        setStatus(next);
        await showToast({
          style: Toast.Style.Success,
          title: `${title} Hook 已卸载`,
        });
      } catch (error) {
        await showToast({
          style: Toast.Style.Failure,
          title: `${title} Hook 卸载失败`,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [],
  );

  const importedHooksHealth = codexImportHealthPresentation(
    status?.codexImportedHooks,
  );
  const importedHooksIcon =
    importedHooksHealth.state === "loading"
      ? Icon.CircleProgress
      : importedHooksHealth.state === "clean"
        ? Icon.CheckCircle
        : importedHooksHealth.state === "conflict"
          ? Icon.Warning
          : Icon.XMarkCircle;

  return (
    <List isLoading={isLoading} navigationTitle="CodePulse Center">
      <List.Item
        icon={Icon.Info}
        title="Floating companion recovery"
        subtitle={
          IS_MACOS ? "配置 + 恢复控制台" : "WSL 事件由独立 companion 读取"
        }
        accessories={[
          {
            text: IS_MACOS
              ? "Raycast hooks: supportPath/events"
              : "WSL events: ~/.codepulse/events",
          },
        ]}
        actions={
          <ActionPanel>
            <Action
              icon={Icon.Play}
              title="Install / Update / Start Floating Companion"
              onAction={() => {
                void handleLaunchCompanion(preferences);
              }}
            />
            <Action
              icon={Icon.XMarkCircle}
              title="强制退出 Floating Companion"
              style={Action.Style.Destructive}
              onAction={forceExitCompanion}
            />
          </ActionPanel>
        }
      />
      <List.Item
        icon={importedHooksIcon}
        title="Codex 导入兼容性"
        subtitle={importedHooksHealth.error}
        accessories={[{ text: importedHooksHealth.statusText }]}
        actions={
          importedHooksHealth.canRepair ? (
            <ActionPanel>
              <Action
                icon={Icon.WrenchScrewdriver}
                title="修复 Codex 导入冲突"
                onAction={repairImportedHooks}
              />
            </ActionPanel>
          ) : undefined
        }
      />
      {TARGETS.map((target) => {
        const installed = targetInstalled(status, target.id);

        return (
          <List.Item
            key={target.id}
            icon={installed ? Icon.CheckCircle : target.icon}
            title={target.title}
            subtitle={target.subtitle}
            accessories={[
              {
                text: installed ? "已安装" : "未安装",
                icon: installed ? Icon.Check : Icon.Circle,
              },
            ]}
            actions={
              <ActionPanel>
                <Action
                  icon={Icon.Download}
                  title={
                    installed ? `更新 ${target.title}` : `安装 ${target.title}`
                  }
                  onAction={() => installTarget(target.id, target.title)}
                />
                {installed ? (
                  <Action
                    icon={Icon.Trash}
                    title={`卸载 ${target.title}`}
                    style={Action.Style.Destructive}
                    onAction={() => uninstallTarget(target.id, target.title)}
                  />
                ) : null}
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
