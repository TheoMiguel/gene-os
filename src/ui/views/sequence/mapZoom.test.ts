import {
  centerWindow,
  fitCamera,
  MAX_ZOOM,
  MIN_WINDOW,
  panCamera,
  panWindow,
  viewBoxOf,
  zoomCamera,
  zoomWindow,
} from './mapZoom';

describe('camera', () => {
  it('shows the whole scene when fitted', () => {
    expect(viewBoxOf(fitCamera(400, 300), 400, 300)).toBe('0.00 0.00 400.00 300.00');
  });

  it('keeps the scene point under the pointer still while zooming', () => {
    const camera = zoomCamera(fitCamera(400, 300), 400, 300, 0.25, 0.5, 2);
    const [x = 0, y = 0, w = 1, h = 1] = viewBoxOf(camera, 400, 300).split(' ').map(Number);
    expect(w).toBeCloseTo(200, 6);
    expect(h).toBeCloseTo(150, 6);
    expect(x + 0.25 * w).toBeCloseTo(100, 6);
    expect(y + 0.5 * h).toBeCloseTo(150, 6);
  });

  it('stops at the largest zoom and never leaves the scene when zooming out or dragging', () => {
    let camera = fitCamera(400, 300);
    for (let i = 0; i < 40; i++) camera = zoomCamera(camera, 400, 300, 0.9, 0.9, 2);
    expect(camera.k).toBe(MAX_ZOOM);
    camera = panCamera(camera, 400, 300, -50, -50);
    const [x = 0, y = 0] = viewBoxOf(camera, 400, 300).split(' ').map(Number);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 80; i++) camera = zoomCamera(camera, 400, 300, 0.5, 0.5, 0.5);
    expect(viewBoxOf(camera, 400, 300)).toBe('0.00 0.00 400.00 300.00');
  });
});

describe('base window', () => {
  it('zooms around the point under the pointer', () => {
    const next = zoomWindow({ start: 0, end: 1000 }, 1000, 0.25, 2);
    expect(next.end - next.start).toBe(500);
    expect(next.start + 0.25 * 500).toBeCloseTo(250, 9);
  });

  it('never shows fewer bases than the minimum or more than the molecule', () => {
    let window = { start: 0, end: 5000 };
    for (let i = 0; i < 30; i++) window = zoomWindow(window, 5000, 0.5, 2);
    expect(window.end - window.start).toBe(MIN_WINDOW);
    for (let i = 0; i < 30; i++) window = zoomWindow(window, 5000, 0.5, 0.5);
    expect(window).toEqual({ start: 0, end: 5000 });
  });

  it('pans by a fraction of its width and stops at the ends', () => {
    expect(panWindow({ start: 100, end: 200 }, 1000, 0.5)).toEqual({ start: 150, end: 250 });
    expect(panWindow({ start: 100, end: 200 }, 1000, -5)).toEqual({ start: 0, end: 100 });
    expect(panWindow({ start: 800, end: 900 }, 1000, 5)).toEqual({ start: 900, end: 1000 });
  });

  it('centers on a position', () => {
    expect(centerWindow(500, 100, 1000)).toEqual({ start: 450, end: 550 });
    expect(centerWindow(10, 100, 1000)).toEqual({ start: 0, end: 100 });
  });
});
