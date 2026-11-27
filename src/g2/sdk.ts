import {
  CreateStartUpPageContainer,
  OsEventTypeList,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  MenuContainerProperty,
  MenuItemProperty,
  waitForEvenAppBridge,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk';
import { H, W, type AppFrame } from './frame.ts';
import { BOLD, NORMAL } from './look.ts';

export type Gesture = 'click' | 'double' | 'up' | 'down' | 'long';
/** Top-level contextual menu: the long-press shortcut most G2 users reach for first. */
export type MenuAction = 'portfolio' | 'journal' | 'reset';

/** Menu ids must be non-zero and unique; labels are capped at 32 UTF-8 bytes. */
export const MENU: { id: number; name: string; action: MenuAction }[] = [
  { id: 1, name: 'Portfolio', action: 'portfolio' },
  { id: 2, name: 'Journal', action: 'journal' },
  { id: 3, name: 'Reset view', action: 'reset' },
];

/**
 * One full-screen event-capture text container is the whole UI: one container means
 * one flicker-free `textContainerUpgrade` per frame, and no widget layout to fight.
 * shortcut: no image container, so no logo/graph. Add one if the bar needs sparklines.
 */
export const TEXT_CONTAINER = { id: 1, name: 'Main' };

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
  const res = await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [
        new TextContainerProperty({
          xPosition: 0,
          yPosition: 0,
          width: W,
          height: H,
          containerID: TEXT_CONTAINER.id,
          containerName: TEXT_CONTAINER.name,
          content: 'TARGETGLANCE',
          isEventCapture: 1,
          zOrderIndex: 1,
        }),
      ],
      menuObject: new MenuContainerProperty({
        menuItems: MENU.map(({ id, name }) => new MenuItemProperty({ itemID: id, itemName: name })),
      }),
    }),
  );
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
