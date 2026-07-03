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
    y: clamp(bounds.y, workArea.y, workArea.y + workArea.height - bounds.height),
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
