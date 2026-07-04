import { describe, expect, it, vi } from "vitest";

import {
  attachChildLifecycle,
  GRACEFUL_SHUTDOWN_TIMEOUT_MS,
} from "../scripts/run-companion-dev-lib.mjs";

type SignalName = "SIGINT" | "SIGTERM" | "SIGHUP" | "SIGKILL";

function createHost() {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const host = {
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, listener);
      return host;
    }),
    exit: vi.fn(),
  };

  return { host, listeners };
}

function createChild() {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const child = {
    exitCode: null as number | null,
    kill: vi.fn((_signal?: SignalName) => true),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, listener);
      return child;
    }),
  };

  return { child, listeners };
}

describe("companion dev child lifecycle", () => {
  it("forwards SIGINT to the child and exits with the propagated signal code", () => {
    const { host, listeners: hostListeners } = createHost();
    const { child, listeners: childListeners } = createChild();

    attachChildLifecycle(child as never, host as never);
    hostListeners.get("SIGINT")?.();
    childListeners.get("exit")?.(null, "SIGINT");

    expect(child.kill).toHaveBeenCalledWith("SIGINT");
    expect(host.exit).toHaveBeenCalledWith(130);
  });

  it("escalates to SIGKILL if the child ignores the shutdown signal", () => {
    vi.useFakeTimers();
    const { host, listeners: hostListeners } = createHost();
    const { child } = createChild();

    attachChildLifecycle(child as never, host as never);
    hostListeners.get("SIGTERM")?.();
    vi.advanceTimersByTime(GRACEFUL_SHUTDOWN_TIMEOUT_MS);

    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    expect(host.exit).toHaveBeenCalledWith(143);
    vi.useRealTimers();
  });

  it("kills the child when the host exits normally", () => {
    const { host, listeners: hostListeners } = createHost();
    const { child } = createChild();

    attachChildLifecycle(child as never, host as never);
    hostListeners.get("exit")?.();

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
