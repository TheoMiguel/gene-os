import { AMINO_ACIDS } from '../../../engine/alphabet';
import { classRuns, classShares, RESIDUE_CLASS_OF } from './residueClasses';

describe('residue classes', () => {
  it('place each of the 20 amino acids in exactly one class', () => {
    expect(Object.keys(RESIDUE_CLASS_OF).sort().join('')).toBe([...AMINO_ACIDS].sort().join(''));
  });

  it('give shares among standard residues that add up to one', () => {
    const shares = classShares('AAKDE*XS');
    expect(shares).toEqual({ hydrophobic: 2 / 6, polar: 1 / 6, basic: 1 / 6, acidic: 2 / 6 });
    expect(classShares('')).toEqual({ hydrophobic: 0, polar: 0, basic: 0, acidic: 0 });
  });

  it('split a chain into runs that join back to the chain', () => {
    const runs = classRuns('AGKRDEX*S');
    expect(runs.map((run) => run.cls)).toEqual(['hydrophobic', 'basic', 'acidic', null, 'polar']);
    expect(runs.map((run) => run.text).join('')).toBe('AGKRDEX*S');
  });
});
