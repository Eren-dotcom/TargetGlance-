import {
  CreateStartUpPageContainer,
  ImageContainerProperty,
  ImageRawDataUpdate,
  MenuContainerProperty,
  MenuItemProperty,
  OsEventTypeList,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk';
import { H, W, type AppFrame } from './frame.ts';
import { BOLD, NORMAL } from './look.ts';

export type Gesture = 'click' | 'double' | 'up' | 'down' | 'long';
/** Top-level contextual menu: the long-press shortcut most G2 users reach for first. */
export type MenuAction = 'chart' | 'portfolio' | 'journal' | 'reset';

/**
 * The startup payload: one full-screen text container plus the contextual menu. Exported
 * so the test can hand the firmware's own validator the exact object `connect()` sends.
 */
export const startupPage = () =>
  new CreateStartUpPageContainer({
    containerTotalNum: 1,
    textObject: [textContainer('TARGETGLANCE')],
    menuObject: new MenuContainerProperty({
      menuItems: MENU.map(({ id, name }) => new MenuItemProperty({ itemID: id, itemName: name })),
    }),
  });

/** Menu ids must be non-zero and unique; labels are capped at 32 UTF-8 bytes. */
export const MENU: { id: number; name: string; action: MenuAction }[] = [
  { id: 1, name: 'Chart', action: 'chart' },
  { id: 2, name: 'Portfolio', action: 'portfolio' },
  { id: 3, name: 'Journal', action: 'journal' },
  { id: 4, name: 'Reset view', action: 'reset' },
];

/**
 * One full-screen event-capture text container is the UI: one container means one
 * flicker-free `textContainerUpgrade` per frame, and no widget layout to fight.
 */
export const TEXT_CONTAINER = { id: 1, name: 'Main' };

/**
 * The chart. A chart cannot be text on this font — `█` is 20 px and `▓` is 4 px, so a
 * character grid drifts — and the firmware caps an image container at **288×144**, which
 * is exactly a quarter of the display. So the chart occupies the bottom quarter at 1× and
 * carries its own legend in the text above it.
 */
export const CHART_CONTAINER = { id: 2, name: 'Chart', x: 144, y: 144, width: 288, height: 144 };

export const textContainer = (content: string) =>
  new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: W,
    height: H,
    containerID: TEXT_CONTAINER.id,
    containerName: TEXT_CONTAINER.name,
    content,
    isEventCapture: 1,
    zOrderIndex: 1,
  });

export const chartContainer = () =>
  new ImageContainerProperty({
    xPosition: CHART_CONTAINER.x,
    yPosition: CHART_CONTAINER.y,
    width: CHART_CONTAINER.width,
    height: CHART_CONTAINER.height,
    containerID: CHART_CONTAINER.id,
    containerName: CHART_CONTAINER.name,
    zOrderIndex: 2,
  });

export interface Handlers {
  gesture: (g: Gesture) => void;
  menu: (a: MenuAction) => void;
  /** Temple long-press: the mic gesture, wired to the voice parser. */
  hold: (on: boolean) => void;
}

export async function connect(h: Handlers): Promise<EvenAppBridge | null> {
  // Without the host bridge (plain browser) the caller keeps the DOM mirror instead.
  if (!('flutter_inappwebview' in window) && !('EvenAppBridge' in window)) return null;

  const bridge = await waitForEvenAppBridge();
  const res = await bridge.createStartUpPageContainer(startupPage());
  if (res !== StartUpPageCreateResult.success) {
    console.error('[targetglance] page create failed', res);
    return null;
  }

  bridge.onEvenHubEvent((event) => {
    const action = event.menuItemClickEvent?.itemID;
    if (action !== undefined) {
      const hit = MENU.find((m) => m.id === action);
      if (hit) h.menu(hit.action);
      return;
    }
    const t = event.textEvent ?? event.listEvent;
    const type = t?.eventType ?? event.sysEvent?.eventType;
    if (type === OsEventTypeList.LONG_PRESS_EVENT) return h.hold(true);
    if (type === OsEventTypeList.LONG_PRESS_RELEASE_EVENT) return h.hold(false);
    const g = gestureOf(type);
    if (g) h.gesture(g);
  });

  return bridge;
}

