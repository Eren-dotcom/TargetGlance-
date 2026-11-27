import { describe, expect, it } from 'vitest';
import { fmt, px, zoneText, money, signedMoney, pctText, freshDot, ago, moveMark } from '../src/core/format.ts';

describe('formatting', () => {
  it('reads prices at the precision a trader uses', () => {
    expect(px(97400)).toBe('97k');
    expect(px(1284)).toBe('1,284');
    expect(px(142.5)).toBe('142.50');
    expect(px(2.31)).toBe('2.31');
    expect(px(0.382)).toBe('0.3820');
    expect(px(Number.NaN)).toBe('—');
  });

  it('drops cents on targets but keeps them on tables', () => {
    expect(zoneText(118, 122)).toBe('118-122');
    expect(zoneText(145, 145)).toBe('145');
    expect(zoneText(119.4, 151.2)).toBe('119.40-151.20');
    expect(fmt(18.3)).toBe('18.30');
    expect(fmt(0.382)).toBe('0.38'); // trailing zeros are noise in a table
  });

  it('formats cash and percentages with an explicit sign', () => {
    expect(money(477.6)).toBe('$477.60');
    expect(money(-2)).toBe('-$2.00');
    expect(signedMoney(318)).toBe('+$318');
    expect(signedMoney(-318)).toBe('-$318');
    expect(pctText(-2.14)).toBe('-2.1%');
    expect(pctText(0)).toBe('+0.0%');
  });

  it('never signals state with colour alone', () => {
    expect(freshDot({ stale: false, mock: false })).toBe('●');
    expect(freshDot({ stale: true, mock: false })).toBe('○');
    expect(freshDot({ stale: true, mock: true })).toBe('◌');
    expect(moveMark(1)).toBe('▲');
    expect(moveMark(-1)).toBe('▼');
    expect(moveMark(0)).toBe('=');
  });

  it('says how old a tick is in one token', () => {
    const now = Date.parse('2026-11-27T12:00:00Z');
    expect(ago('2026-11-27T11:59:59Z', now)).toBe('now');
    expect(ago('2026-11-27T11:59:48Z', now)).toBe('12s');
    expect(ago('2026-11-27T11:55:00Z', now)).toBe('5m');
  });
});
