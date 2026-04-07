type PdfFontKey = "F1" | "F2";

type PdfCommand =
  | {
      type: "text";
      text: string;
      x: number;
      y: number;
      size?: number;
      font?: PdfFontKey;
    }
  | {
      type: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    };

type PdfPage = {
  commands: PdfCommand[];
};

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const DEFAULT_FONT_SIZE = 10;
const DEFAULT_LINE_HEIGHT = 14;
const PAGE_MARGIN_X = 42;
const PAGE_MARGIN_TOP = 54;
const PAGE_MARGIN_BOTTOM = 42;
const CONTENT_WIDTH = A4_WIDTH - PAGE_MARGIN_X * 2;

const CP1252_EXTRA = new Map<string, number>([
  ["€", 0x80],
  ["‚", 0x82],
  ["ƒ", 0x83],
  ["„", 0x84],
  ["…", 0x85],
  ["†", 0x86],
  ["‡", 0x87],
  ["ˆ", 0x88],
  ["‰", 0x89],
  ["Š", 0x8a],
  ["‹", 0x8b],
  ["Œ", 0x8c],
  ["Ž", 0x8e],
  ["‘", 0x91],
  ["’", 0x92],
  ["“", 0x93],
  ["”", 0x94],
  ["•", 0x95],
  ["–", 0x96],
  ["—", 0x97],
  ["˜", 0x98],
  ["™", 0x99],
  ["š", 0x9a],
  ["›", 0x9b],
  ["œ", 0x9c],
  ["ž", 0x9e],
  ["Ÿ", 0x9f]
]);

function sanitizePdfText(value: string) {
  return value
    .replace(/\r/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ");
}

function encodePdfTextHex(value: string) {
  const bytes: number[] = [];
  const text = sanitizePdfText(value);

  for (const char of text) {
    const code = char.codePointAt(0) ?? 0x3f;

    if (code === 10) {
      bytes.push(0x20);
      continue;
    }

    if (code <= 0x7f || (code >= 0xa0 && code <= 0xff)) {
      bytes.push(code);
      continue;
    }

    const mapped = CP1252_EXTRA.get(char);
    bytes.push(mapped ?? 0x3f);
  }

  return Buffer.from(bytes).toString("hex").toUpperCase();
}

function estimateLineWidth(value: string, fontSize = DEFAULT_FONT_SIZE) {
  return sanitizePdfText(value).length * fontSize * 0.52;
}

function wrapText(value: string, maxWidth = CONTENT_WIDTH, fontSize = DEFAULT_FONT_SIZE) {
  const paragraphs = sanitizePdfText(value)
    .split(/\n+/)
    .map((part) => part.replace(/\s+/g, " ").trim());

  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push("");
      continue;
    }

    const words = paragraph.split(" ");
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
  }

  return lines.length > 0 ? lines : [""];
}

function buildContentStream(page: PdfPage) {
  const commands = page.commands
    .map((command) => {
      if (command.type === "line") {
        return `${command.x1.toFixed(2)} ${command.y1.toFixed(2)} m ${command.x2.toFixed(2)} ${command.y2.toFixed(2)} l S`;
      }

      const font = command.font ?? "F1";
      const size = command.size ?? DEFAULT_FONT_SIZE;
      return `BT /${font} ${size} Tf 1 0 0 1 ${command.x.toFixed(2)} ${command.y.toFixed(2)} Tm <${encodePdfTextHex(
        command.text
      )}> Tj ET`;
    })
    .join("\n");

  return `0 G\n${commands}\n`;
}

