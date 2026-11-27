import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountMirror } from '../src/g2/mirror.ts';
import type { AppFrame } from '../src/g2/frame.ts';

/** A 20-line DOM stand-in, because adding a whole DOM package for one file is not lazy. */
type El = { tag: string; children: El[]; className: string; textContent: string; replaceChildren(...c: El[]): void };
const el = (tag: string): El => ({
  tag, children: [], className: '', textContent: '',
  replaceChildren(...c: El[]) { this.children = c; },
});

const makeFrame = (): AppFrame => ({
  lines: [
    { text: 'TARGETGLANCE', level: 4 },
    { text: '', level: 0 },
    { text: 'NVDA  138.20', level: 3, rule: true },
  ],
  text: 'TARGETGLANCE\n\nNVDA  138.20',
});

describe('browser mirror', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders one div per frame line, with the level class', () => {
    const host = el('div');
    const onGesture = vi.fn();
    vi.stubGlobal('document', { createElement: (t: string) => el(t) });
    vi.stubGlobal('window', { addEventListener: vi.fn() });

    const stop = mountMirror(makeFrame, host as any, onGesture);

    const frameEl = host.children[0]!;
    expect(frameEl.className).toBe('glass-frame');
    expect(frameEl.children.map((c) => c.textContent)).toEqual(['TARGETGLANCE', ' ', 'NVDA  138.20']);
    expect(frameEl.children[2]!.className).toBe('glass-line lvl-3 rule');
    expect(frameEl.children[1]!.className).toBe('glass-line lvl-0');
    stop();
  });

  it('maps keyboard to the glasses gestures', () => {
    const host = el('div');
    const onGesture = vi.fn();
    const listeners: Array<[string, (e: any) => void]> = [];
    vi.stubGlobal('document', { createElement: (t: string) => el(t) });
    vi.stubGlobal('window', { addEventListener: (n: string, f: any) => listeners.push([n, f]) });

    const stop = mountMirror(makeFrame, host as any, onGesture);
    const [name, handler] = listeners.find(([n]) => n === 'keydown')!;
    expect(name).toBe('keydown');

    const prevent = vi.fn();
    for (const [key, gesture] of [['Enter', 'click'], ['ArrowDown', 'down'], ['l', 'long']] as const) {
      handler({ key, preventDefault: prevent });
      expect(onGesture).toHaveBeenLastCalledWith(gesture);
    }
    handler({ key: 'x', preventDefault: prevent });
    expect(onGesture).toHaveBeenCalledTimes(3);
    stop();
  });
});
