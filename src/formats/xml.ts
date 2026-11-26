import { FormatError } from './internal';

/**
 * A minimal XML reader and writer for the small documents inside SnapGene files. `DOMParser` is not
 * available in Web Workers, where the formats run, so this module parses elements, attributes, text,
 * CDATA and the predefined and numeric entities, and skips comments, declarations and processing instructions.
 */

export interface XmlElement {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly XmlElement[];
  /** Concatenated text directly inside this element. */
  readonly text: string;
}

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (match, body: string) => {
    if (body.startsWith('#x')) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(Number(body.slice(1)));
    return ENTITIES[body] ?? match;
  });
}

interface MutableElement {
  name: string;
  attributes: Record<string, string>;
  children: MutableElement[];
  text: string;
}

const ATTRIBUTE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Parses an XML document and returns its root element. Throws FormatError on broken markup. */
export function parseXml(source: string): XmlElement {
  const root: MutableElement = { name: '', attributes: {}, children: [], text: '' };
  const stack: MutableElement[] = [root];
  let i = 0;
  const fail = (): never => {
    throw new FormatError('malformed', 'broken XML in SnapGene data');
  };
  while (i < source.length) {
    const lt = source.indexOf('<', i);
    const top = stack[stack.length - 1] as MutableElement;
    if (lt === -1) {
      top.text += decodeEntities(source.slice(i));
      break;
    }
    if (lt > i) top.text += decodeEntities(source.slice(i, lt));
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt);
      if (end === -1) fail();
      i = end + 3;
    } else if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt);
      if (end === -1) fail();
      top.text += source.slice(lt + 9, end);
      i = end + 3;
    } else if (source[lt + 1] === '?' || source[lt + 1] === '!') {
      const end = source.indexOf('>', lt);
      if (end === -1) fail();
      i = end + 1;
    } else if (source[lt + 1] === '/') {
      const end = source.indexOf('>', lt);
      if (end === -1 || stack.length < 2 || source.slice(lt + 2, end).trim() !== top.name) fail();
      stack.pop();
      i = end + 1;
    } else {
      const end = findTagEnd(source, lt);
      if (end === -1) fail();
      const selfClosing = source[end - 1] === '/';
      const inner = source.slice(lt + 1, selfClosing ? end - 1 : end);
      const name = /^[\w:.-]+/.exec(inner)?.[0];
      if (!name) fail();
      const attributes: Record<string, string> = {};
      for (const m of inner.slice((name as string).length).matchAll(ATTRIBUTE)) {
        attributes[m[1] as string] = decodeEntities(m[2] ?? m[3] ?? '');
      }
      const element: MutableElement = { name: name as string, attributes, children: [], text: '' };
      top.children.push(element);
      if (!selfClosing) stack.push(element);
      i = end + 1;
    }
  }
  const documentElement = root.children[0];
  if (stack.length !== 1 || documentElement === undefined) fail();
  return documentElement as XmlElement;
}

/** Index of the `>` that closes the tag opened at `lt`, skipping `>` inside quoted attribute values. */
function findTagEnd(source: string, lt: number): number {
  let quote = '';
  for (let i = lt + 1; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return i;
    }
  }
  return -1;
}

/** Every descendant element named `name`, in document order. */
export function descendants(element: XmlElement, name: string): XmlElement[] {
  const out: XmlElement[] = [];
  const visit = (e: XmlElement) => {
    for (const child of e.children) {
      if (child.name === name) out.push(child);
      visit(child);
    }
  };
  visit(element);
  return out;
}

/** Escapes text for an attribute value or element content. */
export function escapeXml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`);
}
