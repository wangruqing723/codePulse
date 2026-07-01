import { Clipboard, Toast } from "@raycast/api";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { showToastIfAvailable } from "./toast";

const execFileAsync = promisify(execFile);

async function focusWithITermPython(cwd: string): Promise<void> {
  const script = `
import sys
import iterm2

target = sys.argv[1]

async def main(connection):
    app = await iterm2.async_get_app(connection)
    for window in app.terminal_windows:
        for tab in window.tabs:
            for session in tab.sessions:
                try:
                    session_path = await session.async_get_variable("path")
                except Exception:
                    session_path = None
                if session_path == target:
                    await session.async_activate()
                    await tab.async_select()
                    await window.async_activate()
                    return
    raise RuntimeError("No iTerm2 session matched cwd")

iterm2.run_until_complete(main)
`;

  await execFileAsync("python3", ["-c", script, cwd], { timeout: 3000 });
}

async function activateITerm(): Promise<void> {
  await execFileAsync(
    "osascript",
    ["-e", 'tell application "iTerm2" to activate'],
    { timeout: 3000 },
  );
}

export async function focusTerminalSession(
  cwd: string | undefined,
): Promise<void> {
  if (!cwd) {
    await showToastIfAvailable({
      style: Toast.Style.Failure,
      title: "没有可用项目路径",
    });
    return;
  }

  try {
    await focusWithITermPython(cwd);
    return;
  } catch {
    // 降级路径：iTerm2 Python API 不可用时至少唤起终端。
  }

  try {
    await activateITerm();
    await Clipboard.copy(cwd);
    await showToastIfAvailable({
      style: Toast.Style.Success,
      title: "已唤起 iTerm2",
      message: "项目路径已复制",
    });
  } catch {
    await Clipboard.copy(cwd);
    await showToastIfAvailable({
      style: Toast.Style.Failure,
      title: "无法唤起 iTerm2",
      message: "项目路径已复制",
    });
  }
}
