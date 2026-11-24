import { ageOn, isAdult, toDateOnly } from '../src/lib/age';

describe('age gate', () => {
  const now = new Date(2026, 10, 24); // 24 Nov 2026

  test('turns 18 exactly on the birthday', () => {
    expect(isAdult(new Date(2008, 10, 24), now)).toBe(true);
    expect(isAdult(new Date(2008, 10, 25), now)).toBe(false);
  });
  test('counts whole years only', () => {
    expect(ageOn(new Date(1996, 0, 1), now)).toBe(30);
    expect(ageOn(new Date(1996, 11, 31), now)).toBe(29);
  });
  test('formats a local date without timezone drift', () => {
    expect(toDateOnly(new Date(2000, 0, 5))).toBe('2000-01-05');
  });
});
