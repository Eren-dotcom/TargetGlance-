import type { AppFrame } from './frame.ts';

/**
 * Renders the exact same frame the glasses get into a 576×288 DOM box, so the app is
 * usable — and previewable — in a plain browser without the Even Hub simulator.
 * Keyboard maps to the glasses gestures so the demo can be driven from a laptop.
 */
export function mountMirror(frame: () => AppFrame, host: HTMLElement, onGesture?: (g: 'up' | 'down' | 'click' | 'double' | 'long') => void) {
  const pre = document.createElement('pre');
  pre.className = 'glass-frame';
  host.replaceChildren(pre);

  const paint = () => {
    const f = frame();
    pre.replaceChildren(
      ...f.lines.map((l) => {
        const line = document.createElement('div');
        line.className = `glass-line lvl-${l.level ?? 4}${l.rule ? ' rule' : ''}`;
        line.textContent = l.text || ' ';
        return line;
      }),
    );
  };
  paint();
  const timer = setInterval(paint, 500);

  if (onGesture) {
    window.addEventListener('keydown', (e) => {
      const map: Record<string, 'up' | 'down' | 'click' | 'double' | 'long'> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        Enter: 'click',
        Escape: 'double',
        l: 'long',
      };
      const g = map[e.key];
      if (g) {
        e.preventDefault();
        onGesture(g);
        paint();
      }
    });
  }
  return () => clearInterval(timer);
}
