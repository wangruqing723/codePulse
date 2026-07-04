import { execFile as execFileCallback } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

export type CompanionProcessMode = "dev" | "packaged";

export interface CompanionProcessRecord {
  pid: number;
  launcherPid?: number;
  startedAt: string;
  platform: NodeJS.Platform;
  mode: CompanionProcessMode;
  execPath: string;
  argv: string[];
}

export interface ProcessControlDeps {
  platform: NodeJS.Platform;
  homedir(): string;
  readFile: typeof readFile;
  writeFile: typeof writeFile;
  mkdir: typeof mkdir;
  rm: typeof rm;
  execFile(
    file: string,
    args: string[],
  ): Promise<{ stdout: string; stderr?: string }>;
  kill(pid: number, signal?: NodeJS.Signals | number): void;
}

interface ProcessSnapshot {
  pid: number;
  ppid: number;
  command: string;
}

const execFile = promisify(execFileCallback);
const PROCESS_RECORD_FILE = "process.json";

function createDefaultDeps(): ProcessControlDeps {
  return {
    platform: process.platform,
    homedir,
    readFile,
    writeFile,
    mkdir,
    rm,
    execFile: async (file, args) => execFile(file, args),
    kill: process.kill,
  };
}

let deps: ProcessControlDeps = createDefaultDeps();

export function companionControlRoot(homedirPath = deps.homedir()): string {
  return path.join(homedirPath, ".codepulse", "companion");
}

function processRecordPath(): string {
  return path.join(companionControlRoot(), PROCESS_RECORD_FILE);
}

async function readStoredRecord(): Promise<CompanionProcessRecord | undefined> {
  try {
    const raw = await deps.readFile(processRecordPath(), "utf8");
    return JSON.parse(raw) as CompanionProcessRecord;
  } catch {
    return undefined;
  }
}

async function writeStoredRecord(record: CompanionProcessRecord): Promise<void> {
  await deps.mkdir(companionControlRoot(), { recursive: true });
  await deps.writeFile(
    processRecordPath(),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8",
  );
}

function isMissingProcessError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return "code" in error && (error as NodeJS.ErrnoException).code === "ESRCH";
}

function splitCommand(command: string): string[] {
  return command.split(" ").filter(Boolean);
}

function buildMarkers(record: CompanionProcessRecord): string[] {
  return [record.execPath, ...record.argv].filter(Boolean);
}

function commandMatchesRecord(
  command: string,
  record: CompanionProcessRecord,
): boolean {
  return buildMarkers(record).every((marker) => command.includes(marker));
}

function parsePsOutput(stdout: string): ProcessSnapshot[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(.*)$/);
      if (!match) {
        return undefined;
      }

      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        command: match[3],
      } satisfies ProcessSnapshot;
    })
    .filter((entry): entry is ProcessSnapshot => entry !== undefined);
}

async function listProcesses(): Promise<ProcessSnapshot[]> {
  const result = await deps.execFile("ps", ["-axo", "pid=,ppid=,command="]);
  return parsePsOutput(result.stdout);
}

function collectTree(
  processes: ProcessSnapshot[],
  rootPids: number[],
): ProcessSnapshot[] {
  const byParent = new Map<number, ProcessSnapshot[]>();
  const byPid = new Map<number, ProcessSnapshot>();

  for (const processInfo of processes) {
    byPid.set(processInfo.pid, processInfo);
    const siblings = byParent.get(processInfo.ppid) ?? [];
    siblings.push(processInfo);
    byParent.set(processInfo.ppid, siblings);
  }

  const queue = [...new Set(rootPids)];
  const visited = new Set<number>();
  const matched: ProcessSnapshot[] = [];

  while (queue.length > 0) {
    const pid = queue.shift();
    if (pid === undefined || visited.has(pid)) {
      continue;
    }
    visited.add(pid);

    const processInfo = byPid.get(pid);
    if (!processInfo) {
      continue;
    }

    matched.push(processInfo);
    for (const child of byParent.get(pid) ?? []) {
      queue.push(child.pid);
    }
  }

  return matched;
}

function findProcess(
  processes: ProcessSnapshot[],
  pid: number | undefined,
): ProcessSnapshot | undefined {
  if (pid === undefined) {
    return undefined;
  }

  return processes.find((processInfo) => processInfo.pid === pid);
}

