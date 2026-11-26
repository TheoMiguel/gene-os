/** Zoom and pan for both maps, as pure functions on small value objects. */

export const MAX_ZOOM = 24;
/** Fewest bases the linear map zooms in to. */
export const MIN_WINDOW = 40;

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** The circular map's camera: magnification and the scene point at the middle of the view. */
export interface Camera {
  readonly k: number;
  readonly cx: number;
  readonly cy: number;
}

/** The camera that shows the whole `width` by `height` scene. */
export function fitCamera(width: number, height: number): Camera {
  return { k: 1, cx: width / 2, cy: height / 2 };
}

function bounded(camera: Camera, width: number, height: number): Camera {
  const k = clamp(camera.k, 1, MAX_ZOOM);
  const halfW = width / (2 * k);
  const halfH = height / (2 * k);
  return { k, cx: clamp(camera.cx, halfW, width - halfW), cy: clamp(camera.cy, halfH, height - halfH) };
}

/** SVG `viewBox` text for a camera. */
export function viewBoxOf(camera: Camera, width: number, height: number): string {
  const { k, cx, cy } = bounded(camera, width, height);
  return `${(cx - width / (2 * k)).toFixed(2)} ${(cy - height / (2 * k)).toFixed(2)} ${(width / k).toFixed(2)} ${(height / k).toFixed(2)}`;
}

/** Zooms by `factor` and keeps the scene point under the pointer still. `fx`, `fy` are the pointer as a 0..1 fraction of the view. */
export function zoomCamera(
  camera: Camera,
  width: number,
  height: number,
  fx: number,
  fy: number,
  factor: number,
): Camera {
  const current = bounded(camera, width, height);
  const k = clamp(current.k * factor, 1, MAX_ZOOM);
  const worldX = current.cx - width / (2 * current.k) + (fx * width) / current.k;
  const worldY = current.cy - height / (2 * current.k) + (fy * height) / current.k;
  return bounded(
    { k, cx: worldX - (fx - 0.5) * (width / k), cy: worldY - (fy - 0.5) * (height / k) },
    width,
    height,
  );
}

/** Moves the view by a drag of `dx`, `dy` as fractions of the view's own size. */
export function panCamera(camera: Camera, width: number, height: number, dx: number, dy: number): Camera {
  const current = bounded(camera, width, height);
  return bounded(
    { ...current, cx: current.cx - (dx * width) / current.k, cy: current.cy - (dy * height) / current.k },
    width,
    height,
  );
}

/** The linear map's view: the bases from `start` to `end` that fill the plot. */
export interface BaseWindow {
  readonly start: number;
  readonly end: number;
}

function fitWindow(window: BaseWindow, length: number): BaseWindow {
  const span = clamp(window.end - window.start, Math.min(MIN_WINDOW, length), length);
  const start = clamp(window.start, 0, length - span);
  return { start, end: start + span };
}

/** Zooms the window by `factor` (above 1 zooms in) around the point `fraction` of the way across it. */
export function zoomWindow(window: BaseWindow, length: number, fraction: number, factor: number): BaseWindow {
  const span = window.end - window.start;
  const next = span / factor;
  const anchor = window.start + fraction * span;
  return fitWindow({ start: anchor - fraction * next, end: anchor + (1 - fraction) * next }, length);
}

/** Moves the window by `fraction` of its width. A positive fraction shows later bases. */
export function panWindow(window: BaseWindow, length: number, fraction: number): BaseWindow {
  const shift = fraction * (window.end - window.start);
  return fitWindow({ start: window.start + shift, end: window.end + shift }, length);
}

/** A window of `span` bases centered on `position`. */
export function centerWindow(position: number, span: number, length: number): BaseWindow {
  return fitWindow({ start: position - span / 2, end: position + span / 2 }, length);
}
