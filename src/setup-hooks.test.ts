import { showToast } from "@raycast/api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapCompanion } from "./companion/launch-control";
import { handleLaunchCompanion } from "./setup-hooks";

vi.mock("./companion/launch-control", () => ({
  bootstrapCompanion: vi.fn(),
}));

describe("CodePulse Center companion bootstrap action", () => {
  const toast = {
    style: "animated",
    title: "",
    message: undefined as string | undefined,
  };

  beforeEach(() => {
    vi.mocked(showToast).mockClear();
    vi.mocked(bootstrapCompanion).mockReset();
    toast.style = "animated";
    toast.title = "";
    toast.message = undefined;
    vi.mocked(showToast).mockResolvedValue(toast as never);
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
      onProgress: expect.any(Function),
    });
    expect(toast).toMatchObject({
      style: "success",
      title: "Floating Companion 已启动",
      message:
        "/raycast/support/companion/0.1.3/darwin-arm64/CodePulse Companion.app",
    });
  });

  it("updates the in-progress toast while companion bootstrap reports progress", async () => {
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
      title: "正在安装 / 更新 / 启动 Floating Companion",
      message: "正在检查当前版本；如需更新会下载 release artifact。",
    });

    const onProgress =
      vi.mocked(bootstrapCompanion).mock.calls[0]?.[0].onProgress;
    onProgress?.({ stage: "checking-installed" });

    expect(toast).toMatchObject({
      style: "animated",
      title: "正在检查当前版本 Floating Companion",
      message: "正在查找当前扩展版本对应的本地安装。",
    });

    onProgress?.({
      stage: "downloading",
      downloadedBytes: 1024 * 1024,
      totalBytes: 2 * 1024 * 1024,
    });

    expect(toast).toMatchObject({
      style: "animated",
      title: "正在下载 Floating Companion",
      message: "1.0 MB / 2.0 MB",
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

      expect(toast).toMatchObject({ style: "failure", title, message });
    },
  );
});
