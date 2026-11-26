import { canWrite, readSequenceFile, writeSequenceFile, writeSequenceRecords } from './index';
import { fixture, fs, goldens } from './test-support';
import type { WriteOutput } from './types';

/**
 * Writes every fixture back out with the GENE_OS writers so Biopython can read the results. It runs only when
 * FORMATS_EXPORT_DIR is set; CI has no Python. From the repository root:
 *
 *   FORMATS_EXPORT_DIR=/tmp/gene-os-writes pnpm vitest run src/formats/writer-export.test.ts
 *   .venv/bin/python -I scripts/oracle/format_goldens.py --check-writes /tmp/gene-os-writes
 *
 * Each output is named `<fixture file>.<extension>`, so the check compares it with that fixture's golden.
 */

const exportDir = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
  .FORMATS_EXPORT_DIR;

describe.skipIf(!exportDir)('export writer outputs for the Bio.SeqIO read-back check', () => {
  test('write every readable fixture as GenBank, EMBL, FASTA and SnapGene', () => {
    const dir = new URL(`file://${exportDir}/`);
    fs.mkdirSync(dir, { recursive: true });
    const save = (file: string, output: WriteOutput) =>
      fs.writeFileSync(
        new URL(`${file}.${output.extension}`, dir),
        output.kind === 'text' ? output.text : output.bytes,
      );
    for (const golden of goldens) {
      const result = readSequenceFile(fixture(golden.file), golden.file);
      if (!result.ok) continue;
      for (const format of ['genbank', 'embl', 'fasta'] as const) {
        save(golden.file, writeSequenceRecords(result.records, format));
      }
      const [only] = result.records;
      if (result.records.length === 1 && only && canWrite(only, 'snapgene')) {
        save(golden.file, writeSequenceFile(only, 'snapgene'));
      }
    }
  });
});
