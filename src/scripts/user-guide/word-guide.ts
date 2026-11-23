import { readFileSync } from 'node:fs';
import {
  AlignmentType,
  Bookmark,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  InternalHyperlink,
  LeaderType,
  LevelFormat,
  Packer,
  PageNumber,
  PageReference,
  Paragraph,
  Tab,
  Table,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
  type IParagraphOptions,
} from 'docx';
import { guideText } from './guide-text.ts';
import type { Block, Figure, Guide, Run } from './guide-model.ts';

const NAVY = '1B264F';
const ACCENT = 'E8590C';
const GREY = '6B7280';
const FONT = { ascii: 'Calibri', hAnsi: 'Calibri', cs: 'Arial' } as const;
/** The text area of a US Letter page with 1 inch margins, in pixels at 96 dpi (6.5 x 9 in), less room for a caption. */
const MAX_FIGURE_WIDTH = 624;
const MAX_FIGURE_HEIGHT = 780;
const ARABIC = /[؀-ۿ]/;
const LATIN = /[A-Za-z]/;

/**
 * Prints the guide as a Word document: a cover, the document control table, the contents (each entry links to its heading;
 * the page numbers are page references, filled in when the document is laid out), then one chapter per section with its tasks - numbered steps that match the badges of the
 * screenshots, each screenshot framed and captioned. An Arabic guide is written right to left.
 */
