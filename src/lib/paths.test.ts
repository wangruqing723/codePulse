import { describe, expect, it } from "vitest";
import { matchesMonitorPrefixes } from "./paths";

describe("matchesMonitorPrefixes", () => {
  it("matches POSIX monitor prefixes on path boundaries", () => {
    expect(
      matchesMonitorPrefixes("/home/user/project/app", ["/home/user/project"]),
    ).toBe(true);
  });

  it("matches WSL UNC prefixes after normalizing separators", () => {
    expect(
      matchesMonitorPrefixes("\\\\wsl$\\Ubuntu\\home\\user\\project\\app", [
        "\\\\wsl$\\Ubuntu\\home\\user\\project",
      ]),
    ).toBe(true);
  });
});
