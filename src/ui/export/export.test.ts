// @vitest-environment jsdom
import type { SeqRecord } from '../../engine/types';
import { readSequenceText } from '../../formats';
import { copyText } from './clipboard';
import { downloadBlob, safeFileName } from './download';
import { downloadSequence } from './sequence';
import { serializeSvg, svgToBlob } from './svg';
import { type ExportColumn, serializeTable, toCsv, toJson, toTsv } from './tabular';

interface Row {
  name: string;
  length: number | null;
  note?: string;
}

const columns: ExportColumn<Row>[] = [
  { id: 'name', header: 'Name', value: (r) => r.name },
  { id: 'length', header: 'Length (bp)', value: (r) => r.length },
  { id: 'note', header: 'Note', value: (r) => r.note },
];

describe('tabular serialisers', () => {
  const rows: Row[] = [
    { name: 'EcoRI', length: 6, note: 'GAATTC' },
    { name: 'has, comma', length: null, note: 'say "hi"\nline two' },
  ];

  it('writes CSV with RFC 4180 quoting and CRLF line ends', () => {
    expect(toCsv(columns, rows)).toBe(
      'Name,Length (bp),Note\r\nEcoRI,6,GAATTC\r\n"has, comma",,"say ""hi""\nline two"\r\n',
    );
  });

  it('writes TSV and flattens tabs and line breaks inside a cell', () => {
    expect(toTsv(columns, [{ name: 'a\tb', length: 1.5, note: 'x\ny' }])).toBe(
      'Name\tLength (bp)\tNote\na b\t1.5\tx y\n',
    );
  });

  it('writes JSON objects keyed by column id with raw values and null for a missing one', () => {
    expect(JSON.parse(toJson(columns, rows))).toEqual([
      { name: 'EcoRI', length: 6, note: 'GAATTC' },
      { name: 'has, comma', length: null, note: 'say "hi"\nline two' },
    ]);
  });

  it('writes only the header for no rows', () => {
    expect(toCsv(columns, [])).toBe('Name,Length (bp),Note\r\n');
    expect(JSON.parse(toJson(columns, []))).toEqual([]);
  });

  it('keeps full numeric precision', () => {
    expect(toTsv(columns, [{ name: 'x', length: 0.1 + 0.2 }])).toContain('0.30000000000000004');
  });

  it('defuses text a spreadsheet would run as a formula, and leaves numbers and signed numbers alone', () => {
    const lines = toTsv(columns, [
      { name: '=SUM(A1)', length: -5, note: '-12.5' },
      { name: '+cmd', length: 1, note: '@x' },
      { name: '-35 box', length: 1, note: 'plain' },
    ]).split('\n');
    expect(lines[1]).toBe("'=SUM(A1)\t-5\t-12.5");
    expect(lines[2]).toBe("'+cmd\t1\t'@x");
    expect(lines[3]).toBe("'-35 box\t1\tplain");
  });

  it('picks a serialiser by format name', () => {
    expect(serializeTable('tsv', columns, [])).toBe(toTsv(columns, []));
    expect(serializeTable('csv', columns, [])).toBe(toCsv(columns, []));
  });
});

describe('copyText', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, 'execCommand');
  });

  it('reports success from the async clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText('ACGT')).toEqual({ ok: true });
    expect(writeText).toHaveBeenCalledWith('ACGT');
  });

  it('falls back to a selection copy when the async clipboard refuses', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    document.execCommand = vi.fn().mockReturnValue(true);
    expect(await copyText('ACGT')).toEqual({ ok: true });
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('reports a failure when nothing can copy', async () => {
    vi.stubGlobal('navigator', {});
    document.execCommand = vi.fn().mockReturnValue(false);
    expect(await copyText('ACGT')).toMatchObject({ ok: false });
  });
});

