import { runCompanionKillCli } from "./process-control";

void runCompanionKillCli().then((code) => {
  process.exitCode = code;
});
