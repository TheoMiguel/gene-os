// @vitest-environment jsdom
import { createShortcutRegistry, type ShortcutEvent } from './shortcuts';

function press(key: string, init: Partial<ShortcutEvent> = {}): ShortcutEvent & { prevented: boolean } {
  const event = {
    key,
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    target: document.body,
    prevented: false,
    preventDefault() {
      event.prevented = true;
    },
    ...init,
  };
  return event;
}

describe('shortcut registry', () => {
  it('runs the handler for its chord and cancels the browser default', () => {
    const registry = createShortcutRegistry();
    const newTab = vi.fn();
    registry.on('newTab', newTab);

    const event = press('n');
    expect(registry.handle(event)).toBe(true);
    expect(newTab).toHaveBeenCalledOnce();
    expect(event.prevented).toBe(true);
  });

  it('accepts Cmd on macOS and ignores the letter case', () => {
    const registry = createShortcutRegistry();
    const close = vi.fn();
    registry.on('closeTab', close);
    registry.handle(press('W', { ctrlKey: false, metaKey: true }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('leaves the browser alone for a chord without a handler or outside the table', () => {
    const registry = createShortcutRegistry();
    const save = press('s');
    expect(registry.handle(save)).toBe(false);
    expect(save.prevented).toBe(false);

    registry.on('newTab', vi.fn());
    const reload = press('r');
    expect(registry.handle(reload)).toBe(false);
    expect(reload.prevented).toBe(false);
  });

  it('needs Ctrl and the exact Shift and Alt state', () => {
    const registry = createShortcutRegistry();
    const open = vi.fn();
    registry.on('openFile', open);
    registry.handle(press('o', { ctrlKey: false }));
    registry.handle(press('o', { altKey: true }));
    registry.handle(press('o', { shiftKey: true }));
    expect(open).not.toHaveBeenCalled();
  });

  it('tells Ctrl+Z (undo) from Ctrl+Shift+Z (redo)', () => {
    const registry = createShortcutRegistry();
    const undo = vi.fn();
    const redo = vi.fn();
    registry.on('undo', undo);
    registry.on('redoAlt', redo);
    registry.handle(press('z'));
    registry.handle(press('Z', { shiftKey: true }));
    expect(undo).toHaveBeenCalledOnce();
    expect(redo).toHaveBeenCalledOnce();
  });

  it('keeps native copy, select-all and undo inside text fields, but app shortcuts still work there', () => {
    const registry = createShortcutRegistry();
    const copy = vi.fn();
    const newTab = vi.fn();
    registry.on('copy', copy);
    registry.on('newTab', newTab);
    const field = document.createElement('textarea');

    const copyEvent = press('c', { target: field });
    expect(registry.handle(copyEvent)).toBe(false);
    expect(copyEvent.prevented).toBe(false);
    expect(copy).not.toHaveBeenCalled();

    expect(registry.handle(press('n', { target: field }))).toBe(true);
    expect(newTab).toHaveBeenCalledOnce();
  });

  it('detaches a handler', () => {
    const registry = createShortcutRegistry();
    const find = vi.fn();
    const off = registry.on('find', find);
    off();
    expect(registry.handle(press('f'))).toBe(false);
    expect(find).not.toHaveBeenCalled();
  });
});
