import {
  Alert,
  Clipboard,
  Icon,
  MenuBarExtra,
  Toast,
  confirmAlert,
  environment,
  getPreferenceValues,
  open,
} from "@raycast/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CodexNotifyConflictError,
  getHookInstallStatus,
  installHooks,
  uninstallHooks,
  type HookInstallStatus,
  type HookTarget,
} from "./lib/hooks";
import { focusTerminalSession } from "./lib/terminal";
import { notifyTransitions } from "./lib/notifications";
import {
  companionPreferencesRoot,
  saveCompanionPreferencesSnapshot,
} from "./lib/companion-preferences";
import {
  itemSubtitle,
  partitionSessionsByOrigin,
  sessionAgentLabel,
} from "./lib/session-labels";
import { buildState, eventsPath } from "./lib/state";
import { showToastIfAvailable } from "./lib/toast";
import {
  codexImportConflictWarning,
  invalidCodexImportHookStatus,
  openCodePulseCenter,
  runIndependentHookStatusRefresh,
} from "./lib/codex-import-ui";
import type {
  Preferences,
  SessionRecord,
  SessionStatus,
  StateSnapshot,
} from "./lib/types";
import { STATUS_ICON, STATUS_LABEL } from "./lib/types";

const REFRESH_INTERVAL_MS = 5_000;

const EMPTY_COUNTS: Record<SessionStatus, number> = {
  running: 0,
  waiting: 0,
  done: 0,
  idle: 0,
  error: 0,
};

const SECTION_ORDER: SessionStatus[] = [
  "waiting",
  "error",
  "running",
  "done",
  "idle",
];

const DELEGATED_STATUS_LABEL: Record<SessionStatus, string> = {
  running: "委托中",
  waiting: "委托待确认",
  done: "委托完成",
  idle: "委托空闲",
  error: "委托出错",
};

interface SessionSection {
  key: string;
  title: string;
  sessions: SessionRecord[];
}

type SetupTarget = Exclude<HookTarget, "all">;

const SETUP_TARGETS: Array<{
  id: SetupTarget;
  title: string;
  icon: Icon;
}> = [
  { id: "claude", title: "Claude Code", icon: Icon.Terminal },
  { id: "codex", title: "Codex", icon: Icon.Code },
];

function dominantStatus(snapshot: StateSnapshot | undefined): SessionStatus {
  const counts = snapshot?.counts ?? EMPTY_COUNTS;
  if (counts.waiting > 0) return "waiting";
  if (counts.error > 0) return "error";
  if (counts.running > 0) return "running";
  if (counts.done > 0) return "done";
  return "idle";
}

function menuBarTitle(
  snapshot: StateSnapshot | undefined,
  style: Preferences["menuBarStyle"],
): string {
  const status = dominantStatus(snapshot);
  const counts = snapshot?.counts ?? EMPTY_COUNTS;
  const icon = STATUS_ICON[status];

  if (style === "icon") {
    return icon;
  }

  if (style === "session") {
    const session = snapshot?.sessions.find((item) => item.status === status);
    return session ? `${icon} ${session.projectName}` : icon;
  }

  const count = counts[status];
  return count > 0 ? `${icon}${count}` : icon;
}

function countsForSessions(
  sessions: SessionRecord[],
): Record<SessionStatus, number> {
  return {
    running: sessions.filter((session) => session.status === "running").length,
    waiting: sessions.filter((session) => session.status === "waiting").length,
    done: sessions.filter((session) => session.status === "done").length,
    idle: sessions.filter((session) => session.status === "idle").length,
    error: sessions.filter((session) => session.status === "error").length,
  };
}

function snapshotForSessions(
  snapshot: StateSnapshot | undefined,
  sessions: SessionRecord[],
): StateSnapshot | undefined {
  return snapshot
    ? {
        ...snapshot,
        sessions,
        counts: countsForSessions(sessions),
      }
    : undefined;
}

function sectionForStatus(
  sessions: SessionRecord[],
  kind: "user" | "delegated",
  status: SessionStatus,
): SessionSection | undefined {
  const matching = sessions.filter((session) => session.status === status);
  if (matching.length === 0) {
    return undefined;
  }

  const label =
    kind === "delegated"
      ? DELEGATED_STATUS_LABEL[status]
      : STATUS_LABEL[status];

  return {
    key: `${kind}-${status}`,
    title: `${STATUS_ICON[status]} ${label} (${matching.length})`,
    sessions: matching,
  };
}

function iconForStatus(status: SessionStatus): Icon {
  if (status === "waiting") return Icon.ExclamationMark;
  if (status === "error") return Icon.XMarkCircle;
  if (status === "running") return Icon.CircleProgress;
  if (status === "done") return Icon.CheckCircle;
  return Icon.Circle;
}

function targetInstalled(
  status: HookInstallStatus | undefined,
  target: SetupTarget,
): boolean {
  if (!status) {
    return false;
  }

  return target === "claude" ? status.claudeInstalled : status.codexInstalled;
}

function SessionItem({ session }: { session: SessionRecord }) {
  return (
    <MenuBarExtra.Submenu
      key={session.id}
      icon={iconForStatus(session.status)}
      title={`${session.projectName} · ${sessionAgentLabel(session)} · ${itemSubtitle(session)}`}
    >
      <MenuBarExtra.Item
        title="切回 iTerm2"
        icon={Icon.Terminal}
        onAction={() => focusTerminalSession(session.cwd)}
      />
      {session.cwd ? (
        <MenuBarExtra.Item
          title="复制项目路径"
          icon={Icon.Clipboard}
          onAction={async () => {
            await Clipboard.copy(session.cwd ?? "");
            await showToastIfAvailable({
              style: Toast.Style.Success,
              title: "已复制项目路径",
            });
          }}
        />
      ) : null}
      {session.transcriptPath ? (
        <MenuBarExtra.Item
          title="打开 Transcript"
          icon={Icon.Document}
          onAction={() => open(session.transcriptPath ?? "")}
        />
      ) : null}
    </MenuBarExtra.Submenu>
  );
}