export const writeWordGuide = async (guide: Guide): Promise<Buffer> => {
  const rtl = guide.language === 'ar';
  const text = guideText(guide.language);
  const paragraph = (options: IParagraphOptions): Paragraph => new Paragraph({ bidirectional: rtl, ...options });

  /** Text runs: Arabic text right to left, screen labels (Latin) as they are. */
  const runs = (parts: readonly Run[], extra: { size?: number; color?: string; italics?: boolean } = {}): TextRun[] =>
    parts.map((part) => new TextRun({ text: part.text, bold: part.bold, font: FONT, rightToLeft: rtl && (ARABIC.test(part.text) || !LATIN.test(part.text)), ...extra }));

  const figure = (block: Figure): (Paragraph | Table)[] => {
    const scale = Math.min(1, MAX_FIGURE_WIDTH / block.width, MAX_FIGURE_HEIGHT / block.height);
    const border = { style: BorderStyle.SINGLE, size: 18, color: '000000' };
    return [
      new Table({
        visuallyRightToLeft: rtl,
        width: { size: Math.round(block.width * scale * 15), type: WidthType.DXA },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                borders: { top: border, bottom: border, left: border, right: border },
                margins: { top: 0, bottom: 0, left: 0, right: 0 },
                children: [paragraph({ keepNext: true, children: [new ImageRun({ type: 'png', data: readFileSync(block.file), transformation: { width: Math.round(block.width * scale), height: Math.round(block.height * scale) } })] })],
              }),
            ],
          }),
        ],
      }),
      paragraph({ keepNext: true, spacing: { before: 60, after: 160 }, children: runs([{ text: block.caption }], { size: 18, color: GREY, italics: true }) }),
    ];
  };

  const numberingReferences: string[] = [];
  const body: (Paragraph | Table)[] = [];

  // Document control
  body.push(paragraph({ heading: HeadingLevel.HEADING_1, children: runs([{ text: text.documentControl }]) }));
  const cell = (value: string, bold = false): TableCell =>
    new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, children: [paragraph({ children: runs([{ text: value, bold }]) })] });
  body.push(
    new Table({
      visuallyRightToLeft: rtl,
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        [text.control.version, guide.version],
        [text.control.date, guide.date],
        [text.control.address, guide.address],
        [text.control.preparedBy, text.control.preparedByValue],
      ].map(([label, value]) => new TableRow({ children: [cell(label, true), cell(value)] })),
    }),
  );

  // Contents: every chapter and task, linked to its heading, with its page number
  const headings: { level: 1 | 2; title: string; anchor: string }[] = [];
  for (const chapter of guide.chapters) {
    headings.push({ level: 1, title: chapter.title, anchor: `toc_${headings.length + 1}` });
    for (const procedure of chapter.procedures) {
      headings.push({ level: 2, title: procedure.title, anchor: `toc_${headings.length + 1}` });
    }
  }
  body.push(paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: runs([{ text: text.contents }]) }));
  for (const heading of headings) {
    body.push(
      paragraph({
        tabStops: [{ type: TabStopType.END, position: 9360, leader: LeaderType.DOT }],
        indent: heading.level === 2 ? { start: 400 } : undefined,
        spacing: { before: heading.level === 1 ? 120 : 20 },
        children: [
          new InternalHyperlink({ anchor: heading.anchor, children: runs([{ text: heading.title, bold: heading.level === 1 }]) }),
          new TextRun({ children: [new Tab()] }),
          new PageReference(heading.anchor),
        ],
      }),
    );
  }

  // Chapters
  const anchors = headings.map((heading) => heading.anchor);
  const headingParagraph = (level: 1 | 2, title: string): Paragraph =>
    paragraph({
      heading: level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
      pageBreakBefore: level === 1,
      keepNext: true,
      children: [new Bookmark({ id: anchors.shift() ?? '', children: runs([{ text: title }]) })],
    });
  for (const chapter of guide.chapters) {
    body.push(headingParagraph(1, chapter.title));
    for (const intro of chapter.intro) {
      body.push(paragraph({ spacing: { after: 160 }, children: runs(intro) }));
    }
    for (const procedure of chapter.procedures) {
      const reference = `steps-${numberingReferences.length + 1}`;
      numberingReferences.push(reference);
      body.push(headingParagraph(2, procedure.title));
      for (const block of procedure.blocks) {
        body.push(...blockOf(block, reference));
      }
    }
  }

  function blockOf(block: Block, reference: string): (Paragraph | Table)[] {
    switch (block.kind) {
      case 'figure':
        return figure(block);
      case 'step':
        return [paragraph({ numbering: { reference, level: 0 }, spacing: { after: 80 }, children: runs(block.runs) })];
      case 'note':
        return [paragraph({ spacing: { before: 80, after: 120 }, children: runs(block.runs, { color: '374151' }) })];
      default:
        return [paragraph({ spacing: { after: 120 }, children: runs(block.runs) })];
    }
  }

  const cover: Paragraph[] = [
    paragraph({ spacing: { before: 1800 } }),
    ...(guide.logo ? [paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'png', data: readFileSync(guide.logo), transformation: { width: 140, height: 140 } })] })] : []),
    paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 600, after: 240 }, children: runs([{ text: guide.title }], { size: 52, color: NAVY }) }),
    paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 }, children: runs([{ text: guide.subtitle }], { size: 28, color: GREY }) }),
    paragraph({ alignment: AlignmentType.CENTER, children: runs([{ text: `${text.control.version} ${guide.version}  |  ${guide.date}` }], { size: 22, color: GREY }) }),
  ];

  const document = new Document({
    creator: 'ECS.Automation',
    title: guide.title,
    // Word fills in the contents' page numbers when it opens the file (it asks to update the fields)
    features: { updateFields: true },
    styles: {
      default: { document: { run: { font: FONT, size: 22 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 34, bold: true, color: NAVY, font: FONT }, paragraph: { spacing: { before: 240, after: 200 }, keepNext: true } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 27, bold: true, color: ACCENT, font: FONT }, paragraph: { spacing: { before: 280, after: 140 }, keepNext: true } },
      ],
    },
    numbering: {
      config: numberingReferences.map((reference) => ({
        reference,
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START, style: { paragraph: { indent: { start: 520, hanging: 360 } } } }],
      })),
    },
    sections: [
      { properties: { titlePage: true }, children: cover },
      {
        properties: { page: { pageNumbers: { start: 1 } } },
        headers: {
          default: new Header({
            children: [paragraph({ border: { bottom: { color: ACCENT, size: 12, style: BorderStyle.SINGLE, space: 4 } }, children: runs([{ text: guide.title }], { size: 18, color: GREY }) })],
          }),
        },
        footers: { default: new Footer({ children: [paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18, color: GREY })] })] }) },
        children: body,
      },
    ],
  });
  return Packer.toBuffer(document);
};
