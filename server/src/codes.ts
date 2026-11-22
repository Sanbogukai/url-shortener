// Short codes: the random generator and the rules for custom aliases.

// randomInt draws from the operating system's secure random source, so codes cannot be
// predicted the way Math.random() values can.
import { randomInt } from 'node:crypto';

// The 62 characters a random code is built from: digits, lower case, upper case (base62).
export const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
// 62^7 is about 3.5 trillion possible codes, so two links rarely draw the same one.
export const CODE_LENGTH = 7;

// Shortest and longest custom alias.
export const ALIAS_MIN = 3;
export const ALIAS_MAX = 30;

// An alias is letters, digits and hyphens only, 3 to 30 of them. No dot is allowed, so an
// alias can never look like a file such as favicon.ico.
// Example: "gym-plan" and "Q4-report" match; "ab", "has space" and "a.b" do not.
// Try it: https://regex101.com/?regex=%5E%5BA-Za-z0-9-%5D%7B3%2C30%7D%24&flags=gm&flavor=javascript&testString=gym-plan%0AQ4-report%0Aab%0Ahas%20space%0Aa.b
export const ALIAS_PATTERN = /^[A-Za-z0-9-]{3,30}$/;

// Paths the app itself uses, so no alias may take them. Compared in lower case, so "API"
// is refused too.
export const RESERVED = new Set(['api', 'assets', 'stats', 'favicon', 'robots']);

// A function that returns a new code. createApp() takes one, so a test can pass a fake that
// returns chosen codes and force a collision on purpose.
export type CodeGenerator = () => string;

// Draws CODE_LENGTH random characters from ALPHABET.
export const randomCode: CodeGenerator = () =>
  // Array.from with a length makes that many slots; each one gets a random character.
  Array.from({ length: CODE_LENGTH }, () => ALPHABET.charAt(randomInt(ALPHABET.length))).join('');

// True when `code` is one of the reserved paths, in any letter case.
export function isReserved(code: string): boolean {
  // Lower-casing first makes "Stats" and "STATS" count as "stats".
  return RESERVED.has(code.toLowerCase());
}

// A code in the address bar can be a random code or an alias, so the alias pattern covers
// both. Anything else cannot be a link, and the redirect route answers 404 without a query.
export function looksLikeCode(value: string): boolean {
  // test() reports whether the pattern matches.
  return ALIAS_PATTERN.test(value);
}