function createPdfDocument(pages: PdfPage[]) {
  const objects: string[] = [];
  const pushObject = (content: string) => {
    objects.push(content);
    return objects.length;
  };

  const catalogId = pushObject("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = pushObject("<< /Type /Pages /Kids [] /Count 0 >>");
  const fontRegularId = pushObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const fontBoldId = pushObject(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
  );

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
  title: string;
  subtitle?: string;
  sections: Array<{
    title: string;
    fields: Array<{
      label: string;
      value: string;
    }>;
  }>;
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
  let currentPage: PdfPage = { commands: [] };
  let cursorY = A4_HEIGHT - PAGE_MARGIN_TOP;
  let activeRecordHeader: { title: string; subtitle?: string } | null = null;

  const pushCurrentPage = () => {
    pages.push(currentPage);
    currentPage = { commands: [] };
    cursorY = A4_HEIGHT - PAGE_MARGIN_TOP;
  };

  const addLineBreak = (height = 8) => {
    cursorY -= height;
  };

  const addRule = () => {
    currentPage.commands.push({
      type: "line",
      x1: PAGE_MARGIN_X,
      y1: cursorY,
      x2: PAGE_MARGIN_X + CONTENT_WIDTH,
      y2: cursorY
    });
    cursorY -= 10;
  };

  const addWrapped = (text: string, options?: { size?: number; font?: PdfFontKey; indent?: number; width?: number }) => {
    const size = options?.size ?? DEFAULT_FONT_SIZE;
    const indent = options?.indent ?? 0;
    const x = PAGE_MARGIN_X + indent;
    const maxWidth = options?.width ?? CONTENT_WIDTH - indent;
    const lines = wrapText(text, maxWidth, size);

    for (const line of lines) {
      if (cursorY - DEFAULT_LINE_HEIGHT < PAGE_MARGIN_BOTTOM) {
        pushCurrentPage();
        if (activeRecordHeader) {
          const continuationTitle = `${activeRecordHeader.title} (continuação)`;
          addWrapped(continuationTitle, { size: 12, font: "F2" });
          if (activeRecordHeader.subtitle) {
            addWrapped(activeRecordHeader.subtitle, { size: 9 });
          }
          addRule();
        }
      }

      currentPage.commands.push({
        type: "text",
        text: line,
        x,
        y: cursorY,
        size,
        font: options?.font ?? "F1"
      });
      cursorY -= DEFAULT_LINE_HEIGHT;
    }
  };

  const addField = (label: string, value: string, indent = 8) => {
    addWrapped(`${label}: ${value}`, { size: 9.5, indent });
  };

  addWrapped(input.title, { size: 18, font: "F2" });
  addWrapped(input.subtitle, { size: 11 });
  addWrapped(`Gerado em ${input.generatedAt}`, { size: 9 });
  addLineBreak(6);

  if (input.summary.length > 0) {
    addWrapped("Resumo da lista", { size: 12, font: "F2" });
    for (const item of input.summary) {
      addField(item.label, item.value, 8);
    }
    addLineBreak(4);
  }

  addWrapped(
    "Formato de leitura: cada registro é exibido como ficha cadastral para preservar legibilidade, quebras corretas e estabilidade visual.",
    { size: 9 }
  );

  if (input.records.length === 0) {
    addLineBreak(8);
    addWrapped("Nenhum registro disponível para exibição.", { size: 10 });
    pages.push(currentPage);
    return createPdfDocument(pages);
  }

  pushCurrentPage();

  input.records.forEach((record, recordIndex) => {
    if (recordIndex > 0 && currentPage.commands.length > 0) {
      pushCurrentPage();
    }

    activeRecordHeader = {
      title: `#${record.position} ${record.title}`,
      subtitle: record.subtitle
    };

    addWrapped(activeRecordHeader.title, { size: 15, font: "F2" });
    if (record.subtitle) {
      addWrapped(record.subtitle, { size: 10.5 });
    }
    addRule();

    for (const section of record.sections) {
      if (section.fields.length === 0) continue;
      addWrapped(section.title, { size: 11, font: "F2" });
      for (const field of section.fields) {
        addField(field.label, field.value, 8);
      }
      addLineBreak(4);
    }
  });

  if (currentPage.commands.length > 0) {
    pages.push(currentPage);
  }

  return createPdfDocument(pages);
}
