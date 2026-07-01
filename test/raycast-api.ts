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
};

export const showToast = vi.fn(async () => undefined);
