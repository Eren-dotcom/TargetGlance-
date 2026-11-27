import type { AppFrame } from './frame.ts';
import { CHART_H, CHART_W, type ChartMap } from './chart.ts';

/**
 * Renders the exact same frame the glasses get into a 576×288 DOM box, so the app is
 * usable — and previewable — in a plain browser without the Even Hub simulator.
 * Keyboard maps to the glasses gestures so the demo can be driven from a laptop.
 *
 * The optional chart paints the same 288×144 byte map the image container receives, at
 * the same position, so the preview cannot show a chart the glass would never draw.
 */
export function mountMirror(
  frame: () => AppFrame,
  host: HTMLElement,
  onGesture?: (g: 'up' | 'down' | 'click' | 'double' | 'long') => void,
  chart?: () => ChartMap | null,
) {
  const pre = document.createElement('pre');
  pre.className = 'glass-frame';
  // The canvas is optional: a host without 2d canvases (or a test stub) still gets the
  // text frame, which is why the detail screen carries its own sparkline.
  let canvas: HTMLCanvasElement | null = null;
  if (chart) {
    try {
      const c = document.createElement('canvas');
      c.width = CHART_W;
      c.height = CHART_H;
      c.className = 'glass-chart';
      c.style.cssText = `position:absolute;left:144px;top:144px;width:${CHART_W}px;height:${CHART_H}px;display:none;`;
      if (typeof c.getContext === 'function') canvas = c;
    } catch {
      canvas = null;
    }
  }
  host.replaceChildren(...[pre, canvas].filter(Boolean) as HTMLElement[]);

  const paintChart = () => {
    if (!canvas) return;
    const map = chart?.();
    if (!map) {
      canvas.style.display = 'none';
      return;
    }
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return;
    const img = ctx.createImageData(map.width, map.height);
    for (let i = 0; i < map.data.length; i++) {
      const v = map.data[i]!;
      // Ink on glass is the bright end; the preview paints the same polarity.
      img.data[i * 4] = v * 0.36;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v * 0.55;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    canvas.style.display = 'block';
  };

  const paint = () => {
    const f = frame();
    paintChart();
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
