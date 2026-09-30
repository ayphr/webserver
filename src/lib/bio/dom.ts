import { bioMarkdownToHtml, sanitizeBioUrl, serializeBio } from '../../../common';
import type { BioBlock, BioHeadingLevel, BioInline } from '../../../common';

/**
 * Converts the WYSIWYG editor surface into the bio dialect. In `limited` mode
 * only bold, italics and bullet lists survive; in `markdown` mode headings,
 * quotes, ordered lists, code and links are kept too. Everything else (links in
 * limited mode, images, raw HTML, colours, underlines) is unwrapped down to its
 * text, so the editor cannot produce markup the renderer does not understand.
 */

const SKIPPED_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'TEXTAREA',
  'SELECT',
  'OPTION',
  'AUDIO',
  'VIDEO',
]);

const BOLD_TAGS = new Set(['B', 'STRONG']);
const ITALIC_TAGS = new Set(['I', 'EM']);
const STRIKE_TAGS = new Set(['S', 'DEL', 'STRIKE']);
const HEADING_TAGS = new Map<string, BioHeadingLevel>([
  ['H1', 1],
  ['H2', 2],
  ['H3', 3],
  ['H4', 3],
  ['H5', 3],
  ['H6', 3],
]);
/** Block containers end the current bio line, so their children are not glued together. */
const BLOCK_TAGS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'CENTER',
  'DD',
  'DETAILS',
  'DIV',
  'DL',
  'DT',
  'FIELDSET',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'FORM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'LI',
  'MAIN',
  'NAV',
  'P',
  'PRE',
  'SECTION',
  'SUMMARY',
  'TABLE',
  'TD',
  'TH',
  'TR',
]);

const FONT_WEIGHT_BOLD = /font-weight\s*:\s*(?:bold|[6-9]00)/i;
const FONT_STYLE_ITALIC = /font-style\s*:\s*(?:italic|oblique)/i;

type InlineStyle = { bold: boolean; italic: boolean };

const BASE_STYLE: InlineStyle = { bold: false, italic: false };

type Segment =
  | { type: 'line'; inlines: BioInline[] }
  | { type: 'heading'; level: BioHeadingLevel; inlines: BioInline[] }
  | { type: 'quote'; inlines: BioInline[] }
  | { type: 'codeBlock'; code: string }
  | { type: 'bullet'; inlines: BioInline[] }
  | { type: 'ordered'; inlines: BioInline[] };

type Collector = { extended: boolean; inlines: BioInline[]; segments: Segment[] };

function createCollector(extended: boolean): Collector {
  return { extended, inlines: [], segments: [] };
}

function splitOnNewlines(inlines: BioInline[]): BioInline[][] {
  const parts: BioInline[][] = [[]];

  for (const inline of inlines) {
    if (inline.kind !== 'text' || !inline.value.includes('\n')) {
      parts[parts.length - 1].push(inline);
      continue;
    }

    const pieces = inline.value.split('\n');
    pieces.forEach((piece, index) => {
      if (index > 0) parts.push([]);
      if (piece) parts[parts.length - 1].push({ kind: 'text', value: piece });
    });
  }

  return parts;
}

function trimInlines(inlines: BioInline[]): BioInline[] {
  const normalized = inlines
    .map((inline) => (inline.kind === 'text' ? { kind: 'text' as const, value: inline.value.replace(/\s+/g, ' ') } : inline))
    .filter((inline) => inline.kind !== 'text' || inline.value.length > 0);

  if (normalized.length === 0) return [];

  const first = normalized[0];
  if (first.kind === 'text') first.value = first.value.replace(/^\s+/, '');

  const last = normalized[normalized.length - 1];
  if (last.kind === 'text') last.value = last.value.replace(/\s+$/, '');

  return normalized.filter((inline) => inline.kind !== 'text' || inline.value.length > 0);
}

function pushInlines(collector: Collector, inlines: BioInline[], make: (inlines: BioInline[]) => Segment): void {
  for (const part of splitOnNewlines(inlines)) {
    const trimmed = trimInlines(part);
    if (trimmed.length > 0) collector.segments.push(make(trimmed));
  }
}

