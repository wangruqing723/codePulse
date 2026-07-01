import { LaunchType, Toast } from "@raycast/api";
import type { SessionRecord, StateSnapshot } from "./types";
import { AGENT_LABEL, STATUS_LABEL } from "./types";
import { showToastIfAvailable } from "./toast";

function transitionShouldNotify(
  previous: SessionRecord | undefined,
  current: SessionRecord,
): boolean {
  if (!previous || previous.status === current.status) {
    return false;
  }

  return (
    current.status === "waiting" ||
    current.status === "done" ||
    current.status === "error"
  );
}

export async function notifyTransitions(
  previous: StateSnapshot | undefined,
  next: StateSnapshot,
  launchType?: LaunchType,
): Promise<void> {
  if (!previous) {
    return;
  }

  const previousById = new Map(
    previous.sessions.map((session) => [session.id, session]),
  );
  const changed = next.sessions.find((session) =>
    transitionShouldNotify(previousById.get(session.id), session),
  );

  if (!changed) {
    return;
  }

  const style =
    changed.status === "error" ? Toast.Style.Failure : Toast.Style.Success;
  await showToastIfAvailable(
    {
      style,
      title: `${STATUS_LABEL[changed.status]}: ${changed.projectName}`,
      message: AGENT_LABEL[changed.agent],
    },
    launchType,
  );
}
