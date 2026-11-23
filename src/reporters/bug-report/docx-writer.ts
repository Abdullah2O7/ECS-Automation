import JSZip from 'jszip';

/**
 * A small Word (.docx) writer for the bug report: paragraphs, tables, pictures and page breaks - nothing else. A .docx is a
 * zip of XML files; writing the few we need by hand avoids a dependency for it (jszip is already installed, exceljs uses it).
 */

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

export const escapeXml = (text: string): string =>
  text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export type RunStyle = { bold?: boolean; italic?: boolean; color?: string; size?: number; font?: string };
export type ParagraphStyle = { style?: 'Title' | 'Heading1' | 'Heading2' | 'Heading3'; pageBreakBefore?: boolean; rtl?: boolean; align?: 'left' | 'center'; spaceAfter?: number; keepNext?: boolean; indent?: number };

const run = (text: string, style: RunStyle = {}, rtl = false): string => {
  const props = [
    style.font ? `<w:rFonts w:ascii="${style.font}" w:hAnsi="${style.font}" w:cs="${style.font}"/>` : '',
    style.bold ? '<w:b/><w:bCs/>' : '',
    style.italic ? '<w:i/>' : '',
    style.color ? `<w:color w:val="${style.color}"/>` : '',
    style.size ? `<w:sz w:val="${style.size * 2}"/><w:szCs w:val="${style.size * 2}"/>` : '',
    rtl ? '<w:rtl/>' : '',
  ].join('');
  const parts = text.split('\n');
  const body = parts.map((part, index) => `${index > 0 ? '<w:br/>' : ''}<w:t xml:space="preserve">${escapeXml(part)}</w:t>`).join('');
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}${body}</w:r>`;
};

/** A paragraph of one or more runs (a plain string is one run). */
export const paragraph = (content: string | readonly { text: string; style?: RunStyle }[], style: ParagraphStyle = {}, runStyle: RunStyle = {}): string => {
  const props = [
    style.style ? `<w:pStyle w:val="${style.style}"/>` : '',
    style.keepNext ? '<w:keepNext/>' : '',
    style.pageBreakBefore ? '<w:pageBreakBefore/>' : '',
    style.rtl ? '<w:bidi/>' : '',
    style.spaceAfter !== undefined ? `<w:spacing w:after="${style.spaceAfter}"/>` : '',
    style.indent ? `<w:ind w:left="${style.indent}"/>` : '',
    style.align === 'center' ? '<w:jc w:val="center"/>' : style.rtl ? '<w:jc w:val="left"/>' : '',
  ].join('');
  const runs = typeof content === 'string' ? run(content, runStyle, style.rtl) : content.map((piece) => run(piece.text, { ...runStyle, ...piece.style }, style.rtl)).join('');
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${runs}</w:p>`;
};

export type Cell = { content: string; width: number; shade?: string };

/** A table row; each cell's content is already paragraphs (use `paragraph(...)`). Widths are in twentieths of a point. */
export const table = (rows: readonly (readonly Cell[])[]): string => {
  const grid = rows[0]?.map((cell) => `<w:gridCol w:w="${cell.width}"/>`).join('') ?? '';
  const body = rows
    .map(
      (cells) =>
        `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cells
          .map(
            (cell) =>
              `<w:tc><w:tcPr><w:tcW w:w="${cell.width}" w:type="dxa"/>${cell.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${cell.shade}"/>` : ''}</w:tcPr>${cell.content || '<w:p/>'}</w:tc>`,
          )
          .join('')}</w:tr>`,
    )
    .join('');
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl><w:p><w:pPr><w:spacing w:after="60"/></w:pPr></w:p>`;
};

const EMU_PER_CM = 360_000;

/** The size of a PNG, read from its header. */
export const pngSize = (data: Buffer): { width: number; height: number } => {
  if (data.length < 24 || data.readUInt32BE(0) !== 0x89504e47) {
    throw new Error('NOT_A_PNG: the picture is not a PNG file.');
  }
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
};

export class DocxBuilder {
  private readonly body: string[] = [];
  private readonly images: { name: string; data: Buffer }[] = [];

  add(xml: string): void {
    this.body.push(xml);
  }

  /** A PNG picture, scaled to the width (centimetres) keeping its shape. */
  image(data: Buffer, widthCm: number, description: string): string {
    const { width, height } = pngSize(data);
    const index = this.images.length + 1;
    const name = `image${index}.png`;
    this.images.push({ name, data });
    const cx = Math.round(widthCm * EMU_PER_CM);
    const cy = Math.round((cx * height) / width);
    return (
      `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
      `<wp:docPr id="${index}" name="Picture ${index}" descr="${escapeXml(description)}"/>` +
      `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${index}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="rIdImg${index}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
    );
  }

  async toBuffer(): Promise<Buffer> {
    const zip = new JSZip();
    zip.file(
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    );
    zip.file(
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    );
    const imageRelations = this.images
      .map((image, index) => `<Relationship Id="rIdImg${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${image.name}"/>`)
      .join('');
    zip.file(
      'word/_rels/document.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${imageRelations}</Relationships>`,
    );
    for (const image of this.images) {
      zip.file(`word/media/${image.name}`, image.data);
    }
    zip.file('word/styles.xml', STYLES);
    zip.file(
      'word/document.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${this.body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="900" w:right="1134" w:bottom="800" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`,
    );
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }
}

const heading = (id: string, size: number, color: string, before: number, after: number): string =>
  `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${id}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${before}" w:after="${after}"/></w:pPr><w:rPr><w:b/><w:color w:val="${color}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
  heading('Title', 52, '7F1D1D', 0, 120) +
  heading('Heading1', 36, '7F1D1D', 120, 120) +
  heading('Heading2', 28, '1F2937', 200, 80) +
  heading('Heading3', 24, '374151', 160, 60) +
  '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
  '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="9CA3AF"/>`).join('') +
  '</w:tblBorders><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>';
