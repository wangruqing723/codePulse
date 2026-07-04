export const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 750;

const SIGNAL_EXIT_CODES = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
};

function exitCodeForSignal(signal) {
  return SIGNAL_EXIT_CODES[signal] ?? 1;
}

export function attachChildLifecycle(child, hostProcess = process) {
  let shutdownTimer;
  let hostExitRequested = false;

  const clearShutdownTimer = () => {
    clearTimeout(shutdownTimer);
    shutdownTimer = undefined;
  };

  const exitHost = (code) => {
    if (hostExitRequested) {
      return;
    }

    hostExitRequested = true;
    hostProcess.exit(code);
  };

  const requestShutdown = (signal) => {
    if (child.exitCode !== null) {
      exitHost(exitCodeForSignal(signal));
      return;
    }

    child.kill(signal);
    clearShutdownTimer();
    shutdownTimer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }

      exitHost(exitCodeForSignal(signal));
    }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);
    shutdownTimer.unref?.();
  };

  child.on("exit", (code, signal) => {
    clearShutdownTimer();
    if (hostExitRequested) {
      return;
    }

    if (typeof code === "number") {
      exitHost(code);
      return;
    }

    exitHost(exitCodeForSignal(signal));
  });

  hostProcess.on("SIGINT", () => {
    requestShutdown("SIGINT");
  });
  hostProcess.on("SIGTERM", () => {
    requestShutdown("SIGTERM");
  });
  hostProcess.on("SIGHUP", () => {
    requestShutdown("SIGHUP");
  });
  hostProcess.on("exit", () => {
    clearShutdownTimer();
    if (child.exitCode === null) {
      child.kill("SIGTERM");
    }
  });
}
