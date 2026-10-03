// A small, dependency-free .xlsx writer for the weekly report. Written by
// hand rather than pulled in as a library on purpose: the free build of
// SheetJS drops every cell style on write (colors, bold, borders are a
// Pro-only feature), and ExcelJS is far heavier than a Worker should
// carry. This covers exactly what the report needs: multiple sheets,
// styled cells, merged ranges, column widths, frozen panes, and print
// setup (landscape, fit to one page wide) so it prints cleanly.

const encoder = new TextEncoder();

// --- styles -----------------------------------------------------------
// Name -> index into <cellXfs>. Order here is the contract with STYLES_XML.
export const S = {
  default: 0,
  title: 1,
  subtitle: 2,
  section: 3,
  header: 4,
  text: 5,
  center: 6,
  flag: 7,
  machine: 8,
  muted: 9,
  percent: 10,
  headSubmitted: 11,
  headPartial: 12,
  headMissed: 13,
  blank: 14,
  note: 15,
  bold: 16,
  headNeutral: 17,
};

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="7">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><sz val="16"/><color rgb="FF174C43"/><name val="Calibri"/></font>
<font><i/><sz val="10"/><color rgb="FF677478"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFA4332B"/><name val="Calibri"/></font>
<font><b/><sz val="13"/><color rgb="FF174C43"/><name val="Calibri"/></font>
</fonts>
<fills count="9">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF174C43"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE6F2EA"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFBE3E0"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFBF0DD"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF1F3F2"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD9564A"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF3F9D6C"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD0D7D2"/></left><right style="thin"><color rgb="FFD0D7D2"/></right><top style="thin"><color rgb="FFD0D7D2"/></top><bottom style="thin"><color rgb="FFD0D7D2"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="18">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="5" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="9" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="8" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // XML 1.0 forbids most control characters outright; one stray one in
    // a pasted note would make Excel call the whole file corrupt.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

export function columnName(index) {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

class Sheet {
  constructor(name, options = {}) {
    this.name = name;
    this.cols = options.cols || [];
    this.freeze = options.freeze || null; // { rows, cols }
    this.cells = new Map(); // "r,c" -> { value, style }
    this.merges = [];
    this.rowHeights = new Map();
  }
  set(row, col, value, style = S.default) {
    this.cells.set(`${row},${col}`, { row, col, value, style });
    return this;
  }
  // Fill a whole row range with one style (so merged/blank cells still
  // carry borders and fills instead of leaving holes).
  fill(row, fromCol, toCol, style) {
    for (let c = fromCol; c <= toCol; c += 1) {
      if (!this.cells.has(`${row},${c}`)) this.set(row, c, null, style);
    }
  }
  merge(r1, c1, r2, c2) {
    this.merges.push(`${columnName(c1)}${r1 + 1}:${columnName(c2)}${r2 + 1}`);
  }
  height(row, points) {
    this.rowHeights.set(row, points);
  }
  toXml() {
    const rows = new Map();
    let maxRow = 0;
    let maxCol = 0;
    for (const cell of this.cells.values()) {
      if (!rows.has(cell.row)) rows.set(cell.row, []);
      rows.get(cell.row).push(cell);
      maxRow = Math.max(maxRow, cell.row);
      maxCol = Math.max(maxCol, cell.col);
    }

    const rowXml = [...rows.keys()]
      .sort((a, b) => a - b)
      .map((r) => {
        const cells = rows
          .get(r)
          .sort((a, b) => a.col - b.col)
          .map((cell) => {
            const ref = `${columnName(cell.col)}${r + 1}`;
            const v = cell.value;
            if (v == null || v === "") return `<c r="${ref}" s="${cell.style}"/>`;
            if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}" s="${cell.style}"><v>${v}</v></c>`;
            return `<c r="${ref}" s="${cell.style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`;
          })
          .join("");
        const h = this.rowHeights.get(r);
        return `<row r="${r + 1}"${h ? ` ht="${h}" customHeight="1"` : ""}>${cells}</row>`;
      })
      .join("");

    const colsXml = this.cols.length
      ? `<cols>${this.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
      : "";

    let pane = "";
    if (this.freeze) {
      const { rows: fr = 0, cols: fc = 0 } = this.freeze;
      const topLeft = `${columnName(fc)}${fr + 1}`;
      const active = fr && fc ? "bottomRight" : fr ? "bottomLeft" : "topRight";
      pane = `<pane${fc ? ` xSplit="${fc}"` : ""}${fr ? ` ySplit="${fr}"` : ""} topLeftCell="${topLeft}" activePane="${active}" state="frozen"/><selection pane="${active}"/>`;
    }

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:${columnName(maxCol)}${maxRow + 1}"/>
<sheetViews><sheetView workbookViewId="0" showGridLines="0">${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="18"/>
${colsXml}
<sheetData>${rowXml}</sheetData>
${this.merges.length ? `<mergeCells count="${this.merges.length}">${this.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : ""}
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
  }
}

// Excel sheet names: max 31 chars, none of  [ ] : * ? / \  , unique
// case-insensitively.
export function safeSheetName(name, taken) {
  let base = String(name || "Sheet").replace(/[\[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Sheet";
  let candidate = base;
  let n = 2;
  while (taken.has(candidate.toLowerCase())) {
    const suffix = ` (${n})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
    n += 1;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

export class Workbook {
  constructor() {
    this.sheets = [];
    this.taken = new Set();
  }
  addSheet(name, options) {
    const sheet = new Sheet(safeSheetName(name, this.taken), options);
    this.sheets.push(sheet);
    return sheet;
  }
  toBytes() {
    const n = this.sheets.length;
    const files = [
      {
        name: "[Content_Types].xml",
        text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${this.sheets
          .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
          .join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
      },
      {
        name: "_rels/.rels",
        text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      },
      {
        name: "xl/workbook.xml",
        text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${this.sheets
          .map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
          .join("")}</sheets></workbook>`,
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${this.sheets
          .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
          .join("")}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      },
      { name: "xl/styles.xml", text: STYLES_XML },
      ...this.sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: s.toXml() })),
    ].map((f) => ({ name: f.name, data: encoder.encode(f.text) }));
    return zipStore(files);
  }
}

// --- zip (stored, no compression) --------------------------------------
// A .xlsx is just a zip. Stored entries need only a CRC-32 and sizes,
// which keeps this tiny; the XML compresses fine in transit anyway.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files) {
  const now = new Date();
  const dosTime = (now.getUTCHours() << 11) | (now.getUTCMinutes() << 5) | (now.getUTCSeconds() >> 1);
  const dosDate = ((now.getUTCFullYear() - 1980) << 9) | ((now.getUTCMonth() + 1) << 5) | now.getUTCDate();

  const parts = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const crc = crc32(file.data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, file.data.length, true);
    lv.setUint32(22, file.data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    parts.push(local, file.data);

    const entry = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(entry.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, file.data.length, true);
    cv.setUint32(24, file.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    entry.set(nameBytes, 46);
    central.push(entry);

    offset += local.length + file.data.length;
  }

  const centralSize = central.reduce((sum, e) => sum + e.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((sum, p) => sum + p.length, 0));
  let pos = 0;
  for (const p of all) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}
