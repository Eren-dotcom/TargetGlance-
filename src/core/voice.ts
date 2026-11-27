import type { Zone } from './targets.ts';

export interface ParsedIntent {
  symbol: string;
  buy?: Zone;
  sell?: Zone;
  stop?: number;
}

const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const K = String.raw`([kK])?`;
const RANGE = String.raw`\(?\s*\$?${NUM}${K}\s*(?:-|–|to|and)\s*\$?${NUM}${K}\s*\)?`;
const SINGLE = String.raw`\$?${NUM}${K}`;
const KEYWORD = String.raw`\b(?:BUY|SELL|STOP)\b\s*(?:AT|AROUND|ZONE|PRICE)?\s*`;

const toNum = (n: string, k?: string): number => {
  const v = Number(n.replace(',', '.'));
  return k ? v * 1000 : v;
};

const zone = (m: RegExpMatchArray | null, offset: number): Zone | undefined => {
  if (!m) return undefined;
  const a = toNum(m[offset]!, m[offset + 1]);
  const b = m[offset + 2] ? toNum(m[offset + 2]!, m[offset + 3]) : a;
  return { low: Math.min(a, b), high: Math.max(a, b) };
};

const after = (text: string, word: 'BUY' | 'SELL' | 'STOP'): string =>
  text.match(new RegExp(String.raw`\b${word}\b`, 'i'))?.index !== undefined
    ? text.slice(text.search(new RegExp(String.raw`\b${word}\b`, 'i')))
    : '';

/**
 * Regex-first target parser: "SOL buy 140 sell 180", "BTC buy 92k sell 105k",
 * "NVDA buy 118 to 122 sell 148-152 stop 110". No LLM, no network, no key.
 * Returns null when the phrase carries no usable target, so the caller keeps typing.
 */
export function parseTargets(phrase: string, symbols: string[]): ParsedIntent | null {
  const text = phrase.replace(/[$,]/g, (c) => (c === ',' ? '.' : ''));
  const upper = text.toUpperCase();
  const symbol = symbols
    .slice()
    .sort((a, b) => b.length - a.length)
    .find((s) => new RegExp(String.raw`\b${s.replace('.', String.raw`\.`)}\b`).test(upper));
  if (!symbol) return null;

  const grab = (word: 'BUY' | 'SELL'): Zone | undefined => {
    const tail = after(text, word);
    if (!tail) return undefined;
    const body = tail.slice(word.length);
    return zone(body.match(new RegExp(String.raw`^\s*(?:AT|AROUND|ZONE|PRICE)?\s*` + RANGE, 'i')), 1)
      ?? zone(body.match(new RegExp(String.raw`^\s*(?:AT|AROUND|ZONE|PRICE)?\s*` + SINGLE, 'i')), 1);
  };

  const stopTail = after(text, 'STOP');
  const stopMatch = stopTail ? stopTail.slice(4).match(new RegExp(String.raw`^\s*` + SINGLE, 'i')) : null;

  const buy = grab('BUY');
  const sell = grab('SELL');
  const stop = stopMatch ? toNum(stopMatch[1]!, stopMatch[2]) : undefined;

  if (!buy && !sell && stop === undefined) return null;
  return { symbol, ...(buy ? { buy } : {}), ...(sell ? { sell } : {}), ...(stop !== undefined ? { stop } : {}) };
}

const fmt = (v: number) => (v >= 10000 ? `${Math.round(v / 1000)}k` : v >= 100 ? String(Math.round(v)) : String(v));

/** "NVDA · buy 118-122 · sell 148-152" — what the confirmation shows. */
export function describeIntent(i: ParsedIntent): string {
  const parts = [i.symbol];
  if (i.buy) parts.push(`buy ${fmt(i.buy.low)}-${fmt(i.buy.high)}`);
  if (i.sell) parts.push(`sell ${fmt(i.sell.low)}-${fmt(i.sell.high)}`);
  if (i.stop !== undefined) parts.push(`stop ${fmt(i.stop)}`);
  return parts.join(' · ');
}

export { KEYWORD };
