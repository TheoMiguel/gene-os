import {
  extinctionCoefficient,
  instabilityIndex,
  isoelectricPoint,
  netCharge,
} from '../../../engine/protein';
import { proteinProperties } from './proteinProperties';

describe('protein properties', () => {
  const chain =
    'MKWVTFISLLFLFSSAYSRGVFRRDAHKSEVAHRFKDLGEENFKALVLIAFAQYLQQCPFEDHVKLVNEVTEFAKTCVADESAENCDKSLHTLFGDKLCTVATLRETYGEMADCCAKQEPERNECFLQHKDDNPNLPRLVRPEVDVMCTAFHDNEETFLKKYLYEIARRHPYFYAPELLFFAKRYKAAFTECCQAADKAACLLPKLDELRDEGKASSAKQRLKCASLQKFGERAFKAWAVARLSQRFPKAEFAEVSKLVTDLTKVHTECCHGDLLECADDRADLAKYICENQDSISSKLKECCEKPLLEKSHCIAEVENDEMPADLPSLAADFVESKDVCKNYAEAKDVFLGMFLYEYARRHPDYSVVLLLRLAKTYETTLEKCCAAADPHECYAKVFDEFKPLVEEPQNLIKQNCELFEQLGEYKFQNALLVRYTKKVPQVSTPTLVEVSRNLGKVGSKCCKHPEAKRMPCAEDYLSVVLNQLCVLHEKTPVSDRVTKCCTESLVNRRPCFSALEVDETYVPKEFNAETFTFHADICTLSEKERQIKKQTALVELVKHKPKATKEQLKAVMDDFAAFVEKCCKADDKETCFAEEGKKLVAASQAALGL';

  it('compose the protein engine: residues, weight, pI, charge at 7.4, extinction, instability', () => {
    const p = proteinProperties(`${chain}*`);
    expect(p.residues).toBe(chain.length);
    expect(p.pI).toBe(isoelectricPoint(chain));
    expect(p.charge).toBe(netCharge(chain, 7.4));
    expect(p.extinction).toEqual(extinctionCoefficient(chain));
    expect(p.instability).toBe(instabilityIndex(chain));
    expect(p.composition.M).toBeGreaterThan(0);
    expect(p.weight / 1000).toBeGreaterThan(60);
    expect(p.weight / 1000).toBeLessThan(70);
  });
});
