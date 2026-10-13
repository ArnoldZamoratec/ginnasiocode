/**
 * Generador PDF mínimo (PDF 1.4, fuentes estándar Helvetica/Courier con WinAnsiEncoding).
 * Suficiente para comprobantes: texto, líneas, rectángulos y texto rotado. Sin dependencias.
 */
type Font = 'regular' | 'bold' | 'mono';
const FONT_REF: Record<Font, string> = { regular: 'F1', bold: 'F2', mono: 'F3' };

const WIN_ANSI: Record<number, number> = {
  0x2014: 0x97, 0x2013: 0x96, 0x2022: 0x95, 0x2026: 0x85, 0x201c: 0x93, 0x201d: 0x94, 0x2018: 0x91, 0x2019: 0x92, 0x20ac: 0x80,
};

function encode(text: string): Buffer {
  const bytes: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    const b = c < 256 ? c : WIN_ANSI[c] ?? 0x3f;
    if (b === 0x28 || b === 0x29 || b === 0x5c) bytes.push(0x5c); // escapar ( ) \
    bytes.push(b);
  }
  return Buffer.from(bytes);
}

export class PdfPage {
  readonly width: number;
  readonly height: number;
  private chunks: Buffer[] = [];

  constructor(width = 420, height = 595) {
    this.width = width;
    this.height = height;
  }

  private op(s: string) { this.chunks.push(Buffer.from(s + '\n', 'latin1')); }

  /** y medido desde arriba (más natural para maquetar). */
  text(x: number, yTop: number, text: string, size = 10, font: Font = 'regular', gray = 0): this {
    this.op(`${gray} g BT /${FONT_REF[font]} ${size} Tf ${x.toFixed(2)} ${(this.height - yTop).toFixed(2)} Td (`);
    this.chunks.push(encode(text));
    this.op(') Tj ET');
    return this;
  }

  /** Texto alineado a la derecha; exacto para Courier (0.6 em), aproximado para Helvetica. */
  textRight(xRight: number, yTop: number, text: string, size = 10, font: Font = 'mono', gray = 0): this {
    const w = text.length * size * (font === 'mono' ? 0.6 : font === 'bold' ? 0.58 : 0.52);
    return this.text(xRight - w, yTop, text, size, font, gray);
  }

  rotatedText(cx: number, cyTop: number, text: string, size: number, deg: number, gray = 0.85): this {
    const r = (deg * Math.PI) / 180, c = Math.cos(r).toFixed(4), s = Math.sin(r).toFixed(4);
    const w = text.length * size * 0.62;
    const x = cx - (w / 2) * Math.cos(r), y = this.height - cyTop - (w / 2) * Math.sin(r);
    this.op(`${gray} g BT /F2 ${size} Tf ${c} ${s} ${-Number(s)} ${c} ${x.toFixed(2)} ${y.toFixed(2)} Tm (`);
    this.chunks.push(encode(text));
    this.op(') Tj ET');
    return this;
  }

  line(x1: number, y1Top: number, x2: number, y2Top: number, width = 0.5, gray = 0): this {
    this.op(`${gray} G ${width} w ${x1} ${this.height - y1Top} m ${x2} ${this.height - y2Top} l S`);
    return this;
  }

  rect(x: number, yTop: number, w: number, h: number, gray = 0): this {
    this.op(`${gray} g ${x} ${this.height - yTop - h} ${w} ${h} re f`);
    return this;
  }

  content(): Buffer { return Buffer.concat(this.chunks); }
}

export function renderPdf(page: PdfPage, title: string): Buffer {
  const objects: Buffer[] = [];
  const add = (b: Buffer | string) => objects.push(typeof b === 'string' ? Buffer.from(b, 'latin1') : b) ;
  const content = page.content();
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> >>`);
  add(Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`, 'latin1'), content, Buffer.from('endstream', 'latin1')]));
  for (const base of ['Helvetica', 'Helvetica-Bold', 'Courier-Bold']) {
    add(`<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`);
  }
  add(Buffer.concat([Buffer.from('<< /Title (', 'latin1'), encode(title), Buffer.from(') /Producer (GymOS) >>', 'latin1')]));

  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets: number[] = [];
  let pos = parts[0].length;
  objects.forEach((obj, i) => {
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), obj, Buffer.from('\nendobj\n', 'latin1')]);
    offsets.push(pos);
    pos += chunk.length;
    parts.push(chunk);
  });
  const xref = ['xref', `0 ${objects.length + 1}`, '0000000000 65535 f ',
    ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `)].join('\n');
  parts.push(Buffer.from(`${xref}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${pos}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(parts);
}
