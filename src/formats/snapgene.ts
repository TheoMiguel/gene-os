import type { Feature, SeqRecord, Span, Strand } from '../engine/types';
import { keyOf, nameFromQualifiers, qualifiersToWrite, typeForKey } from './feature-keys';
import { detectAlphabet, FormatError, fallbackName, insdcDate, latin1, type Warnings } from './internal';
import { descendants, escapeXml, parseXml, type XmlElement } from './xml';

/**
 * SnapGene `.dna` files: a sequence of packets, each a type byte, a big-endian 32-bit length and the data.
 * The reader follows Biopython's `Bio.SeqIO.SnapGeneIO`: the cookie packet first, one DNA packet (a flag
 * byte, bit 0 = circular, then ASCII bases), features and primers as XML, notes as XML.
 */

const PACKET = { dna: 0x00, primers: 0x05, notes: 0x06, cookie: 0x09, features: 0x0a } as const;
const COOKIE = 'SnapGene';

interface Packet {
  readonly type: number;
  readonly data: Uint8Array;
}

function packets(bytes: Uint8Array): Packet[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Packet[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 5 > bytes.length)
      throw new FormatError('malformed', 'SnapGene file ends inside a packet header');
    const type = view.getUint8(offset);
    const length = view.getUint32(offset + 1);
    const start = offset + 5;
    if (start + length > bytes.length)
      throw new FormatError('malformed', 'SnapGene file ends inside a packet');
    out.push({ type, data: bytes.subarray(start, start + length) });
    offset = start + length;
  }
  return out;
}

/** True when the bytes start with a SnapGene cookie packet. */
export function isSnapGene(bytes: Uint8Array): boolean {
  if (bytes.length < 13 || bytes[0] !== PACKET.cookie) return false;
  return latin1(bytes.subarray(5, 13)) === COOKIE;
}

const utf8 = new TextDecoder('utf-8');

/** Biopython strips HTML markup from SnapGene text values (`<html><body>note</body></html>` → `note`). */
function stripTags(text: string): string {
  return text.replace(/<[^>]+>/g, '');
}

function attribute(element: XmlElement, name: string): string | undefined {
  const value = element.attributes[name];
  return value === undefined ? undefined : stripTags(value);
}

function childText(root: XmlElement, name: string): string | undefined {
  const text = descendants(root, name)[0]?.text;
  return text ? stripTags(text) : undefined;
}

/**
 * Spans for a SnapGene range `a-b` (1-based, inclusive). A range with `a > b` crosses the origin and gives
 * two spans in top-strand order. Primer ranges are shifted by one in SnapGene files (Biopython does the same).
 */
function rangeSpans(range: string, length: number, primer: boolean): Span[] | undefined {
  const match = /^(\d+)-(\d+)$/.exec(range);
  if (!match) return undefined;
  const start = Number(match[1]) - 1 + (primer ? 1 : 0);
  const end = Number(match[2]) + (primer ? 1 : 0);
  if (start >= length || end > length) return undefined;
  return start < end
    ? [{ start, end }]
    : [
        { start, end: length },
        { start: 0, end },
      ];
}

function location(topOrder: Span[], strand: Strand): Feature['location'] {
  return { segments: strand === 1 ? topOrder : topOrder.reverse(), strand };
}

function readFeatures(xml: XmlElement, length: number, warnings: Warnings, first: number): Feature[] {
  const features: Feature[] = [];
  for (const element of descendants(xml, 'Feature')) {
    const key = attribute(element, 'type') ?? 'misc_feature';
    const strand: Strand = attribute(element, 'directionality') === '2' ? -1 : 1;
    const qualifiers: Record<string, string[]> = {};
    const spans: Span[] = [];
    const named: [number, string][] = [];
    let color: string | undefined;
    let valid = true;
    let segmentCount = 0;
    for (const segment of descendants(element, 'Segment')) {
      if ((attribute(segment, 'type') ?? 'standard') === 'gap') continue;
      segmentCount++;
      const parsed = rangeSpans(attribute(segment, 'range') ?? '', length, false);
      if (parsed === undefined) valid = false;
      else spans.push(...parsed);
      color ??= attribute(segment, 'color');
      const segmentName = attribute(segment, 'name');
      if (segmentName) named.push([segmentCount, segmentName]);
    }
    const name = attribute(element, 'name');
    if (!valid || spans.length === 0) {
      warnings.add('location_dropped', `SnapGene feature ${name ?? key} has no usable range`);
      continue;
    }
    if (named.length > 0) {
      const ordered =
        strand === 1 ? named : named.map(([i, n]): [number, string] => [segmentCount - i + 1, n]).reverse();
      qualifiers.parts = [ordered.map(([i, n]) => `${i}:${n}`).join(';')];
    }
    for (const q of descendants(element, 'Q')) {
      const qName = attribute(q, 'name');
      if (qName === undefined) throw new FormatError('malformed', 'SnapGene qualifier without a name');
      qualifiers[qName] = descendants(q, 'V').flatMap((v) => {
        const value = attribute(v, 'text') ?? attribute(v, 'predef') ?? attribute(v, 'int');
        return value === undefined ? [] : [value.replace(/\r\n|\r|\n/g, ' ').trim()];
      });
    }
    if (name) {
      if (!qualifiers.label) qualifiers.label = [name];
      else if (!qualifiers.label.includes(name)) qualifiers.name = [name];
    }
    features.push({
      id: `f${first + features.length + 1}`,
      ...typeForKey(key, qualifiers),
      name: nameFromQualifiers(key, qualifiers),
      location: location(spans, strand),
      origin: 'file',
      ...(color === undefined ? {} : { color }),
      qualifiers,
    });
  }
  return features;
}

