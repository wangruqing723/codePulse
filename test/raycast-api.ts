import { vi } from "vitest";

export const LaunchType = {
  UserInitiated: "userInitiated",
  Background: "background",
} as const;

export const Toast = {
  Style: {
    Success: "success",
    Failure: "failure",
  },
} as const;

export const environment = {
  launchType: LaunchType.UserInitiated,
  supportPath: "/tmp/codepulse-support",
};

export const Alert = {
  ActionStyle: {
    Destructive: "destructive",
  },
} as const;

export const Icon = {
  AppWindow: "app-window",
  AppWindowSidebarLeft: "app-window-sidebar-left",
  Check: "check",
  CheckCircle: "check-circle",
  Circle: "circle",
  Code: "code",
  Download: "download",
  Info: "info",
  Play: "play",
  Terminal: "terminal",
  Trash: "trash",
  XMarkCircle: "x-mark-circle",
} as const;

export function Action(_props: unknown) {
  return undefined;
}

Action.Style = {
  Destructive: "destructive",
};

export function ActionPanel(_props: unknown) {
  return undefined;
}

export function List(_props: unknown) {
  return undefined;
}

List.Item = function ListItem(_props: unknown) {
  return undefined;
};

export const confirmAlert = vi.fn(async () => true);
export const getPreferenceValues = vi.fn(() => ({}));
export const open = vi.fn(async () => undefined);
export const showToast = vi.fn(async () => undefined);