describe('downloadBlob', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'showSaveFilePicker');
    vi.restoreAllMocks();
  });

  it('writes through the File System Access dialog when the browser has it', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const picker = vi.fn().mockResolvedValue({ createWritable: async () => ({ write, close }) });
    Object.assign(window, { showSaveFilePicker: picker });
    const blob = new Blob(['x'], { type: 'text/csv' });
    expect(await downloadBlob(blob, 'table.csv')).toEqual({ ok: true });
    expect(picker.mock.calls[0]?.[0]).toMatchObject({ suggestedName: 'table.csv' });
    expect(write).toHaveBeenCalledWith(blob);
    expect(close).toHaveBeenCalled();
  });

  it('reports a closed dialog as cancelled and does not download', async () => {
    Object.assign(window, {
      showSaveFilePicker: vi.fn().mockRejectedValue(new DOMException('closed', 'AbortError')),
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    expect(await downloadBlob(new Blob(['x']), 'a.txt')).toEqual({ ok: false, reason: 'cancelled' });
    expect(click).not.toHaveBeenCalled();
  });

  it('uses an anchor download without the File System Access API, with a safe name', async () => {
    URL.createObjectURL = vi.fn().mockReturnValue('blob:x');
    URL.revokeObjectURL = vi.fn();
    let name = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      name = this.download;
    });
    expect(await downloadBlob(new Blob(['x']), 'a/b:c.txt')).toEqual({ ok: true });
    expect(name).toBe('a_b_c.txt');
  });

  it('cleans file names', () => {
    expect(safeFileName('pUC19 <v2>?.gb')).toBe('pUC19 _v2__.gb');
    expect(safeFileName('  ')).toBe('gene-os');
    expect(safeFileName('..')).toBe('gene-os');
    expect(safeFileName('x'.repeat(300))).toHaveLength(120);
  });
});

describe('SVG export', () => {
  const build = () => {
    document.body.innerHTML = `
      <style>.axis { stroke: rgb(1, 2, 3); } .big { font-size: 20px; }</style>
      <svg viewBox="0 0 100 50" class="chart" aria-hidden="true">
        <line class="axis" x1="0" y1="0" x2="10" y2="10"></line>
        <text class="big" style="fill: #ff0000">label</text>
        <g data-export="skip"><circle r="3"></circle></g>
      </svg>`;
    return document.querySelector('svg') as SVGSVGElement;
  };

  it('writes a standalone file with literal styles and no interactive layer', () => {
    const { text, width, height } = serializeSvg(build(), { background: '#08121a' });
    expect(width).toBe(100);
    expect(height).toBe(50);
    expect(text).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(text).toContain('stroke:rgb(1, 2, 3)');
    expect(text).toContain('font-size:20px');
    expect(text).toContain('fill:rgb(255, 0, 0)');
    expect(text).not.toContain('<circle');
    expect(text).not.toContain('class=');
    expect(text).toContain('fill="#08121a"');
  });

  it('leaves the page element untouched', () => {
    const svg = build();
    serializeSvg(svg);
    expect(svg.querySelector('circle')).not.toBeNull();
    expect(svg.querySelector('line')?.getAttribute('class')).toBe('axis');
  });

  it('makes an image/svg+xml blob', () => {
    expect(svgToBlob(build(), { background: '' }).type).toContain('image/svg+xml');
  });
});

describe('downloadSequence', () => {
  it('writes the record with the sequence writer and names the file after it', async () => {
    const parsed = readSequenceText('>pTest\nACGTACGTACGT\n');
    const record = (parsed.ok ? parsed.records[0] : undefined) as SeqRecord;
    let name = '';
    let blob: Blob | undefined;
    URL.createObjectURL = vi.fn((b: Blob) => {
      blob = b;
      return 'blob:x';
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      name = this.download;
    });
    expect(await downloadSequence(record, 'fasta')).toEqual({ ok: true });
    expect(name).toBe('pTest.fasta');
    expect(await blob?.text()).toContain('ACGTACGTACGT');
    expect(await downloadSequence(record, 'genbank')).toEqual({ ok: true });
    expect(name).toBe('pTest.gb');
    vi.restoreAllMocks();
  });
});