export default function Command() {
  const preferences = useMemo(() => getPreferenceValues<Preferences>(), []);
  const [snapshot, setSnapshot] = useState<StateSnapshot>();
  const [hookStatus, setHookStatus] = useState<HookInstallStatus>();
  const [isLoading, setIsLoading] = useState(true);
  const mountedRef = useRef(true);
  const refreshingRef = useRef(false);

  const refresh = useCallback(
    async (showLoading = false) => {
      if (refreshingRef.current) {
        return;
      }

      refreshingRef.current = true;
      if (showLoading && mountedRef.current) {
        setIsLoading(true);
      }
      try {
        await runIndependentHookStatusRefresh({
          loadHookStatus: () => getHookInstallStatus(environment.supportPath),
          commitHookStatus: (nextHookStatus) => {
            if (mountedRef.current) {
              setHookStatus(nextHookStatus);
            }
          },
          commitHookError: (error) => {
            if (mountedRef.current) {
              setHookStatus((current) =>
                invalidCodexImportHookStatus(current, error),
              );
            }
          },
          runPrimaryRefresh: async () => {
            await saveCompanionPreferencesSnapshot(
              companionPreferencesRoot(),
              preferences,
              eventsPath(environment.supportPath),
            );
            const result = await buildState(
              environment.supportPath,
              preferences,
            );
            await notifyTransitions(result.previous, result.snapshot);
            if (mountedRef.current) {
              setSnapshot(result.snapshot);
            }
          },
          onPrimaryError: async (error) => {
            await showToastIfAvailable({
              style: Toast.Style.Failure,
              title: "CodePulse 刷新失败",
              message: error instanceof Error ? error.message : String(error),
            });
          },
        });
      } finally {
        refreshingRef.current = false;
        if (showLoading && mountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    [preferences],
  );

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
        setHookStatus(next);
        await showToastIfAvailable({
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
            setHookStatus(next);
            await showToastIfAvailable({
              style: Toast.Style.Success,
              title: `${title} Hook 已安装`,
            });
          } catch (forceError) {
            await showToastIfAvailable({
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

        await showToastIfAvailable({
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
        setHookStatus(next);
        await showToastIfAvailable({
          style: Toast.Style.Success,
          title: `${title} Hook 已卸载`,
        });
      } catch (error) {
        await showToastIfAvailable({
          style: Toast.Style.Failure,
          title: `${title} Hook 卸载失败`,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    void refresh(true);
    const interval = setInterval(() => {
      void refresh();
    }, REFRESH_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [refresh]);

  const presentation = useMemo(() => {
    const sessions = snapshot?.sessions ?? [];
    const { userSessions, delegatedSessions } =
      partitionSessionsByOrigin(sessions);

    return {
      userSnapshot: snapshotForSessions(snapshot, userSessions),
      sections: SECTION_ORDER.flatMap((status) =>
        [
          sectionForStatus(userSessions, "user", status),
          sectionForStatus(delegatedSessions, "delegated", status),
        ].filter((section): section is SessionSection => !!section),
      ),
    };
  }, [snapshot]);
  const importedHooksWarning = codexImportConflictWarning(
    hookStatus?.codexImportedHooks,
  );

  return (
    <MenuBarExtra
      title={menuBarTitle(presentation.userSnapshot, preferences.menuBarStyle)}
      isLoading={isLoading}
    >
      {presentation.sections.length === 0 ? (
        <MenuBarExtra.Item
          icon={Icon.Circle}
          title="暂无近期会话"
          subtitle="Claude Code / Codex"
        />
      ) : (
        presentation.sections.map((section) => (
          <MenuBarExtra.Section key={section.key} title={section.title}>
            {section.sessions.map((session) => (
              <SessionItem key={session.id} session={session} />
            ))}
          </MenuBarExtra.Section>
        ))
      )}

      <MenuBarExtra.Section>
        {importedHooksWarning ? (
          <MenuBarExtra.Item
            icon={Icon.Warning}
            title={importedHooksWarning}
            onAction={() => openCodePulseCenter(open)}
          />
        ) : null}
        <MenuBarExtra.Item
          icon={Icon.ArrowClockwise}
          title="刷新"
          onAction={() => refresh(true)}
        />
        <MenuBarExtra.Submenu icon={Icon.Gear} title="CodePulse Center">
          {SETUP_TARGETS.map((target) => {
            const installed = targetInstalled(hookStatus, target.id);

            return (
              <MenuBarExtra.Item
                key={`${target.id}-install`}
                icon={installed ? Icon.CheckCircle : target.icon}
                title={
                  installed
                    ? `更新 ${target.title} Hook`
                    : `安装 ${target.title} Hook`
                }
                subtitle={installed ? "已安装" : "未安装"}
                onAction={() => installTarget(target.id, target.title)}
              />
            );
          })}
          {SETUP_TARGETS.map((target) =>
            targetInstalled(hookStatus, target.id) ? (
              <MenuBarExtra.Item
                key={`${target.id}-uninstall`}
                icon={Icon.Trash}
                title={`卸载 ${target.title} Hook`}
                onAction={() => uninstallTarget(target.id, target.title)}
              />
            ) : null,
          )}
          <MenuBarExtra.Item
            icon={Icon.AppWindowSidebarLeft}
            title="打开 CodePulse Center"
            onAction={() => openCodePulseCenter(open)}
          />
        </MenuBarExtra.Submenu>
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}
