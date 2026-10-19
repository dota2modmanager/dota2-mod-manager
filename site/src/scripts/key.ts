/**
 * What the chase gives (scripts/chase.ts), kept out of plain sight in the bundle and in a file of
 * its own with nothing imported, so the app's tests can read it too (test/secret-lock.test.ts).
 * It is the same for everybody: it is a prize to show off, and passing it on is part of the fun.
 */
const SEAL = [14, 8, 19, 25, 17, 119, 21, 8, 119, 18, 15, 31];
export const theKey = () => String.fromCharCode(...SEAL.map((n) => n ^ 0x5a));
