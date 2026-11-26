import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readSequenceFile } from '../../formats';
import { PRESETS, type PresetInfo } from './index';

const dir = fileURLToPath(new URL('.', import.meta.url));
const bytesOf = (preset: PresetInfo) =>
  preset.encoded
    ? new Uint8Array(Buffer.from(readFileSync(`${dir}${preset.encoded}`, 'utf8'), 'base64'))
    : new Uint8Array(readFileSync(`${dir}${preset.file}`));

describe('example sequences', () => {
  it('lists the sequences a student meets, each with a public source', () => {
    const names = PRESETS.map((preset) => preset.name);
    for (const expected of ['pUC19', 'pBR322', 'Lambda phage', 'EGFP', 'pcDNA3.1(+)', 'pGEX-4T-1'])
      expect(names).toContain(expected);
    for (const preset of PRESETS) {
      expect(preset.source).not.toBe('');
      expect(preset.url).toMatch(/^https:\/\//);
      if (preset.format === 'genbank') expect(preset.accession).toMatch(/^[A-Z]{1,2}_?\d+\.\d+$/);
    }
  });

  it.each(PRESETS.map((preset) => [preset.name, preset] as const))(
    '%s reads through the format readers and matches its manifest',
    (_name, preset) => {
      const read = readSequenceFile(bytesOf(preset), preset.file);
      expect(read.ok).toBe(true);
      if (!read.ok) return;
      const record = read.records[0];
      expect(record?.seq.length).toBe(preset.length);
      expect(record?.topology).toBe(preset.topology);
      if (preset.format === 'genbank') {
        expect(record?.features.filter((f) => f.type !== 'misc_feature' || f.name).length).toBeGreaterThan(0);
        expect(record?.metadata.accession).toBe(preset.accession?.split('.')[0]);
      } else {
        expect(record?.trace?.peakPositions.length).toBe(preset.length);
      }
    },
  );
});
