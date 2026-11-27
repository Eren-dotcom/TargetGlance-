import {
  CreateStartUpPageContainer,
  OsEventTypeList,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk';
import { H, W, type AppFrame } from './frame.ts';

export type Gesture = 'click' | 'double' | 'up' | 'down' | 'long';

/**
 * One full-screen event-capture text container is the whole UI: one container means
 * one flicker-free `textContainerUpgrade` per frame, and no widget layout to fight.
 * shortcut: no image container, so no logo/graph. Add one if the bar needs sparklines.
 */
export const TEXT_CONTAINER = { id: 1, name: 'Main' };

export async function connect(onGesture: (g: Gesture) => void): Promise<EvenAppBridge | null> {
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
    }),
  );
  if (res !== StartUpPageCreateResult.success) {
    console.error('[targetglance] page create failed', res);
    return null;
  }

  bridge.onEvenHubEvent((event) => {
    const t = event.textEvent ?? event.listEvent;
    const type = t?.eventType ?? event.sysEvent?.eventType;
    const g = gestureOf(type);
    if (g) onGesture(g);
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
    case OsEventTypeList.LONG_PRESS_EVENT:
      return 'long';
    default:
      return null;
  }
}

/** Push one frame. Text-only, so the 576×288 surface is repainted without a rebuild. */
export async function render(bridge: EvenAppBridge, frame: AppFrame): Promise<void> {
  try {
    const ok = await bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: TEXT_CONTAINER.id,
        containerName: TEXT_CONTAINER.name,
        content: frame.text,
      }),
    );
    if (!ok) console.warn('[targetglance] text upgrade rejected');
  } catch (e) {
    console.warn('[targetglance] text upgrade failed', e);
  }
}
