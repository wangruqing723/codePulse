import { LaunchType, environment, showToast, type Toast } from "@raycast/api";

function isBackgroundToastError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Toast API is not available") &&
    message.includes("background")
  );
}

export function canShowToast(
  launchType: LaunchType = environment.launchType,
): boolean {
  return launchType !== LaunchType.Background;
}

export async function showToastIfAvailable(
  options: Toast.Options,
  launchType: LaunchType = environment.launchType,
): Promise<boolean> {
  if (!canShowToast(launchType)) {
    return false;
  }

  try {
    await showToast(options);
    return true;
  } catch (error) {
    if (isBackgroundToastError(error)) {
      return false;
    }

    throw error;
  }
}
