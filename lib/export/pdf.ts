type PdfFontKey = "F1" | "F2";

type PdfTextLine = {
  text: string;
  x: number;
  y: number;
  size?: number;
  font?: PdfFontKey;
};

type PdfPage = {
  lines: PdfTextLine[];
};

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const DEFAULT_FONT_SIZE = 10;
const DEFAULT_LINE_HEIGHT = 14;
const PAGE_MARGIN_X = 42;
const PAGE_MARGIN_TOP = 54;
const PAGE_MARGIN_BOTTOM = 42;
const CONTENT_WIDTH = A4_WIDTH - PAGE_MARGIN_X * 2;

function escapePdfText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r/g, "")
    .replace(/\n/g, " ");
}

function estimateLineWidth(value: string, fontSize = DEFAULT_FONT_SIZE) {
  return value.length * fontSize * 0.52;
}

function wrapText(value: string, maxWidth = CONTENT_WIDTH, fontSize = DEFAULT_FONT_SIZE) {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return [""];

  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (estimateLineWidth(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
      current = "";
    }

    if (estimateLineWidth(word, fontSize) <= maxWidth) {
      current = word;
      continue;
    }

    let buffer = "";
    for (const char of word) {
      const next = `${buffer}${char}`;
      if (estimateLineWidth(next, fontSize) > maxWidth && buffer) {
        lines.push(buffer);
        buffer = char;
      } else {
        buffer = next;
      }
    }
    current = buffer;
  }

  if (current) {
    lines.push(current);
  }

  return lines.length > 0 ? lines : [""];
}

function buildContentStream(page: PdfPage) {
  const commands = page.lines
    .map((line) => {
      const font = line.font ?? "F1";
      const size = line.size ?? DEFAULT_FONT_SIZE;
      return `BT /${font} ${size} Tf 1 0 0 1 ${line.x.toFixed(2)} ${line.y.toFixed(2)} Tm (${escapePdfText(
        line.text
      )}) Tj ET`;
    })
    .join("\n");

  return `${commands}\n`;
}

function createPdfDocument(pages: PdfPage[]) {
  const objects: string[] = [];
  const pushObject = (content: string) => {
    objects.push(content);
    return objects.length;
  };

  const catalogId = pushObject("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = pushObject("<< /Type /Pages /Kids [] /Count 0 >>");
  const fontRegularId = pushObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const fontBoldId = pushObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

  const pageIds: number[] = [];

  for (const page of pages) {
    const stream = buildContentStream(page);
    const streamId = pushObject(`<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}endstream`);
    const pageId = pushObject(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${A4_WIDTH.toFixed(2)} ${A4_HEIGHT.toFixed(
        2
      )}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${streamId} 0 R >>`
    );

    pageIds.push(pageId);
  }

  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  objects.forEach((content, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${content}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";

  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

export type FormattedPdfRecord = {
  position: number;
  companyName: string;
  tradeName?: string;
  cnpjFormatted: string;
  registrationStatus: string;
  primaryActivity: string;
  legalNature: string;
  companySize: string;
  taxProfile: string;
  openedAt: string;
  capitalSocial: string;
  location: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  contactChannel: string;
  dataCompleteness: string;
  commercialNote: string;
};

export type FormattedPdfInput = {
  title: string;
  subtitle: string;
  generatedAt: string;
  summary: Array<{ label: string; value: string }>;
  records: FormattedPdfRecord[];
};

export function createFormattedListPdf(input: FormattedPdfInput) {
  const pages: PdfPage[] = [];
  let currentPage: PdfPage = { lines: [] };
  let cursorY = A4_HEIGHT - PAGE_MARGIN_TOP;

  const ensureSpace = (requiredHeight: number) => {
    if (cursorY - requiredHeight < PAGE_MARGIN_BOTTOM) {
      pages.push(currentPage);
      currentPage = { lines: [] };
      cursorY = A4_HEIGHT - PAGE_MARGIN_TOP;
    }
  };

  const addLine = (text: string, options?: { size?: number; font?: PdfFontKey; indent?: number }) => {
    const size = options?.size ?? DEFAULT_FONT_SIZE;
    const font = options?.font ?? "F1";
    const x = PAGE_MARGIN_X + (options?.indent ?? 0);
    ensureSpace(DEFAULT_LINE_HEIGHT + 2);
    currentPage.lines.push({ text, x, y: cursorY, size, font });
    cursorY -= DEFAULT_LINE_HEIGHT;
  };

  const addWrapped = (text: string, options?: { size?: number; font?: PdfFontKey; indent?: number; width?: number }) => {
    const size = options?.size ?? DEFAULT_FONT_SIZE;
    const indent = options?.indent ?? 0;
    const lines = wrapText(text, options?.width ?? CONTENT_WIDTH - indent, size);
    ensureSpace(lines.length * DEFAULT_LINE_HEIGHT + 4);

    for (const line of lines) {
      currentPage.lines.push({
        text: line,
        x: PAGE_MARGIN_X + indent,
        y: cursorY,
        size,
        font: options?.font ?? "F1"
      });
      cursorY -= DEFAULT_LINE_HEIGHT;
    }
  };

  addWrapped(input.title, { size: 18, font: "F2" });
  addWrapped(input.subtitle, { size: 11 });
  addLine(`Gerado em ${input.generatedAt}`, { size: 9 });
  cursorY -= 8;

  if (input.summary.length > 0) {
    addLine("Resumo executivo", { size: 12, font: "F2" });
    for (const item of input.summary) {
      addWrapped(`${item.label}: ${item.value}`, { size: 10, indent: 8 });
    }
    cursorY -= 10;
  }

  addLine("Empresas organizadas pela IA", { size: 12, font: "F2" });
  cursorY -= 4;

  for (const record of input.records) {
    const blockLines = [
      `#${record.position} ${record.companyName} • ${record.cnpjFormatted}`,
      `Fantasia: ${record.tradeName || "-"}`,
      `Status: ${record.registrationStatus} • Atividade: ${record.primaryActivity}`,
      `Natureza/Porte: ${record.legalNature} • ${record.companySize}`,
      `Regime/Capital/Abertura: ${record.taxProfile} • ${record.capitalSocial} • ${record.openedAt}`,
      `Localização: ${record.location}`,
      `Endereço: ${record.address}`,
      `Contato: ${record.phone} • ${record.email} • ${record.website}`,
      `Canal recomendado: ${record.contactChannel} • Completude: ${record.dataCompleteness}`,
      `Nota comercial: ${record.commercialNote}`
    ];

    const requiredHeight = blockLines.reduce((sum, line, index) => {
      const wrapped = wrapText(line, CONTENT_WIDTH - 8, index === 0 ? 11 : 9);
      return sum + wrapped.length * DEFAULT_LINE_HEIGHT;
    }, 16);

    ensureSpace(requiredHeight + 8);
    addWrapped(blockLines[0], { size: 11, font: "F2" });
    for (const line of blockLines.slice(1)) {
      addWrapped(line, { size: 9, indent: 8 });
    }
    cursorY -= 10;
  }

  pages.push(currentPage);
  return createPdfDocument(pages);
}