function readPrimers(xml: XmlElement, length: number, first: number): Feature[] {
  const params = descendants(xml, 'HybridizationParams').at(-1);
  const minLength = Number(params?.attributes.minContinuousMatchLen ?? 0);
  const minTm = Number(params?.attributes.minMeltingTemperature ?? 0);
  const features: Feature[] = [];
  for (const primer of descendants(xml, 'Primer')) {
    const name = attribute(primer, 'name');
    const qualifiers: Record<string, string[]> = name ? { label: [name] } : {};
    const seen: string[] = [];
    for (const site of descendants(primer, 'BindingSite')) {
      const strand: Strand = attribute(site, 'boundStrand') === '1' ? -1 : 1;
      const spans = rangeSpans(attribute(site, 'location') ?? '', length, true);
      if (spans === undefined) continue;
      const signature = `${strand}:${spans.map((s) => `${s.start}-${s.end}`).join(',')}`;
      if (attribute(site, 'simplified') === '1' && seen.includes(signature)) continue;
      const annealed = attribute(site, 'annealedBases');
      if (annealed !== undefined && annealed.length < minLength) continue;
      const tm = attribute(site, 'meltingTemperature');
      if (tm !== undefined && Number(tm) < minTm) continue;
      seen.push(signature);
      features.push({
        id: `f${first + features.length + 1}`,
        type: 'primer_bind',
        name: name ?? 'primer_bind',
        location: location(spans, strand),
        origin: 'file',
        qualifiers,
      });
    }
  }
  return features;
}

function notesDate(text: string | undefined): string | undefined {
  const match = text && /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/.exec(text);
  return match ? insdcDate(Number(match[1]), Number(match[2]), Number(match[3])) : undefined;
}

/**
 * Reads a SnapGene file. Names follow Biopython (notes `AccessionNumber` → id, `Comments` → name and
 * description); without them, the map label and description from the notes, then the file name.
 */
export function readSnapGene(
  bytes: Uint8Array,
  fileName: string | undefined,
  warnings: Warnings,
): SeqRecord[] {
  const all = packets(bytes);
  const cookie = all[0];
  if (cookie?.type !== PACKET.cookie || utf8.decode(cookie.data.subarray(0, 8)) !== COOKIE) {
    throw new FormatError('malformed', 'the file does not start with a SnapGene cookie packet');
  }
  const dnaPackets = all.filter((p) => p.type === PACKET.dna);
  const dna = dnaPackets[0];
  if (dna === undefined || dna.data.length === 0)
    throw new FormatError('no_sequence', 'no DNA packet in the file');
  if (dnaPackets.length > 1) throw new FormatError('malformed', 'the file contains more than one DNA packet');
  const seq = latin1(dna.data.subarray(1)).toUpperCase();
  const topology = ((dna.data[0] as number) & 1) === 1 ? 'circular' : 'linear';

  const features: Feature[] = [];
  let notes: XmlElement | undefined;
  for (const packet of all) {
    if (packet.type === PACKET.features) {
      features.push(
        ...readFeatures(parseXml(utf8.decode(packet.data)), seq.length, warnings, features.length),
      );
    } else if (packet.type === PACKET.primers) {
      features.push(...readPrimers(parseXml(utf8.decode(packet.data)), seq.length, features.length));
    } else if (packet.type === PACKET.notes) {
      notes = parseXml(utf8.decode(packet.data));
    }
  }

  const accession = notes && childText(notes, 'AccessionNumber');
  const comment = notes && childText(notes, 'Comments');
  const name =
    comment?.split(' ')[0] ?? (notes && childText(notes, 'CustomMapLabel')) ?? fallbackName(fileName);
  const description = comment ?? (notes && childText(notes, 'Description')) ?? '';
  const date = notesDate(notes && childText(notes, 'LastModified'));
  return [
    {
      id: accession ?? name,
      name,
      description,
      alphabet: detectAlphabet(seq, 'DNA'),
      topology,
      seq,
      features,
      metadata: {
        ...(accession === undefined ? {} : { accession }),
        molType: 'DNA',
        ...(date === undefined ? {} : { date }),
        sourceFormat: 'snapgene',
      },
    },
  ];
}