async function hasMatchingProcess(record: CompanionProcessRecord): Promise<boolean> {
  if (deps.platform === "win32") {
    try {
      deps.kill(record.pid, 0);
      return true;
    } catch (error) {
      if (isMissingProcessError(error)) {
        return false;
      }
      throw error;
    }
  }

  const processes = await listProcesses();
  const recordedProcess = findProcess(processes, record.pid);
  if (recordedProcess && commandMatchesRecord(recordedProcess.command, record)) {
    return true;
  }

  return processes.some((processInfo) =>
    commandMatchesRecord(processInfo.command, record),
  );
}

async function resolveMatchedProcesses(
  record: CompanionProcessRecord,
): Promise<ProcessSnapshot[]> {
  if (deps.platform === "win32") {
    const candidates = [record.pid, record.launcherPid].filter(
      (value): value is number => typeof value === "number",
    );
    return candidates.map((pid) => ({ pid, ppid: 0, command: "" }));
  }

  const processes = await listProcesses();
  const launcherProcess = findProcess(processes, record.launcherPid);
  const recordedProcess = findProcess(processes, record.pid);
  const exactRootPids = [launcherProcess, recordedProcess]
    .filter(
      (processInfo): processInfo is ProcessSnapshot =>
        processInfo !== undefined &&
        commandMatchesRecord(processInfo.command, record),
    )
    .map((processInfo) => processInfo.pid);

  if (exactRootPids.length > 0) {
    return collectTree(processes, exactRootPids);
  }

  const fallbackRoots = processes
    .filter((processInfo) => commandMatchesRecord(processInfo.command, record))
    .map((processInfo) => processInfo.pid);

  return collectTree(processes, fallbackRoots);
}

export async function readCompanionProcessRecord(): Promise<
  CompanionProcessRecord | undefined
> {
  const record = await readStoredRecord();
  if (!record) {
    return undefined;
  }

  if (await hasMatchingProcess(record)) {
    return record;
  }

  await clearCompanionProcessRecord();
  return undefined;
}

export async function registerCompanionProcess(
  record: CompanionProcessRecord,
): Promise<void> {
  await writeStoredRecord(record);
}

export async function clearCompanionProcessRecord(): Promise<void> {
  await deps.rm(processRecordPath(), { force: true });
}

export async function killCompanionProcess(): Promise<{
  status: "killed" | "not-found";
  matchedPids: number[];
}> {
  const record = await readStoredRecord();
  if (!record) {
    return { status: "not-found", matchedPids: [] };
  }

  const matchedProcesses = await resolveMatchedProcesses(record);
  const matchedPids = [...new Set(matchedProcesses.map((entry) => entry.pid))].sort(
    (left, right) => left - right,
  );

  if (matchedPids.length === 0) {
    await clearCompanionProcessRecord();
    return { status: "not-found", matchedPids: [] };
  }

  if (deps.platform === "win32") {
    await deps.execFile("taskkill", [
      "/PID",
      String(matchedPids[0]),
      "/T",
      "/F",
    ]);
  } else {
    for (const pid of [...matchedPids].sort((left, right) => right - left)) {
      try {
        deps.kill(pid);
      } catch (error) {
        if (!isMissingProcessError(error)) {
          throw error;
        }
      }
    }
  }

  await clearCompanionProcessRecord();
  return { status: "killed", matchedPids };
}

export async function runCompanionKillCli(
  stdout: Pick<Console, "log"> = console,
  stderr: Pick<Console, "error"> = console,
): Promise<number> {
  try {
    const result = await killCompanionProcess();
    if (result.status === "not-found") {
      stdout.log("CodePulse companion process not found.");
      return 0;
    }

    stdout.log(
      `Killed CodePulse companion process tree: ${result.matchedPids.join(", ")}`,
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.error(`Failed to kill CodePulse companion process tree: ${message}`);
    return 1;
  }
}

export const __testing__ = {
  setDeps(partial: Partial<ProcessControlDeps>): void {
    deps = {
      ...createDefaultDeps(),
      ...partial,
    };
  },
  setExecFileResult(result: { stdout: string; stderr?: string }): void {
    deps.execFile = viFn(async () => result);
  },
  resetDeps(): void {
    deps = createDefaultDeps();
  },
};

function viFn<TArgs extends unknown[], TResult>(
  implementation: (...args: TArgs) => TResult,
): (...args: TArgs) => TResult {
  return implementation;
}
