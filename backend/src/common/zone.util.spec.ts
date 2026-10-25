import { calcZone } from './zone.util';

describe('calcZone', () => {
  it('below порога good — below', () => {
    expect(calcZone(4, 5, 8)).toBe('below');
  });

  it('ровно good — good, не great', () => {
    expect(calcZone(5, 5, 8)).toBe('good');
  });

  it('между good и great — good', () => {
    expect(calcZone(7, 5, 8)).toBe('good');
  });

  it('ровно great — great', () => {
    expect(calcZone(8, 5, 8)).toBe('great');
  });

  it('выше great — great', () => {
    expect(calcZone(20, 5, 8)).toBe('great');
  });

  it('0 при good=0 — сразу good (защита от деления/некорректного порога)', () => {
    expect(calcZone(0, 0, 8)).toBe('good');
  });
});
