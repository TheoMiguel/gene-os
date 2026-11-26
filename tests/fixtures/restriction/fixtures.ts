import puc19Fasta from './pUC19_L09137.fasta?raw';

/** pUC19, GenBank L09137 (2686 bp), upper-case. */
export const PUC19 = puc19Fasta
  .split('\n')
  .filter((line) => !line.startsWith('>'))
  .join('')
  .trim()
  .toUpperCase();

/** Seeded random DNA (mulberry32 generator). */
export function randomDna(length: number, seed: number): string {
  let state = seed >>> 0;
  const chars = new Array<string>(length);
  for (let i = 0; i < length; i++) {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    chars[i] = 'ACGT'[((t ^ (t >>> 14)) >>> 0) >>> 30] ?? 'A';
  }
  return chars.join('');
}
