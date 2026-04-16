import { deflateRawSync } from "node:zlib";

export type WorkbookCell = {
  value: string;
  hyperlink?: string;
};

type WorkbookSheet = {
  name: string;
  rows: Array<Array<string | WorkbookCell>>;
  columnWidths?: number[];
  wrapColumns?: number[];
  autoFilter?: boolean;
  freezeHeader?: boolean;
};

type LegacyWorkbookInput = {
  sheetName: string;
  rows: string[][];
  columnWidths?: number[];
  wrapColumns?: number[];
  autoFilter?: boolean;
  freezeHeader?: boolean;
};

type WorkbookInput =
  | LegacyWorkbookInput
  | {
      sheets: WorkbookSheet[];
    };

const CRC32_TABLE = new Uint32Array(256);

for (let i = 0; i < 256; i += 1) {
  let c = i;
  for (let j = 0; j < 8; j += 1) {
    c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c >>> 0;
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosDateTime(date: Date) {
  const safeYear = Math.max(date.getFullYear(), 1980);
  const dosTime =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    Math.floor((date.getSeconds() & 0x3f) / 2);
  const dosDate =
    (((safeYear - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);

  return { dosTime, dosDate };
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeHyperlinkTarget(value: string | undefined) {
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return undefined;
    }
    if (!parsed.hostname) {
      return undefined;
    }

    return parsed.toString();
  } catch {
    return undefined;
  }
}

function columnName(index: number) {
  let current = index;
  let result = "";

  while (current >= 0) {
    result = String.fromCharCode((current % 26) + 65) + result;
    current = Math.floor(current / 26) - 1;
  }

  return result;
}

function normalizeSheets(input: WorkbookInput) {
  const normalizeCell = (cell: string | WorkbookCell): WorkbookCell => {
    if (typeof cell === "string") {
      return { value: cell };
    }

    return {
      value: typeof cell.value === "string" ? cell.value : "",
      hyperlink: normalizeHyperlinkTarget(cell.hyperlink)
    };
  };

  const normalizeRows = (rows: Array<Array<string | WorkbookCell>>) =>
    (rows.length > 0 ? rows : [[""]]).map((row) => row.map((cell) => normalizeCell(cell)));

  if ("sheets" in input) {
    return input.sheets.map((sheet) => ({
      ...sheet,
      rows: normalizeRows(sheet.rows),
      wrapColumns: sheet.wrapColumns ?? [],
      autoFilter: sheet.autoFilter !== false,
      freezeHeader: sheet.freezeHeader !== false
    }));
  }

  return [
    {
      name: input.sheetName,
      rows: normalizeRows(input.rows),
      columnWidths: input.columnWidths,
      wrapColumns: input.wrapColumns ?? [],
      autoFilter: input.autoFilter !== false,
      freezeHeader: input.freezeHeader !== false
    }
  ];
}

function readCellValue(cell: string | WorkbookCell | undefined) {
  if (!cell) return "";
  return typeof cell === "string" ? cell : cell.value;
}

function readCellHyperlink(cell: string | WorkbookCell | undefined) {
  if (!cell || typeof cell === "string") return undefined;
  return cell.hyperlink;
}

function buildSharedStrings(sheets: WorkbookSheet[]) {
  const indexByValue = new Map<string, number>();
  const values: string[] = [];

  function ensure(value: string) {
    if (indexByValue.has(value)) {
      return indexByValue.get(value)!;
    }

    const index = values.length;
    values.push(value);
    indexByValue.set(value, index);
    return index;
  }

  const matrices = sheets.map((sheet) => sheet.rows.map((row) => row.map((cell) => ensure(readCellValue(cell)))));

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sheets.reduce(
    (sum, sheet) => sum + sheet.rows.reduce((rowSum, row) => rowSum + row.length, 0),
    0
  )}" uniqueCount="${values.length}">${values
    .map((value) => `<si><t xml:space="preserve">${escapeXml(value)}</t></si>`)
    .join("")}</sst>`;

  return {
    xml,
    matrices
  };
}

function buildColumnWidths(sheet: WorkbookSheet) {
  const maxColumns = sheet.rows.reduce((max, row) => Math.max(max, row.length), 0);

  return Array.from({ length: maxColumns }, (_, columnIndex) => {
    const computedWidth = sheet.rows.reduce((max, row) => {
      const candidate = readCellValue(row[columnIndex]);
      const widestLine = candidate
        .split(/\r?\n/)
        .reduce((lineMax, line) => Math.max(lineMax, line.length), 0);
      return Math.max(max, widestLine);
    }, 0);

    const explicitWidth = sheet.columnWidths?.[columnIndex];
    if (typeof explicitWidth === "number" && Number.isFinite(explicitWidth)) {
      return Math.max(8, Math.min(explicitWidth, 120));
    }

    return Math.min(Math.max(computedWidth + 2, 12), 48);
  });
}

function buildSheetXml(sheet: WorkbookSheet, matrix: number[][]) {
  const maxColumns = sheet.rows.reduce((max, row) => Math.max(max, row.length), 0);
  const lastColumn = maxColumns > 0 ? columnName(maxColumns - 1) : "A";
  const lastRow = Math.max(sheet.rows.length, 1);
  const widths = buildColumnWidths(sheet);
  const wrapColumns = new Set(sheet.wrapColumns ?? []);

  const colsXml = widths.length
    ? `<cols>${widths
        .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
        .join("")}</cols>`
    : "";

  const hyperlinks: Array<{ ref: string; target: string; id: string }> = [];

  const sheetRowsXml = matrix
    .map((row, rowIndex) => {
      const cellsXml = row
        .map((sharedStringIndex, columnIndex) => {
          const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
          const rawCell = sheet.rows[rowIndex]?.[columnIndex];
          const rawValue = readCellValue(rawCell);
          const hyperlink = normalizeHyperlinkTarget(readCellHyperlink(rawCell));
          if (hyperlink) {
            hyperlinks.push({
              ref,
              target: hyperlink,
              id: `rId${hyperlinks.length + 1}`
            });
          }
          const shouldWrap = wrapColumns.has(columnIndex) || rawValue.includes("\n") || rawValue.length > 90;
          const styleIndex = rowIndex === 0 ? (shouldWrap ? 3 : 1) : shouldWrap ? 2 : 0;
          return `<c r="${ref}" t="s" s="${styleIndex}"><v>${sharedStringIndex}</v></c>`;
        })
        .join("");

      return `<row r="${rowIndex + 1}">${cellsXml}</row>`;
    })
    .join("");

  const sheetViewsXml = sheet.freezeHeader === false
    ? `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`
    : `<sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
      <selection pane="bottomLeft" activeCell="A2" sqref="A2"/>
    </sheetView>
  </sheetViews>`;

  const autoFilterXml = sheet.autoFilter !== false && maxColumns > 0 && lastRow > 1
    ? `<autoFilter ref="A1:${lastColumn}1"/>`
    : "";

  const hyperlinksXml = hyperlinks.length > 0
    ? `<hyperlinks>${hyperlinks
        .map((link) => `<hyperlink ref="${link.ref}" r:id="${link.id}"/>`)
        .join("")}</hyperlinks>`
    : "";

  const relationshipsXml = hyperlinks.length > 0
    ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hyperlinks
      .map(
        (link) =>
          `<Relationship Id="${link.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXml(link.target)}" TargetMode="External"/>`
      )
      .join("")}</Relationships>`
    : undefined;

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"${hyperlinks.length > 0 ? ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' : ""}>
  <dimension ref="A1:${lastColumn}${lastRow}"/>
  ${sheetViewsXml}
  <sheetFormatPr defaultRowHeight="18"/>
  ${colsXml}
  <sheetData>${sheetRowsXml}</sheetData>
  ${autoFilterXml}
  ${hyperlinksXml}
</worksheet>`;

  return { xml, relationshipsXml };
}

function buildStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font>
      <sz val="11"/>
      <name val="Calibri"/>
      <family val="2"/>
    </font>
    <font>
      <b/>
      <sz val="11"/>
      <name val="Calibri"/>
      <family val="2"/>
    </font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill>
      <patternFill patternType="solid">
        <fgColor rgb="FFF3F4F6"/>
        <bgColor indexed="64"/>
      </patternFill>
    </fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color auto="1"/></left>
      <right style="thin"><color auto="1"/></right>
      <top style="thin"><color auto="1"/></top>
      <bottom style="thin"><color auto="1"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">
      <alignment vertical="top"/>
    </xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="top"/>
    </xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">
      <alignment vertical="top" wrapText="1"/>
    </xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="top" wrapText="1"/>
    </xf>
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
</styleSheet>`;
}

function createZip(entries: Array<{ name: string; data: string | Buffer }>) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const now = new Date();
  const { dosDate, dosTime } = toDosDateTime(now);

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, "utf8");
    const dataBuffer = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const compressed = deflateRawSync(dataBuffer);
    const checksum = crc32(dataBuffer);

    const localHeader = Buffer.alloc(30 + nameBuffer.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(dataBuffer.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuffer.copy(localHeader, 30);

    const centralHeader = Buffer.alloc(46 + nameBuffer.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(dataBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuffer.copy(centralHeader, 46);

    localParts.push(localHeader, compressed);
    centralParts.push(centralHeader);
    offset += localHeader.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(entries.length, 8);
  endOfCentralDirectory.writeUInt16LE(entries.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12);
  endOfCentralDirectory.writeUInt32LE(offset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, endOfCentralDirectory]);
}

export function createXlsxWorkbook(input: WorkbookInput) {
  const sheets = normalizeSheets(input);
  const { xml: sharedStringsXml, matrices } = buildSharedStrings(sheets);
  const stylesXml = buildStylesXml();

  const worksheetEntries = sheets.map((sheet, index) => {
    const sheetXml = buildSheetXml(sheet, matrices[index] ?? [[0]]);
    return {
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: sheetXml.xml,
      relName: `xl/worksheets/_rels/sheet${index + 1}.xml.rels`,
      relData: sheetXml.relationshipsXml
    };
  });

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheets
    .map(
      (sheet, index) =>
        `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
    )
    .join("")}</sheets>
</workbook>`;

  const workbookRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheets
    .map(
      (_sheet, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
    )
    .join("")}
  <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  ${sheets
    .map(
      (_sheet, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join("")}
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

  const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>BuscaCNAE</Application>
  <HeadingPairs>
    <vt:vector size="2" baseType="variant">
      <vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant>
      <vt:variant><vt:i4>${sheets.length}</vt:i4></vt:variant>
    </vt:vector>
  </HeadingPairs>
  <TitlesOfParts>
    <vt:vector size="${sheets.length}" baseType="lpstr">
      ${sheets.map((sheet) => `<vt:lpstr>${escapeXml(sheet.name)}</vt:lpstr>`).join("")}
    </vt:vector>
  </TitlesOfParts>
</Properties>`;

  return createZip([
    {
      name: "[Content_Types].xml",
      data: contentTypesXml
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`
    },
    {
      name: "docProps/core.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>BuscaCNAE</dc:title>
  <dc:creator>ChatGPT</dc:creator>
  <cp:lastModifiedBy>ChatGPT</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified>
</cp:coreProperties>`
    },
    {
      name: "docProps/app.xml",
      data: appXml
    },
    {
      name: "xl/workbook.xml",
      data: workbookXml
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: workbookRelationships
    },
    {
      name: "xl/styles.xml",
      data: stylesXml
    },
    {
      name: "xl/sharedStrings.xml",
      data: sharedStringsXml
    },
    ...worksheetEntries.map((entry) => ({
      name: entry.name,
      data: entry.data
    })),
    ...worksheetEntries
      .filter((entry) => typeof entry.relData === "string" && entry.relData.trim())
      .map((entry) => ({
        name: entry.relName,
        data: entry.relData as string
      }))
  ]);
}
