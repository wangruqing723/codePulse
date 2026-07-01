import {
  Clipboard,
  Icon,
  MenuBarExtra,
  Toast,
  environment,
  getPreferenceValues,
  open,
} from "@raycast/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { focusTerminalSession } from "./lib/terminal";
import { notifyTransitions } from "./lib/notifications";
import { itemSubtitle } from "./lib/session-labels";
import { buildState } from "./lib/state";
import { showToastIfAvailable } from "./lib/toast";
import type {
  Preferences,
  SessionRecord,
  SessionStatus,
  StateSnapshot,
} from "./lib/types";
import { AGENT_LABEL, STATUS_ICON, STATUS_LABEL } from "./lib/types";

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

function iconForStatus(status: SessionStatus): Icon {
  if (status === "waiting") return Icon.ExclamationMark;
  if (status === "error") return Icon.XMarkCircle;
  if (status === "running") return Icon.CircleProgress;
  if (status === "done") return Icon.CheckCircle;
  return Icon.Circle;
}

function SessionItem({ session }: { session: SessionRecord }) {
  return (
    <MenuBarExtra.Submenu
      key={session.id}
      icon={iconForStatus(session.status)}
      title={`${session.projectName} · ${AGENT_LABEL[session.agent]} · ${itemSubtitle(session)}`}
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
        const result = await buildState(environment.supportPath, preferences);
        await notifyTransitions(result.previous, result.snapshot);
        if (mountedRef.current) {
          setSnapshot(result.snapshot);
        }
      } catch (error) {
        await showToastIfAvailable({
          style: Toast.Style.Failure,
          title: "CodePulse 刷新失败",
          message: error instanceof Error ? error.message : String(error),
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

  const grouped = useMemo(() => {
    const sessions = snapshot?.sessions ?? [];
    return SECTION_ORDER.map((status) => ({
      status,
      sessions: sessions.filter((session) => session.status === status),
    })).filter((section) => section.sessions.length > 0);
  }, [snapshot]);

  return (
    <MenuBarExtra
      title={menuBarTitle(snapshot, preferences.menuBarStyle)}
      isLoading={isLoading}
    >
      {grouped.length === 0 ? (
        <MenuBarExtra.Item
          icon={Icon.Circle}
          title="暂无近期会话"
          subtitle="Claude Code / Codex"
        />
      ) : (
        grouped.map((section) => (
          <MenuBarExtra.Section
            key={section.status}
            title={`${STATUS_ICON[section.status]} ${STATUS_LABEL[section.status]} (${section.sessions.length})`}
          >
            {section.sessions.map((session) => (
              <SessionItem key={session.id} session={session} />
            ))}
          </MenuBarExtra.Section>
        ))
      )}

      <MenuBarExtra.Section>
        <MenuBarExtra.Item
          icon={Icon.ArrowClockwise}
          title="刷新"
          onAction={() => refresh(true)}
        />
        <MenuBarExtra.Item
          icon={Icon.Gear}
          title="设置 Hooks"
          onAction={async () => {
            await open(
              "raycast://extensions/ruqing_wang/codepulse/setup-hooks",
            );
          }}
        />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}
