import {
  Alert,
  Toast,
  confirmAlert,
  environment,
  showToast,
} from "@raycast/api";
import {
  getHookInstallStatus,
  installHooks,
  uninstallHooks,
} from "./lib/hooks";

export default async function Command() {
  const status = await getHookInstallStatus(environment.supportPath);

  if (status.installed) {
    const shouldUninstall = await confirmAlert({
      title: "卸载 CodePulse Hooks?",
      message:
        "将移除 CodePulse 写入的 Claude hooks 和 Codex notify，保留其他配置。",
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

    await uninstallHooks(environment.supportPath);
    await showToast({
      style: Toast.Style.Success,
      title: "CodePulse Hooks 已卸载",
    });
    return;
  }

  const shouldInstall = await confirmAlert({
    title: "安装 CodePulse Hooks?",
    message:
      "将安装或更新 Claude hooks 和 Codex notify。会先备份配置；脚本异常时会静默退出，不阻塞 CLI。",
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

  await installHooks(environment.supportPath);
  await showToast({
    style: Toast.Style.Success,
    title: "CodePulse Hooks 已安装",
  });
}
