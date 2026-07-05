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
import { bootstrapCompanion } from "./companion/launch-control";
import { killCompanionProcess } from "./companion/process-control";
import {
  companionPreferencesRoot,
  saveCompanionPreferencesSnapshot,
} from "./lib/companion-preferences";
import {
  getHookInstallStatus,
  installHooks,
  uninstallHooks,
  type HookInstallStatus,
  type HookTarget,
} from "./lib/hooks";
import type { Preferences } from "./lib/types";

type SetupTarget = Exclude<HookTarget, "all">;

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

export async function handleLaunchCompanion(
  preferences: Pick<
    Preferences,
    "companionReleaseTag" | "companionManifestUrl"
  > = {},
): Promise<void> {
  await showToast({
    style: Toast.Style.Animated,
    title: "正在安装 / 启动 Floating Companion",
    message: "正在检查本地安装；如未安装会下载 release artifact。",
  });

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

export default function Command() {
  const preferences = useMemo(() => getPreferenceValues<Preferences>(), []);
  const [status, setStatus] = useState<HookInstallStatus>();
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      await saveCompanionPreferencesSnapshot(
        companionPreferencesRoot(),
        preferences,
      );
      setStatus(await getHookInstallStatus(environment.supportPath));
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
              title="Install / Start Floating Companion"
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
