// @vitest-environment jsdom
import { render } from '@testing-library/preact';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Background } from './Background';

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

it('renders no canvas when the background is off', () => {
  const { container } = render(<Background scene="off" themeKey="teal-dark" />);
  expect(container.querySelector('canvas')).toBeNull();
});

it('renders one decorative canvas for a scene, even without a 2D context', () => {
  const { container } = render(<Background scene="helix" themeKey="teal-dark" />);
  const canvases = container.querySelectorAll('canvas');
  expect(canvases).toHaveLength(1);
  expect(canvases[0]?.classList.contains('bg-canvas')).toBe(true);
  expect(canvases[0]?.getAttribute('aria-hidden')).toBe('true');
});

it('removes the canvas when the user turns the background off', () => {
  const { container, rerender } = render(<Background scene="rain" themeKey="teal-dark" />);
  rerender(<Background scene="off" themeKey="amber-light" />);
  expect(container.querySelector('canvas')).toBeNull();
});
