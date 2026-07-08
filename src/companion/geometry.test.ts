import { describe, expect, it } from "vitest";

type GeometryModule = typeof import("./geometry");

async function loadGeometryModule(): Promise<Partial<GeometryModule>> {
  try {
    return await import("./geometry");
  } catch {
    return {};
  }
}

describe("floating companion geometry", () => {
  const workArea = { x: 100, y: 50, width: 1200, height: 800 };
  const bounds = { x: 1180, y: 220, width: 320, height: 180 };

  it("docks a window near the right edge to the right edge", async () => {
    const { dockWindow } = await loadGeometryModule();

    expect(dockWindow?.(bounds, workArea, "right")).toEqual({
      x: 980,
      y: 220,
      width: 320,
      height: 180,
    });
  });

  it("leaves visibleSize pixels visible when hiding on the right edge", async () => {
    const { hiddenBounds } = await loadGeometryModule();

    expect(hiddenBounds?.(bounds, workArea, "right", 24)).toEqual({
      x: 1276,
      y: 220,
      width: 320,
      height: 180,
    });
  });

  it("restores the previous full bounds within the work area on reveal", async () => {
    const { revealedBounds } = await loadGeometryModule();
    const hidden = { x: 1276, y: 220, width: 320, height: 180 };
    const previousFullBounds = { x: 1160, y: 220, width: 320, height: 180 };

    expect(revealedBounds?.(hidden, previousFullBounds, workArea)).toEqual({
      x: 980,
      y: 220,
      width: 320,
      height: 180,
    });
  });

  it("clamps measured content height into the allowed window range", async () => {
    const { clampCompanionHeight } = await loadGeometryModule();

    expect(clampCompanionHeight?.(300, { min: 120, max: 520 })).toBe(300);
    expect(clampCompanionHeight?.(60, { min: 120, max: 520 })).toBe(120);
    expect(clampCompanionHeight?.(900, { min: 120, max: 520 })).toBe(520);
    expect(clampCompanionHeight?.(Number.NaN, { min: 120, max: 520 })).toBe(
      120,
    );
  });

  it("re-docks along the docked edge when resizing height", async () => {
    const { resizeToHeight } = await loadGeometryModule();
    const full = { x: 980, y: 220, width: 320, height: 360 };

    // 底部吸附：高度变小后应贴住底边（y 随高度上移）。
    expect(resizeToHeight?.(full, workArea, "bottom", 200)).toEqual({
      x: 980,
      y: 650,
      width: 320,
      height: 200,
    });
    // 右侧吸附：仅高度变化，x 仍贴右边。
    expect(resizeToHeight?.(full, workArea, "right", 200)).toEqual({
      x: 980,
      y: 220,
      width: 320,
      height: 200,
    });
  });

  it("keeps a free-floating window within the work area when resizing", async () => {
    const { resizeToHeight } = await loadGeometryModule();
    const full = { x: 200, y: 790, width: 320, height: 200 };

    expect(resizeToHeight?.(full, workArea, undefined, 120)).toEqual({
      x: 200,
      y: 730,
      width: 320,
      height: 120,
    });
  });

  it("keeps left, top, and bottom edge windows reachable", async () => {
    const { hiddenBounds } = await loadGeometryModule();
    const left = hiddenBounds?.(
      { x: 40, y: 20, width: 300, height: 160 },
      workArea,
      "left",
      20,
    );
    const top = hiddenBounds?.(
      { x: 40, y: 20, width: 300, height: 160 },
      workArea,
      "top",
      20,
    );
    const bottom = hiddenBounds?.(
      { x: 40, y: 720, width: 300, height: 160 },
      workArea,
      "bottom",
      20,
    );

    expect(left).toEqual({
      x: -180,
      y: 50,
      width: 300,
      height: 160,
    });
    expect(top).toEqual({
      x: 100,
      y: -90,
      width: 300,
      height: 160,
    });
    expect(bottom).toEqual({
      x: 100,
      y: 830,
      width: 300,
      height: 160,
    });
  });
});
