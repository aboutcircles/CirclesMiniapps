import { describe, it, expect } from 'vitest';
import { identiconCells, identiconDataUri } from './identicon';
import type { Address } from './types';

const A = '0x0004df58332be821ebd0a2f498c211873e3b8f2c' as Address;
const B = '0x19bd93aa109fb179454596cf6e1e3871d6d9bfb3' as Address;

describe('identiconCells', () => {
  it('is deterministic', () => {
    expect(identiconCells(A)).toEqual(identiconCells(A));
  });
  it('is vertically mirrored (col c === col 4-c)', () => {
    const { cells } = identiconCells(A);
    for (let row = 0; row < 5; row++) {
      expect(cells[row * 5 + 0]).toBe(cells[row * 5 + 4]);
      expect(cells[row * 5 + 1]).toBe(cells[row * 5 + 3]);
    }
  });
  it('differs across addresses', () => {
    expect(identiconCells(A)).not.toEqual(identiconCells(B));
  });
  it('is case-insensitive on the address', () => {
    expect(identiconCells(A.toUpperCase() as Address)).toEqual(identiconCells(A));
  });
});

describe('identiconDataUri', () => {
  it('returns a valid svg data uri, deterministically', () => {
    const uri = identiconDataUri(A);
    expect(uri.startsWith('data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(uri)).toContain('<svg');
    expect(identiconDataUri(A)).toBe(uri);
  });
});
