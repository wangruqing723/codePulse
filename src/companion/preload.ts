import { contextBridge, ipcRenderer } from "electron";
import type { DockEdge } from "./geometry";
import type { FloatingViewModel } from "./view-model";

type WindowAction =
  "pin" | "minimize" | "close" | "hover-enter" | "hover-leave";

export interface CompanionBridge {
  copyText(value: string): Promise<void>;
  forceExitCompanion(): void;
  getState(): Promise<FloatingViewModel | undefined>;
  requestDock(edge: DockEdge): void;
  requestWindowAction(action: WindowAction): void;
  subscribe(listener: (model: FloatingViewModel) => void): () => void;
}

const bridge: CompanionBridge = {
  async copyText(value) {
    await ipcRenderer.invoke("companion:copy-text", value);
  },
  forceExitCompanion() {
    ipcRenderer.send("companion:force-exit");
  },
  getState() {
    return ipcRenderer.invoke("companion:get-state") as Promise<
      FloatingViewModel | undefined
    >;
  },
  requestDock(edge) {
    ipcRenderer.send("companion:dock-request", edge);
  },
  requestWindowAction(action) {
    ipcRenderer.send("companion:window-action", action);
  },
  subscribe(listener) {
    const handler = (_event: unknown, model: FloatingViewModel) => {
      listener(model);
    };

    ipcRenderer.on("companion:view-model", handler);
    return () => {
      ipcRenderer.removeListener("companion:view-model", handler);
    };
  },
};

contextBridge.exposeInMainWorld("codePulseCompanion", bridge);