function gestureOf(type?: OsEventTypeList): Gesture | null {
  switch (type) {
    case OsEventTypeList.CLICK_EVENT:
      return 'click';
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      return 'double';
    case OsEventTypeList.SCROLL_TOP_EVENT:
      return 'up';
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      return 'down';
    default:
      return null;
  }
}

/**
 * Push one frame. Text-only, so the 576×288 surface is repainted without a rebuild.
 * `textColor` is the container's brightness: the only emphasis the hardware really has,
 * raised when a row is waiting for the wearer.
 */
export async function render(bridge: EvenAppBridge, frame: AppFrame, brightness = NORMAL): Promise<void> {
  try {
    const ok = await bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: TEXT_CONTAINER.id,
        containerName: TEXT_CONTAINER.name,
        content: frame.text,
        textColor: brightness,
      }),
    );
    if (!ok) console.warn('[targetglance] text upgrade rejected');
  } catch (e) {
    console.warn('[targetglance] text upgrade failed', e);
  }
}

/**
 * Show or hide the chart. The startup page is created without the image container, so the
 * first entry into the detail view is a rebuild — once per session, then the bitmap is a
 * cheap `updateImageRawData`. A rejected rebuild is not fatal: the detail screen draws its
 * own text sparkline, so the chart is an enhancement and never a requirement.
 */
let chartMounted = false;

/**
 * The detail payload: the same text container plus the 288×144 image container the candle
 * bitmap lands in. Kept next to the startup page so both go through one validator.
 */
export const chartPage = () =>
  new RebuildPageContainer({
    containerTotalNum: 2,
    textObject: [textContainer('TARGETGLANCE')],
    imageObject: [chartContainer()],
    menuObject: new MenuContainerProperty({
      menuItems: MENU.map(({ id, name }) => new MenuItemProperty({ itemID: id, itemName: name })),
    }),
  });

export async function showChart(bridge: EvenAppBridge, map: { width: number; height: number; data: Uint8Array }): Promise<boolean> {
  try {
    if (!chartMounted) {
      const rebuilt = await bridge.rebuildPageContainer(chartPage());
      if (!rebuilt) return false;
      chartMounted = true;
    }
    const res = await bridge.updateImageRawData(
      new ImageRawDataUpdate({
        containerID: CHART_CONTAINER.id,
        containerName: CHART_CONTAINER.name,
        // Grayscale bytes, one per pixel; the SDK LZ4s them on the way to the host.
        imageData: Array.from(map.data),
      }),
    );
    if (typeof res === 'number' && res !== 0) {
      console.warn('[targetglance] image update rejected', res);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[targetglance] chart unavailable', e);
    return false;
  }
}

/** Back to the full-screen text page the startup created. */
export async function hideChart(bridge: EvenAppBridge): Promise<void> {
  if (!chartMounted) return;
  try {
    await bridge.rebuildPageContainer(startupPage());
    chartMounted = false;
  } catch (e) {
    console.warn('[targetglance] chart unmount failed', e);
  }
}

/** Test hook: the mount is per-session state. */
export const chartIsMounted = () => chartMounted;
export const resetChartMount = () => {
  chartMounted = false;
};

/**
 * Glasses mic on while the temple is held. Audio frames are delivered to the app; the
 * speech-to-text step is not in this build (see PLAN.md §3), so the hold is wired to the
 * same confirmation flow the companion's text box uses.
 */
export async function listen(bridge: EvenAppBridge, on: boolean): Promise<boolean> {
  try {
    return await bridge.audioControl(on);
  } catch {
    return false;
  }
}
