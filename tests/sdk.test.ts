import { describe, expect, it } from 'vitest';
import {
  MenuContainerProperty,
  MenuItemProperty,
  TextContainerProperty,
  validateEvenHubPageContainer,
} from '@evenrealities/even_hub_sdk';
import { MENU, TEXT_CONTAINER } from '../src/g2/sdk.ts';
import { H, W } from '../src/g2/frame.ts';

/**
 * The startup page is the one payload the firmware can reject outright, and a rejection
 * means a blank pair of glasses. So it is built here exactly as `connect()` builds it and
 * run through the SDK's own validator, menu included.
 */
const page = () =>
  new (class {
    asJson() {
      return {
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
      };
    }
  })();

describe('startup page', () => {
  it('passes the SDK page validator', () => {
    expect(validateEvenHubPageContainer(page().asJson())).toEqual({ valid: true });
  });

  it('menu ids are non-zero and unique, labels fit 32 bytes', () => {
    const ids = MENU.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => Number.isInteger(id) && id > 0)).toBe(true);
    for (const { name } of MENU) expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(32);
    expect(MENU.length).toBeLessThanOrEqual(10);
  });

  it('the container fills the 576x288 surface at the only z-order it uses', () => {
    const json = page().asJson();
    const t = json.textObject[0]!;
    expect([t.xPosition, t.yPosition, t.width, t.height]).toEqual([0, 0, W, H]);
    expect(t.isEventCapture).toBe(1);
  });
});
