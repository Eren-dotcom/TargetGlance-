import { describe, expect, it } from 'vitest';
import {
  MenuContainerProperty,
  MenuItemProperty,
  TextContainerProperty,
  validateEvenHubPageContainer,
} from '@evenrealities/even_hub_sdk';
import { CHART_CONTAINER, MENU, TEXT_CONTAINER, chartPage, startupPage } from '../src/g2/sdk.ts';
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

  it('the shipped startup payload validates too, not just a copy of it', () => {
    expect(validateEvenHubPageContainer(startupPage())).toEqual({ valid: true });
    expect(validateEvenHubPageContainer(chartPage())).toEqual({ valid: true });
  });

  it('the container fills the 576x288 surface at the only z-order it uses', () => {
    const json = page().asJson();
    const t = json.textObject[0]!;
    expect([t.xPosition, t.yPosition, t.width, t.height]).toEqual([0, 0, W, H]);
    expect(t.isEventCapture).toBe(1);
  });

  it('the chart container is the 288x144 quarter the firmware allows', () => {
    const page = chartPage();
    const img = page.imageObject![0]!;
    expect([img.xPosition, img.yPosition, img.width, img.height]).toEqual([
      CHART_CONTAINER.x,
      CHART_CONTAINER.y,
      CHART_CONTAINER.width,
      CHART_CONTAINER.height,
    ]);
    // The firmware range is 20..288 wide and 20..144 high; a bigger one is rejected.
    expect(img.width!).toBeLessThanOrEqual(288);
    expect(img.height!).toBeLessThanOrEqual(144);
    expect(page.containerTotalNum).toBe(2);
    // It must not steal the gesture stream from the text container.
    expect(page.textObject![0]!.isEventCapture).toBe(1);
    // A rebuild without the menu would clear the contextual menu, so it is carried over.
    expect(page.menuObject!.menuItems).toHaveLength(MENU.length);
  });
});
