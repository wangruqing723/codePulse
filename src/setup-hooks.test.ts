import { showToast } from "@raycast/api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapCompanion } from "./companion/launch-control";
import { handleLaunchCompanion } from "./setup-hooks";

vi.mock("./companion/launch-control", () => ({
  bootstrapCompanion: vi.fn(),
}));

describe("CodePulse Center companion bootstrap action", () => {
  beforeEach(() => {
    vi.mocked(showToast).mockClear();
    vi.mocked(bootstrapCompanion).mockReset();
  });

  it("shows a success toast after launching the companion", async () => {
    vi.mocked(bootstrapCompanion).mockResolvedValue({
      status: "launched",
      path: "/raycast/support/companion/0.1.3/darwin-arm64/CodePulse Companion.app",
    });

    await handleLaunchCompanion({
      companionReleaseTag: "codepulse-companion-v0.1.3",
      companionManifestUrl: "",
    });

    expect(bootstrapCompanion).toHaveBeenCalledWith({
      supportPath: expect.any(String),
      releaseTag: "codepulse-companion-v0.1.3",
      manifestUrl: "",
    });
    expect(showToast).toHaveBeenCalledWith({
      style: "success",
      title: "Floating Companion 已启动",
      message:
        "/raycast/support/companion/0.1.3/darwin-arm64/CodePulse Companion.app",
    });
  });

  it("shows an in-progress toast before waiting for companion bootstrap", async () => {
    let resolveBootstrap: (
      result: Awaited<ReturnType<typeof bootstrapCompanion>>,
    ) => void = () => undefined;
    vi.mocked(bootstrapCompanion).mockReturnValue(
      new Promise((resolve) => {
        resolveBootstrap = resolve;
      }),
    );

    const launch = handleLaunchCompanion({});
    await Promise.resolve();

    expect(showToast).toHaveBeenCalledWith({
      style: "animated",
      title: "正在安装 / 启动 Floating Companion",
      message: "正在检查本地安装；如未安装会下载 release artifact。",
    });

    resolveBootstrap({
      status: "launched",
      path: "/raycast/support/companion/0.1.3/darwin-arm64/CodePulse Companion.app",
    });
    await launch;
  });

  it.each([
    [
      { status: "release-unavailable", message: "manifest" },
      "Release artifact 不可用",
      "请先将仓库转为公开并发布 companion release。",
    ],
    [
      { status: "unsupported-platform", platformKey: "linux-x64" },
      "当前平台暂不支持 Floating Companion",
      "linux-x64",
    ],
    [
      { status: "hash-mismatch", expected: "a", actual: "b" },
      "Floating Companion 校验失败",
      "下载内容与 manifest SHA-256 不一致。",
    ],
    [
      { status: "install-failed", message: "ditto failed" },
      "Floating Companion 安装失败",
      "ditto failed",
    ],
  ])(
    "shows a specific failure toast for %s",
    async (result, title, message) => {
      vi.mocked(bootstrapCompanion).mockResolvedValue(result as never);

      await handleLaunchCompanion({});

      expect(showToast).toHaveBeenCalledWith({
        style: "failure",
        title,
        message,
      });
    },
  );
});