// --- writer ------------------------------------------------------------------------------------------------

const encoder = new TextEncoder();

function packet(type: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + data.length);
  const view = new DataView(out.buffer);
  view.setUint8(0, type);
  view.setUint32(1, data.length);
  out.set(data, 5);
  return out;
}

/** Top-strand segment ranges; two segments that meet at the origin become one wrapping SnapGene range. */
function ranges(feature: Feature, length: number): string[] {
  const top =
    feature.location.strand === 1 ? feature.location.segments : [...feature.location.segments].reverse();
  const out: string[] = [];
  for (let i = 0; i < top.length; i++) {
    const span = top[i] as Span;
    const next = top[i + 1];
    if (next && span.end === length && next.start === 0) {
      out.push(`${span.start + 1}-${next.end}`);
      i++;
    } else {
      out.push(`${span.start + 1}-${span.end}`);
    }
  }
  return out;
}

function featureXml(feature: Feature, index: number, length: number): string {
  const color = feature.color ? ` color="${escapeXml(feature.color)}"` : '';
  const segments = ranges(feature, length)
    .map((range) => `<Segment range="${range}"${color} type="standard"/>`)
    .join('');
  const qualifiers = Object.entries(qualifiersToWrite(feature))
    .map(([name, values]) => {
      const vs = values
        .map((v) => (/^-?\d+$/.test(v) ? `<V int="${v}"/>` : `<V text="${escapeXml(v)}"/>`))
        .join('');
      return `<Q name="${escapeXml(name)}">${vs}</Q>`;
    })
    .join('');
  const directionality = feature.location.strand === 1 ? '1' : '2';
  return (
    `<Feature recentID="${index}" name="${escapeXml(feature.name)}" directionality="${directionality}" ` +
    `type="${escapeXml(keyOf(feature))}" allowSegmentOverlaps="0" consecutiveTranslationNumbering="1">` +
    `${segments}${qualifiers}</Feature>`
  );
}

function snapGeneDate(date: string | undefined): string | undefined {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const match = date && /^(\d{2})-([A-Z]{3})-(\d{4})$/.exec(date);
  if (!match) return undefined;
  return `${match[3]}.${months.indexOf(match[2] as string) + 1}.${Number(match[1])}`;
}

function notesXml(record: SeqRecord): string {
  const date = snapGeneDate(record.metadata.date);
  const html = (text: string) => escapeXml(`<html><body>${escapeXml(text)}</body></html>`);
  return [
    '<Notes>',
    '<Type>Natural</Type>',
    `<CustomMapLabel>${escapeXml(record.name)}</CustomMapLabel>`,
    '<UseCustomMapLabel>1</UseCustomMapLabel>',
    record.description ? `<Description>${html(record.description)}</Description>` : '',
    date ? `<LastModified>${date}</LastModified>` : '',
    record.metadata.accession
      ? `<AccessionNumber>${escapeXml(record.metadata.accession)}</AccessionNumber>`
      : '',
    '</Notes>',
  ].join('');
}

/**
 * Writes a DNA record as a SnapGene file: cookie, DNA (flags: double-stranded, plus circular), features
 * (primer binding sites included, as features) and notes with the map label and description.
 */
export function writeSnapGene(record: SeqRecord): Uint8Array {
  const cookie = new Uint8Array(14);
  cookie.set(encoder.encode(COOKIE));
  const view = new DataView(cookie.buffer);
  view.setUint16(8, 1);
  view.setUint16(10, 15);
  view.setUint16(12, 19);
  const dna = new Uint8Array(1 + record.seq.length);
  dna[0] = record.topology === 'circular' ? 0x03 : 0x02;
  for (let i = 0; i < record.seq.length; i++) dna[i + 1] = record.seq.charCodeAt(i);
  const features = record.features.map((f, i) => featureXml(f, i, record.seq.length)).join('');
  const parts = [
    packet(PACKET.cookie, cookie),
    packet(PACKET.dna, dna),
    packet(
      PACKET.features,
      encoder.encode(
        `<?xml version="1.0"?><Features nextValidID="${record.features.length}">${features}</Features>`,
      ),
    ),
    packet(PACKET.notes, encoder.encode(notesXml(record))),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
