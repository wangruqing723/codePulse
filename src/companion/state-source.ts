import path from "node:path";
import type { StateBuildConfig } from "../lib/state";
import type { Preferences } from "../lib/types";
import { resolveDefaultWslContext, type WslContext } from "../lib/wsl";
import type { CompanionPlatform, FloatingViewModelContext } from "./view-model";

export interface ResolveCompanionStateSourceOptions {
  stateRoot: string;
  preferences: Preferences;
  resolveDefaultWslContext?: () => Promise<WslContext>;
}

export interface AvailableCompanionStateSource {
  kind: "available";
  platform: CompanionPlatform;
  stateConfig: Pick<
    StateBuildConfig,
    "stateRoot" | "eventRoot" | "scanRoots" | "preferences"
  >;
  viewModelContext: FloatingViewModelContext;
}

export interface UnavailableCompanionStateSource {
  kind: "unavailable";
  platform: "win32";
  unavailableReason: string;
  viewModelContext: FloatingViewModelContext;
}

export type CompanionStateSource =
  AvailableCompanionStateSource | UnavailableCompanionStateSource;

function wslRoot(homeUncPath: string, ...segments: string[]): string {
  return path.win32.join(homeUncPath, ...segments);
}

export async function resolveCompanionStateSource(
  platform: CompanionPlatform,
  options: ResolveCompanionStateSourceOptions,
): Promise<CompanionStateSource> {
  if (platform === "darwin") {
    return {
      kind: "available",
      platform,
      stateConfig: {
        stateRoot: options.stateRoot,
        preferences: options.preferences,
      },
      viewModelContext: {
        platform,
      },
    };
  }

  try {
    const wslContext = await (
      options.resolveDefaultWslContext ?? resolveDefaultWslContext
    )();

    return {
      kind: "available",
      platform,
      stateConfig: {
        stateRoot: options.stateRoot,
        eventRoot: wslRoot(wslContext.homeUncPath, ".codepulse", "events"),
        scanRoots: {
          claudeProjectsRoot: wslRoot(
            wslContext.homeUncPath,
            ".claude",
            "projects",
          ),
          codexSessionsRoot: wslRoot(
            wslContext.homeUncPath,
            ".codex",
            "sessions",
          ),
        },
        preferences: options.preferences,
      },
      viewModelContext: {
        platform,
        wslDistro: wslContext.distro,
      },
    };
  } catch (error) {
    const unavailableReason =
      error instanceof Error ? error.message : String(error);

    return {
      kind: "unavailable",
      platform,
      unavailableReason,
      viewModelContext: {
        platform,
        unavailableReason,
      },
    };
  }
}