function flushInlines(collector: Collector, type: Segment['type'] = 'line'): void {
  if (collector.inlines.length === 0) return;
  pushInlines(collector, collector.inlines, (inlines) => ({ type, inlines }) as Segment);
  collector.inlines = [];
}

/** `<pre>` content is verbatim, so it is read as text instead of inlines. */
function extractCodeText(node: Node): string {
  let code = '';

  const walk = (current: Node) => {
    for (const child of Array.from(current.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        code += child.nodeValue ?? '';
        continue;
      }

      if (child.nodeType !== Node.ELEMENT_NODE) continue;

      const element = child as HTMLElement;
      const tag = element.tagName.toUpperCase();

      if (tag === 'BR') {
        code += '\n';
        continue;
      }

      const isBlock = BLOCK_TAGS.has(tag) && code.length > 0 && !code.endsWith('\n');
      if (isBlock) code += '\n';
      walk(element);
      if (isBlock && !code.endsWith('\n')) code += '\n';
    }
  };

  walk(node);
  return code.replace(/\s+$/, '');
}

function collectInlines(nodes: Iterable<Node>, collector: Collector, style: InlineStyle): void {
  for (const node of Array.from(nodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = (node.nodeValue ?? '').replaceAll('\u00a0', ' ');
      if (value) collector.inlines.push({ kind: 'text', value });
      continue;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const element = node as HTMLElement;
    const tag = element.tagName.toUpperCase();
    if (SKIPPED_TAGS.has(tag)) continue;

    if (tag === 'BR') {
      collector.inlines.push({ kind: 'text', value: '\n' });
      continue;
    }

    if (tag === 'CODE' && collector.extended) {
      const code = extractCodeText(element).replace(/\s+/g, ' ').trim();
      if (code) collector.inlines.push({ kind: 'code', value: code });
      continue;
    }

    if (tag === 'A' && collector.extended) {
      const href = sanitizeBioUrl(element.getAttribute('href') ?? '');

      if (href) {
        const inner = createCollector(true);
        collectInlines(element.childNodes, inner, style);
        const label = trimInlines(inner.inlines);
        collector.inlines.push({
          kind: 'link',
          href,
          children: label.length > 0 ? label : [{ kind: 'text', value: href }],
        });
        continue;
      }
      // A link with an unusable href keeps its text and loses the link.
    }

    // Some browsers apply emphasis as inline styles instead of <b>/<i>.
    const styleText = element.getAttribute('style') ?? '';
    const cssBold = FONT_WEIGHT_BOLD.test(styleText);
    const cssItalic = FONT_STYLE_ITALIC.test(styleText);
    const cssStrike = /text-decoration\s*:[^;]*line-through/i.test(styleText);

    const introducesBold = (BOLD_TAGS.has(tag) || cssBold) && !style.bold;
    const introducesItalic = (ITALIC_TAGS.has(tag) || cssItalic) && !style.italic;
    const introducesStrike = collector.extended && (STRIKE_TAGS.has(tag) || cssStrike);
    const isBlock = BLOCK_TAGS.has(tag);

    if (isBlock) {
      collector.inlines.push({ kind: 'text', value: '\n' });
    }

    if (introducesBold || introducesItalic || introducesStrike) {
      const inner = createCollector(collector.extended);
      collectInlines(element.childNodes, inner, {
        bold: style.bold || introducesBold,
        italic: style.italic || introducesItalic,
      });

      for (const part of splitOnNewlines(inner.inlines)) {
        const children = trimInlines(part);
        if (children.length === 0) continue;

        // Emphasis cannot span a line break in the bio dialect, so it is
        // dropped rather than producing markers the renderer shows verbatim.
        if (introducesBold) collector.inlines.push({ kind: 'bold', children });
        else if (introducesItalic) collector.inlines.push({ kind: 'italic', children });
        else collector.inlines.push({ kind: 'strike', children });
      }
    } else {
      collectInlines(element.childNodes, collector, { bold: style.bold || introducesBold, italic: style.italic || introducesItalic });
    }

    if (isBlock) {
      collector.inlines.push({ kind: 'text', value: '\n' });
    }
  }
}

function walkBlocks(nodes: Iterable<Node>, collector: Collector): void {
  for (const node of Array.from(nodes)) {
    if (node.nodeType !== Node.ELEMENT_NODE) {
      collectInlines([node], collector, BASE_STYLE);
      continue;
    }

    const element = node as HTMLElement;
    const tag = element.tagName.toUpperCase();
    if (SKIPPED_TAGS.has(tag)) continue;

    if (tag === 'BR') {
      collector.inlines.push({ kind: 'text', value: '\n' });
      continue;
    }

    if (tag === 'PRE' && collector.extended) {
      flushInlines(collector);
      const code = extractCodeText(element);
      if (code.trim().length > 0) collector.segments.push({ type: 'codeBlock', code });
      continue;
    }

    const headingLevel = collector.extended ? HEADING_TAGS.get(tag) : undefined;

    if (headingLevel) {
      flushInlines(collector);
      const level = headingLevel;
      const inner = createCollector(true);
      walkBlocks(element.childNodes, inner);
      pushInlines(collector, inner.inlines, (inlines) => ({ type: 'heading', level, inlines }));
      collector.segments.push(...inner.segments);
      continue;
    }

    if (tag === 'UL' || tag === 'OL') {
      flushInlines(collector);
      const listType: Segment['type'] = tag === 'OL' && collector.extended ? 'ordered' : 'bullet';

      for (const item of Array.from(element.children)) {
        if (SKIPPED_TAGS.has(item.tagName.toUpperCase())) continue;

        const inner = createCollector(collector.extended);
        walkBlocks(item.childNodes, inner);
        pushInlines(collector, inner.inlines, (inlines) => ({ type: listType, inlines }) as Segment);
        collector.segments.push(...inner.segments);
      }
      continue;
    }

    if (tag === 'BLOCKQUOTE' && collector.extended) {
      flushInlines(collector);
      const inner = createCollector(true);
      walkBlocks(element.childNodes, inner);
      pushInlines(collector, inner.inlines, (inlines) => ({ type: 'quote', inlines }));
      collector.segments.push(...inner.segments);
      continue;
    }

    collectInlines([node], collector, BASE_STYLE);
  }
}

function segmentsToBlocks(segments: Segment[]): BioBlock[] {
  const blocks: BioBlock[] = [];

  for (const segment of segments) {
    if (segment.type === 'codeBlock') {
      blocks.push({ kind: 'codeBlock', lang: '', code: segment.code });
      continue;
    }

    if (segment.type === 'heading') {
      blocks.push({ kind: 'heading', level: segment.level, inlines: segment.inlines });
      continue;
    }

    if (segment.type === 'quote') {
      blocks.push({ kind: 'quote', inlines: segment.inlines });
      continue;
    }

    if (segment.type === 'bullet' || segment.type === 'ordered') {
      const kind = segment.type === 'bullet' ? 'bullets' : 'ordered';
      const previous = blocks[blocks.length - 1];

      if (previous?.kind === kind) {
        previous.items.push(segment.inlines);
      } else {
        blocks.push({ kind, items: [segment.inlines] });
      }
      continue;
    }

    blocks.push({ kind: 'line', inlines: segment.inlines });
  }

  return blocks;
}

export function htmlToBioBlocks(root: HTMLElement, extended = false): BioBlock[] {
  const collector = createCollector(extended);
  walkBlocks(root.childNodes, collector);
  flushInlines(collector);
  return segmentsToBlocks(collector.segments);
}

export function htmlToBioMarkdown(html: string, extended = false): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  return serializeBio(htmlToBioBlocks(parsed.body, extended), extended);
}

/**
 * Rebuilds editor HTML through the dialect, which strips anything the editor
 * allows but the bio format does not support.
 */
export function sanitizeEditorHtml(html: string, extended = false): string {
  return bioMarkdownToHtml(htmlToBioMarkdown(html, extended), extended);
}
