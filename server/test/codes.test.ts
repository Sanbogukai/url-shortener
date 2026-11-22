// The code generator and the alias rules, tested on their own without the app.

import { describe, expect, it } from 'vitest';
import { ALIAS_MAX, ALPHABET, CODE_LENGTH, isReserved, looksLikeCode, randomCode } from '../src/codes.ts';

// How many codes to draw when checking the generator's output.
const SAMPLE_SIZE = 1000;

describe('randomCode', () => {
  it('returns 7 characters from the base62 alphabet', () => {
    // Draws one code.
    const code = randomCode();
    // Exactly CODE_LENGTH characters long.
    expect(code).toHaveLength(CODE_LENGTH);
    // Every character is in ALPHABET; [...code] splits the string into characters.
    expect([...code].every((char) => ALPHABET.includes(char))).toBe(true);
  });

  it('does not repeat itself in a thousand draws', () => {
    // A Set keeps only distinct values, so its size counts the different codes drawn.
    const codes = new Set(Array.from({ length: SAMPLE_SIZE }, randomCode));
    // With 3.5 trillion possible codes, a repeat in 1,000 draws would point at a bug.
    expect(codes.size).toBe(SAMPLE_SIZE);
  });
});

describe('alias rules', () => {
  it.each(['gym-plan', 'Q4-report', 'abc', 'a'.repeat(ALIAS_MAX)])('accept %s', (alias) => {
    // Each of these has only allowed characters and a length from 3 to 30.
    expect(looksLikeCode(alias)).toBe(true);
  });

  it.each(['ab', 'a'.repeat(ALIAS_MAX + 1), 'has space', 'a.b', 'emoji-😀', ''])('refuse "%s"', (alias) => {
    // Too short, too long, or a character outside letters, digits and hyphens.
    expect(looksLikeCode(alias)).toBe(false);
  });

  it.each(['api', 'API', 'Stats', 'assets'])('treat %s as reserved', (alias) => {
    // Reserved words are refused in any letter case.
    expect(isReserved(alias)).toBe(true);
  });

  it('does not reserve ordinary words', () => {
    // A normal alias is not on the list.
    expect(isReserved('gym-plan')).toBe(false);
  });
});
