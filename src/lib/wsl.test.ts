import { describe, expect, it } from "vitest";
import { parseDefaultDistroFromList, parseWslHome, toWslUncPath } from "./wsl";

describe("wsl helpers", () => {
  it("converts absolute WSL paths to UNC paths", () => {
    expect(toWslUncPath("Ubuntu", "/home/user/project")).toBe(
      "\\\\wsl$\\Ubuntu\\home\\user\\project",
    );
  });

  it("returns undefined for relative WSL paths", () => {
    expect(toWslUncPath("Ubuntu", "project")).toBeUndefined();
  });

  it("parses the default distro from plain wsl.exe output", () => {
    expect(parseDefaultDistroFromList("* Ubuntu Running 2\n")).toBe("Ubuntu");
  });

  it("parses the default distro from null-padded wsl.exe output", () => {
    expect(
      parseDefaultDistroFromList(
        "*\u0000 \u0000U\u0000b\u0000u\u0000n\u0000t\u0000u\u0000\n",
      ),
    ).toBe("Ubuntu");
  });

  it("parses the WSL home directory from shell output", () => {
    expect(parseWslHome("/home/user\n")).toBe("/home/user");
  });
});
