import type { HookInstallStatus } from "./hooks";

export const CODEPULSE_CENTER_DEEPLINK =
  "raycast://extensions/code-pulse/code-pulse/setup-hooks";

interface CodexImportedHooksHealthSummary {
  state: "clean" | "conflict" | "invalid";
  count: number;
  error?: string;
}

export interface CodexImportHealthPresentation {
  state: "loading" | CodexImportedHooksHealthSummary["state"];
  statusText: string;
  error: string | undefined;
  canRepair: boolean;
}

export interface IndependentHookStatusRefreshOptions<T> {
  loadHookStatus: () => Promise<T>;
  commitHookStatus: (status: T) => void;
  commitHookError: (error: unknown) => void;
  runPrimaryRefresh: () => Promise<void>;
  onHookError?: (error: unknown) => void | Promise<void>;
  onPrimaryError?: (error: unknown) => void | Promise<void>;
}

export interface IndependentHookStatusRefreshResult {
  hookError: unknown | undefined;
  primaryError: unknown | undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function callErrorHandler(
  handler: ((error: unknown) => void | Promise<void>) | undefined,
  error: unknown,
): Promise<void> {
  try {
    await handler?.(error);
  } catch {
    // 刷新编排不能因错误提示自身失败而产生未处理拒绝。
  }
}

export async function runIndependentHookStatusRefresh<T>(
  options: IndependentHookStatusRefreshOptions<T>,
): Promise<IndependentHookStatusRefreshResult> {
  const hookRefresh = (async (): Promise<unknown | undefined> => {
    try {
      const status = await options.loadHookStatus();
      options.commitHookStatus(status);
      return undefined;
    } catch (error) {
      try {
        options.commitHookError(error);
      } catch {
        // 保留原始读取错误作为结果，提交错误由调用方的状态兜底处理。
      }
      await callErrorHandler(options.onHookError, error);
      return error;
    }
  })();

  const primaryRefresh = (async (): Promise<unknown | undefined> => {
    try {
      await options.runPrimaryRefresh();
      return undefined;
    } catch (error) {
      await callErrorHandler(options.onPrimaryError, error);
      return error;
    }
  })();

  const [hookError, primaryError] = await Promise.all([
    hookRefresh,
    primaryRefresh,
  ]);
  return { hookError, primaryError };
}

export function invalidCodexImportHookStatus(
  current: HookInstallStatus | undefined,
  error: unknown,
): HookInstallStatus {
  return {
    installed: current?.installed ?? false,
    claudeInstalled: current?.claudeInstalled ?? false,
    codexInstalled: current?.codexInstalled ?? false,
    hookPath: current?.hookPath ?? "",
    claudeSettingsPath: current?.claudeSettingsPath ?? "",
    codexConfigPath: current?.codexConfigPath ?? "",
    codexImportedHooks: {
      state: "invalid",
      hooksPath: current?.codexImportedHooks.hooksPath ?? "~/.codex/hooks.json",
      count: 0,
      eventNames: [],
      error: `无法检查 Codex hooks.json：${errorMessage(error)}`,
    },
  };
}

export function codexImportHealthPresentation(
  health: CodexImportedHooksHealthSummary | undefined,
): CodexImportHealthPresentation {
  if (!health) {
    return {
      state: "loading",
      statusText: "检查中",
      error: undefined,
      canRepair: false,
    };
  }

  if (health.state === "clean") {
    return {
      state: "clean",
      statusText: "正常",
      error: undefined,
      canRepair: false,
    };
  }

  if (health.state === "conflict") {
    return {
      state: "conflict",
      statusText: `${health.count} 项需修复`,
      error: undefined,
      canRepair: true,
    };
  }

  return {
    state: "invalid",
    statusText: "无法检查 hooks.json",
    error: health.error,
    canRepair: false,
  };
}

export function codexImportConflictWarning(
  health: CodexImportedHooksHealthSummary | undefined,
): string | undefined {
  if (health?.state !== "conflict") {
    return undefined;
  }

  return `Codex 导入冲突：${health.count} 项`;
}

export async function openCodePulseCenter(
  opener: (target: string) => Promise<void>,
): Promise<void> {
  await opener(CODEPULSE_CENTER_DEEPLINK);
}
