import type { AssetClass } from './symbols.ts';

/** `24-7` for crypto, the four stock phases otherwise. */
export type Session = 'LIVE' | 'PRE' | 'AH' | 'CLOSED' | '24-7';
/** Judge Mode pins a stock session so a demo works at any hour. */
export type SessionOverride = 'auto' | Exclude<Session, '24-7'>;

const NY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * New York wall clock, DST handled by Intl rather than by hand.
 * shortcut: no US holiday calendar — holidays read as LIVE. Upgrade if this outlives the demo.
 */
export function stockSession(now: Date, override: SessionOverride = 'auto'): Session {
  if (override !== 'auto') return override;
  const parts = NY.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = get('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return 'CLOSED';
  // 24:xx is how some ICU builds report midnight for hour12:false.
  const minutes = (Number(get('hour')) % 24) * 60 + Number(get('minute'));
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return 'PRE';
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) return 'LIVE';
  if (minutes >= 16 * 60 && minutes < 20 * 60) return 'AH';
  return 'CLOSED';
}

export function sessionFor(cls: AssetClass, now: Date, override: SessionOverride = 'auto'): Session {
  return cls === 'crypto' ? '24-7' : stockSession(now, override);
}
