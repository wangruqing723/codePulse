export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DockEdge = "left" | "right" | "top" | "bottom";

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

function clampToWorkArea(bounds: Rect, workArea: Rect): Rect {
  return {
    width: bounds.width,
    height: bounds.height,
    x: clamp(bounds.x, workArea.x, workArea.x + workArea.width - bounds.width),
    y: clamp(
      bounds.y,
      workArea.y,
      workArea.y + workArea.height - bounds.height,
    ),
  };
}

export function dockWindow(
  bounds: Rect,
  displayWorkArea: Rect,
  edge: DockEdge,
): Rect {
  const clamped = clampToWorkArea(bounds, displayWorkArea);

  switch (edge) {
    case "left":
      return { ...clamped, x: displayWorkArea.x };
    case "right":
      return {
        ...clamped,
        x: displayWorkArea.x + displayWorkArea.width - bounds.width,
      };
    case "top":
      return { ...clamped, y: displayWorkArea.y };
    case "bottom":
      return {
        ...clamped,
        y: displayWorkArea.y + displayWorkArea.height - bounds.height,
      };
  }
}

export interface HeightBounds {
  min: number;
  max: number;
}

// 把测量到的内容高度夹取到窗口允许区间；内容超出上限时由列表内部滚动承接。
export function clampCompanionHeight(
  contentHeight: number,
  { min, max }: HeightBounds,
): number {
  if (!Number.isFinite(contentHeight)) {
    return min;
  }

  return Math.round(clamp(contentHeight, min, max));
}

// 按新高度重算窗口边界：吸附在某条边时沿该边重新对齐（底部吸附会随高度改变
// y 值），未吸附时仅在工作区内夹取，宽度与吸附锚点保持不变。
export function resizeToHeight(
  fullBounds: Rect,
  workArea: Rect,
  edge: DockEdge | undefined,
  height: number,
): Rect {
  const resized = { ...fullBounds, height };
  return edge
    ? dockWindow(resized, workArea, edge)
    : clampToWorkArea(resized, workArea);
}

export function hiddenBounds(
  bounds: Rect,
  displayWorkArea: Rect,
  edge: DockEdge,
  visibleSize: number,
): Rect {
  const docked = dockWindow(bounds, displayWorkArea, edge);

  switch (edge) {
    case "left":
      return {
        ...docked,
        x: displayWorkArea.x - docked.width + visibleSize,
      };
    case "right":
      return {
        ...docked,
        x: displayWorkArea.x + displayWorkArea.width - visibleSize,
      };
    case "top":
      return {
        ...docked,
        y: displayWorkArea.y - docked.height + visibleSize,
      };
    case "bottom":
      return {
        ...docked,
        y: displayWorkArea.y + displayWorkArea.height - visibleSize,
      };
  }
}

export function badgeBounds(
  fullBounds: Rect,
  workArea: Rect,
  edge: DockEdge,
  badgeSize: { width: number; height: number },
): Rect {
  return dockWindow(
    {
      x: fullBounds.x,
      y: fullBounds.y,
      width: badgeSize.width,
      height: badgeSize.height,
    },
    workArea,
    edge,
  );
}

// 判断某个屏幕坐标点是否落在矩形内（右/下边界取开区间，避免贴边像素误判）。
// 用于收起前用真实指针位置否决展开瞬间布局突变抖出的假 mouseleave。
export function pointWithinRect(
  point: { x: number; y: number },
  rect: Rect,
): boolean {
  return (
    point.x >= rect.x &&
    point.x < rect.x + rect.width &&
    point.y >= rect.y &&
    point.y < rect.y + rect.height
  );
}

export function revealedBounds(
  hidden: Rect,
  previousFullBounds: Rect,
  displayWorkArea: Rect,
): Rect {
  const fallback = clampToWorkArea(hidden, displayWorkArea);
  const restored = clampToWorkArea(previousFullBounds, displayWorkArea);

  return {
    ...fallback,
    ...restored,
  };
}
