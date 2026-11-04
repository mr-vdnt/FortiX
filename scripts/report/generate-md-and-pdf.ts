import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import {
  ReportBlock,
  ReportChapter,
  ReportDocumentModel,
} from './types';
import {
  REPORT_METADATA,
  REPORT_ABBREVIATIONS,
  REPORT_PRELIMINARY,
  CHAPTERS_PART1,
} from './content-part1';
import { CHAPTERS_PART2 } from './content-part2';
import { CHAPTERS_PART3 } from './content-part3';

const ROOT_DIR = process.cwd();
const REPORTS_DIR = path.join(ROOT_DIR, 'docs/reports');
const AST_PATH = path.join(REPORTS_DIR, 'report-ast.json');
const MD_PATH = path.join(REPORTS_DIR, 'FORTIX_BTECH_PROJECT_REPORT.md');
const PDF_PATH = path.join(REPORTS_DIR, 'FORTIX_BTECH_PROJECT_REPORT.pdf');

const PAGE_W = 595.28; // A4 width pt
const PAGE_H = 841.89; // A4 height pt
const MARGIN_L = 50;
const MARGIN_R = 50;
const MARGIN_T = 62;
const MARGIN_B = 64; // Logical content bottom guard (leaves generous room above footer at PAGE_H - 36)
const PDFKIT_MARGIN_B = 42; // 22pt below MAX_Y so single-row/cell rendering at MAX_Y never triggers hidden auto-addPage
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;
const MAX_Y = PAGE_H - MARGIN_B;

const TTF_PATHS = {
  sans: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  bold: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  italic: '/usr/share/fonts/truetype/noto/NotoSans-Italic.ttf',
  mono: '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
  monoBold: '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf',
};

const HAS_TTF = fs.existsSync(TTF_PATHS.sans);

const FONTS = {
  sans: HAS_TTF ? 'FortiXSans' : 'Helvetica',
  bold: HAS_TTF ? 'FortiXSansBold' : 'Helvetica-Bold',
  italic: HAS_TTF ? 'FortiXSansItalic' : 'Helvetica-Oblique',
  mono: HAS_TTF ? 'FortiXMono' : 'Courier',
  monoBold: HAS_TTF ? 'FortiXMonoBold' : 'Courier-Bold',
};

const COLORS = {
  navy: '#0F172A',
  slateDark: '#1E293B',
  body: '#1F2937',
  muted: '#475569',
  accent: '#EA580C',
  blue: '#1D4ED8',
  border: '#CBD5E1',
  lightBg: '#F8FAFC',
  altRow: '#F1F5F9',
  calloutBg: '#EFF6FF',
};

interface TocEntry {
  level: 1 | 2 | 3;
  label: string;
  page: number;
}

interface IndexedCaption {
  num: string;
  caption: string;
  page: number;
}

interface LayoutIndex {
  toc: TocEntry[];
  figures: IndexedCaption[];
  tables: IndexedCaption[];
  totalPages: number;
}

function readPngDimensions(filePath: string): { width: number; height: number } {
  const buf = fs.readFileSync(filePath);
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return {
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
    };
  }
  return { width: 1200, height: 750 };
}

function generateMarkdown(docModel: ReportDocumentModel): string {
  const lines: string[] = [];
  const m = docModel.metadata;

  lines.push(`# ${m.projectTitle} — ${m.projectSubtitle}`);
  lines.push(`**Core Principle:** \`${m.corePrinciple}\`  `);
  lines.push(`**Degree Program:** ${m.degreeProgram}  `);
  lines.push(`**Department:** ${m.departmentPlaceholder}, ${m.institutionPlaceholder}  `);
  lines.push(`**Affiliating University:** ${m.universityPlaceholder} (${m.academicYearPlaceholder})  `);
  lines.push(`**Repository:** ${m.repositoryUrl}`);
  lines.push('\n---\n');

  lines.push('## PRELIMINARY PAGES\n');
  lines.push('### Certificate\n');
  docModel.preliminary.certificateText.forEach((p) => lines.push(`${p}\n`));
  lines.push('### Declaration\n');
  docModel.preliminary.declarationText.forEach((p) => lines.push(`${p}\n`));
  lines.push('### Acknowledgement\n');
  docModel.preliminary.acknowledgementText.forEach((p) => lines.push(`${p}\n`));
  lines.push('### Abstract\n');
  docModel.preliminary.abstractParagraphs.forEach((p) => lines.push(`${p}\n`));
  lines.push(`**Keywords:** ${docModel.preliminary.keywords.join(', ')}\n`);

  lines.push('### List of Abbreviations\n');
  lines.push('| Abbreviation | Full Term | Operational Context in FortiX |');
  lines.push('|---|---|---|');
  for (const a of docModel.abbreviations) {
    lines.push(`| **${a.abbr}** | ${a.full} | ${a.context} |`);
  }
  lines.push('\n---\n');

  const renderBlockMd = (b: ReportBlock) => {
    if (b.kind === 'p') {
      lines.push(`${b.text}\n`);
    } else if (b.kind === 'bullets') {
      b.items.forEach((item) => lines.push(`- ${item}`));
      lines.push('');
    } else if (b.kind === 'numbered') {
      b.items.forEach((item, idx) => lines.push(`${idx + 1}. ${item}`));
      lines.push('');
    } else if (b.kind === 'callout') {
      lines.push(`> **${b.title}:** ${b.text}\n`);
    } else if (b.kind === 'table') {
      lines.push(`**Table ${b.tableNumber}: ${b.caption}**\n`);
      lines.push(`| ${b.headers.map((h) => h.replace(/\|/g, '\\|')).join(' | ')} |`);
      lines.push(`| ${b.headers.map(() => '---').join(' | ')} |`);
      for (const r of b.rows) {
        lines.push(`| ${r.map((c) => c.replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`);
      }
      lines.push('');
    } else if (b.kind === 'figure') {
      const rel = b.imagePath.replace(/^docs\/reports\//, './');
      lines.push(`![Figure ${b.figureNumber}: ${b.caption}](${rel})`);
      lines.push(`*Figure ${b.figureNumber}: ${b.caption}${b.sourceNote ? ` (${b.sourceNote})` : ''}*\n`);
    } else if (b.kind === 'code') {
      lines.push(`**${b.title}** (\`${b.filePath}\`)\n`);
      lines.push(`\`\`\`${b.language}`);
      lines.push(b.code);
      lines.push('```\n');
    }
  };

  for (const ch of docModel.chapters) {
    const headingPrefix = ch.isAppendix ? `${ch.number} — ${ch.title}` : `${ch.number}. ${ch.title}`;
    lines.push(`# ${headingPrefix}\n`);
    (ch.blocks || []).forEach(renderBlockMd);
    for (const sec of ch.sections) {
      lines.push(`## ${sec.number} ${sec.title}\n`);
      sec.blocks.forEach(renderBlockMd);
      for (const sub of sec.subsections || []) {
        lines.push(`### ${sub.number} ${sub.title}\n`);
        sub.blocks.forEach(renderBlockMd);
      }
    }
    lines.push('---\n');
  }

  return lines.join('\n');
}

async function renderPdfPass(
  docModel: ReportDocumentModel,
  knownIndex: LayoutIndex | null,
  outputPath: string | null
): Promise<LayoutIndex> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN_T, bottom: PDFKIT_MARGIN_B, left: MARGIN_L, right: MARGIN_R },
      bufferPages: true,
      autoFirstPage: false,
      font: HAS_TTF ? TTF_PATHS.sans : 'Helvetica',
      info: {
        Title: 'FORTIX — API Security & Resilience Verification Platform (B.Tech IT Project Report)',
        Author: 'FortiX Engineering Team',
        Subject: 'B.Tech Information Technology Final Year Software Project Report',
        Keywords: docModel.preliminary.keywords.join(', '),
      },
    });

    if (HAS_TTF) {
      doc.registerFont(FONTS.sans, TTF_PATHS.sans);
      doc.registerFont(FONTS.bold, TTF_PATHS.bold);
      doc.registerFont(FONTS.italic, TTF_PATHS.italic);
      doc.registerFont(FONTS.mono, TTF_PATHS.mono);
      doc.registerFont(FONTS.monoBold, TTF_PATHS.monoBold);
    }

    const outStream = outputPath ? fs.createWriteStream(outputPath) : null;
    if (outStream) {
      doc.pipe(outStream);
    } else {
      doc.on('data', () => {});
    }

    const recordedToc: TocEntry[] = [];
    const recordedFigures: IndexedCaption[] = [];
    const recordedTables: IndexedCaption[] = [];
    const pageHeaders: string[] = [];
    let currentPage = 0;
    let currentHeaderLabel = 'PRELIMINARY PAGES';

    doc.on('pageAdded', () => {
      currentPage += 1;
      pageHeaders[currentPage - 1] = currentHeaderLabel;
      doc.y = MARGIN_T;
    });

    const addNewPage = (headerLabel?: string) => {
      if (headerLabel) currentHeaderLabel = headerLabel;
      doc.addPage();
    };

    const ensureSpace = (neededHeight: number) => {
      if (doc.y + neededHeight > MAX_Y) {
        addNewPage();
      }
    };

    const m = docModel.metadata;

    // ==================== PAGE 1: FORMAL UNIVERSITY TITLE PAGE ====================
    addNewPage('TITLE PAGE');
    doc.save();
    doc.rect(0, 0, PAGE_W, 196).fill(COLORS.navy);
    doc.rect(0, 196, PAGE_W, 5).fill(COLORS.accent);

    doc.fillColor('#F97316').font(FONTS.bold).fontSize(10).text(
      'BACHELOR OF TECHNOLOGY IN INFORMATION TECHNOLOGY — MAJOR PROJECT REPORT',
      MARGIN_L,
      44,
      { width: CONTENT_W, align: 'center' }
    );
    doc.fillColor('#FFFFFF').font(FONTS.bold).fontSize(29).text(
      m.projectTitle,
      MARGIN_L,
      72,
      { width: CONTENT_W, align: 'center' }
    );
    doc.fillColor('#E2E8F0').font(FONTS.bold).fontSize(14.5).text(
      m.projectSubtitle,
      MARGIN_L,
      114,
      { width: CONTENT_W, align: 'center' }
    );
    doc.fillColor('#94A3B8').font(FONTS.monoBold).fontSize(10).text(
      `CORE VERIFICATION LIFECYCLE: ${m.corePrinciple}`,
      MARGIN_L,
      152,
      { width: CONTENT_W, align: 'center' }
    );
    doc.restore();

    doc.y = 228;
    doc.fillColor(COLORS.muted).font(FONTS.sans).fontSize(10.5).text(
      'A Comprehensive Software Engineering Project Report Submitted in Partial Fulfillment\nof the Requirements for the Award of the Degree of',
      MARGIN_L,
      doc.y,
      { width: CONTENT_W, align: 'center', lineGap: 3.5 }
    );
    doc.moveDown(0.65);
    doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(13.5).text(
      m.degreeProgram,
      MARGIN_L,
      doc.y,
      { width: CONTENT_W, align: 'center' }
    );

    doc.moveDown(1.3);
    const boxY = doc.y;
    doc.save();
    doc.roundedRect(MARGIN_L + 35, boxY, CONTENT_W - 70, 132, 6).fillAndStroke(COLORS.lightBg, COLORS.border);
    doc.restore();
    doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(10).text(
      'SUBMITTED BY',
      MARGIN_L + 50,
      boxY + 13,
      { width: CONTENT_W - 100, align: 'center' }
    );
    let sy = boxY + 37;
    for (const st of m.studentsPlaceholder) {
      doc.fillColor(COLORS.body).font(FONTS.bold).fontSize(10.5).text(
        `${st.name}   —   ${st.rollNo}`,
        MARGIN_L + 50,
        sy,
        { width: CONTENT_W - 100, align: 'center' }
      );
      sy += 25;
    }

    doc.y = boxY + 152;
    doc.fillColor(COLORS.muted).font(FONTS.bold).fontSize(9.8).text(
      'UNDER THE SUPERVISION OF',
      MARGIN_L,
      doc.y,
      { width: CONTENT_W, align: 'center' }
    );
    doc.moveDown(0.35);
    doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(11.5).text(
      m.guidePlaceholder,
      MARGIN_L,
      doc.y,
      { width: CONTENT_W, align: 'center' }
    );

    doc.moveDown(1.5);
    doc.moveTo(MARGIN_L + 90, doc.y).lineTo(PAGE_W - MARGIN_R - 90, doc.y).strokeColor(COLORS.border).lineWidth(1).stroke();
    doc.moveDown(0.95);
    doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(12).text(
      m.departmentPlaceholder.toUpperCase(),
      MARGIN_L,
      doc.y,
      { width: CONTENT_W, align: 'center' }
    );
    doc.moveDown(0.3);
    doc.fillColor(COLORS.slateDark).font(FONTS.bold).fontSize(11.5).text(
      m.institutionPlaceholder,
      MARGIN_L,
      doc.y,
      { width: CONTENT_W, align: 'center' }
    );
    doc.moveDown(0.25);
    doc.fillColor(COLORS.muted).font(FONTS.sans).fontSize(10.5).text(
      m.universityPlaceholder,
      MARGIN_L,
      doc.y,
      { width: CONTENT_W, align: 'center' }
    );
    doc.moveDown(0.5);
    doc.fillColor(COLORS.accent).font(FONTS.bold).fontSize(10.5).text(
      m.academicYearPlaceholder,
      MARGIN_L,
      doc.y,
      { width: CONTENT_W, align: 'center' }
    );

    // Helper for Preliminary Formal Headings
    const renderPrelimHeading = (title: string) => {
      doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(15).text(title, MARGIN_L, doc.y, {
        width: CONTENT_W,
        align: 'left',
      });
      doc.moveDown(0.2);
      doc.moveTo(MARGIN_L, doc.y).lineTo(PAGE_W - MARGIN_R, doc.y).strokeColor(COLORS.accent).lineWidth(1.6).stroke();
      doc.moveDown(0.75);
    };

    // ==================== PAGE 2: CERTIFICATE & CANDIDATE DECLARATION ====================
    addNewPage('PRELIMINARY — CERTIFICATE & DECLARATION');
    recordedToc.push({ level: 1, label: 'Certificate & Candidate Declaration', page: currentPage });
    renderPrelimHeading('CERTIFICATE');
    for (const p of docModel.preliminary.certificateText) {
      doc.fillColor(COLORS.body).font(FONTS.sans).fontSize(10).text(p, MARGIN_L, doc.y, {
        width: CONTENT_W,
        align: 'justify',
        lineGap: 3,
      });
      doc.moveDown(0.6);
    }
    doc.moveDown(1.1);
    const sigY = doc.y;
    doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(9.6).text(
      `_____________________________\n${m.guidePlaceholder}\nProject Supervisor`,
      MARGIN_L,
      sigY,
      { width: 220 }
    );
    doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(9.6).text(
      `_____________________________\n${m.hodPlaceholder}\nHead of Department`,
      PAGE_W - MARGIN_R - 220,
      sigY,
      { width: 220, align: 'right' }
    );
    doc.y = sigY + 62;
    doc.moveDown(0.9);

    renderPrelimHeading('CANDIDATE DECLARATION');
    for (const p of docModel.preliminary.declarationText) {
      doc.fillColor(COLORS.body).font(FONTS.sans).fontSize(10).text(p, MARGIN_L, doc.y, {
        width: CONTENT_W,
        align: 'justify',
        lineGap: 3,
      });
      doc.moveDown(0.6);
    }
    doc.moveDown(0.5);
    for (const st of m.studentsPlaceholder) {
      doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(9.6).text(
        `${st.name} (${st.rollNo})   —   Signature: ______________________`,
        MARGIN_L,
        doc.y,
        { width: CONTENT_W }
      );
      doc.moveDown(0.45);
    }

    // ==================== PAGE 3: ACKNOWLEDGEMENT ====================
    addNewPage('PRELIMINARY — ACKNOWLEDGEMENT');
    recordedToc.push({ level: 1, label: 'Acknowledgement', page: currentPage });
    renderPrelimHeading('ACKNOWLEDGEMENT');
    for (const p of docModel.preliminary.acknowledgementText) {
      doc.fillColor(COLORS.body).font(FONTS.sans).fontSize(10.2).text(p, MARGIN_L, doc.y, {
        width: CONTENT_W,
        align: 'justify',
        lineGap: 3.5,
      });
      doc.moveDown(0.75);
    }

    // ==================== PAGE 4: ABSTRACT ====================
    addNewPage('PRELIMINARY — ABSTRACT');
    recordedToc.push({ level: 1, label: 'Abstract', page: currentPage });
    renderPrelimHeading('ABSTRACT');
    for (const p of docModel.preliminary.abstractParagraphs) {
      doc.fillColor(COLORS.body).font(FONTS.sans).fontSize(10).text(p, MARGIN_L, doc.y, {
        width: CONTENT_W,
        align: 'justify',
        lineGap: 3.2,
      });
      doc.moveDown(0.65);
    }
    doc.moveDown(0.4);
    doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(9.6).text(
      `Keywords: ${docModel.preliminary.keywords.join(' · ')}`,
      MARGIN_L,
      doc.y,
      { width: CONTENT_W, lineGap: 2.5 }
    );

    // ==================== TABLE OF CONTENTS ====================
    addNewPage('TABLE OF CONTENTS');
    recordedToc.push({ level: 1, label: 'Table of Contents', page: currentPage });
    renderPrelimHeading('TABLE OF CONTENTS');
    const tocSource = knownIndex ? knownIndex.toc : [
      { level: 1 as const, label: '1. ABOUT THE SYSTEM', page: 10 },
      { level: 1 as const, label: '2. SYSTEM DESIGN USING UML', page: 20 },
      { level: 1 as const, label: '3. DATA DICTIONARY', page: 36 },
      { level: 1 as const, label: '4. IMPLEMENTATION', page: 48 },
      { level: 1 as const, label: '5. CONCLUSION', page: 64 },
      { level: 1 as const, label: '6. REFERENCES', page: 66 },
    ];
    for (const item of tocSource) {
      const indent = item.level === 1 ? 0 : item.level === 2 ? 16 : 32;
      const font = item.level === 1 ? FONTS.bold : FONTS.sans;
      const fontSize = item.level === 1 ? 9.6 : 8.9;
      doc.font(font).fontSize(fontSize);
      const labelW = CONTENT_W - indent - 45;
      const h = doc.heightOfString(item.label, { width: labelW });
      ensureSpace(h + 6);
      const rowY = doc.y;
      doc.fillColor(item.level === 1 ? COLORS.navy : COLORS.body).font(font).fontSize(fontSize).text(
        item.label,
        MARGIN_L + indent,
        rowY,
        { width: labelW }
      );
      const nextY = doc.y;
      doc.fillColor(COLORS.navy).font(font).fontSize(fontSize).text(
        String(item.page),
        PAGE_W - MARGIN_R - 40,
        rowY,
        { width: 40, align: 'right', lineBreak: false }
      );
      doc.y = Math.max(nextY, rowY + (item.level === 1 ? 15.5 : 13.5)) + 2.5;
    }

    // ==================== LIST OF FIGURES ====================
    addNewPage('LIST OF FIGURES');
    recordedToc.push({ level: 1, label: 'List of Figures', page: currentPage });
    renderPrelimHeading('LIST OF FIGURES');
    const figSource = knownIndex ? knownIndex.figures : Array.from({ length: 32 }, (_, i) => ({
      num: `${i + 1}`,
      caption: 'Placeholder layout reservation for engineering diagram or live UI screenshot',
      page: 10 + i,
    }));
    for (const f of figSource) {
      doc.font(FONTS.sans).fontSize(9.0);
      const labelText = `Figure ${f.num}: ${f.caption}`;
      const h = doc.heightOfString(labelText, { width: CONTENT_W - 44 });
      ensureSpace(h + 6);
      const rowY = doc.y;
      doc.fillColor(COLORS.body).font(FONTS.sans).fontSize(9.0).text(
        labelText,
        MARGIN_L,
        rowY,
        { width: CONTENT_W - 44 }
      );
      const nextY = doc.y;
      doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(9.0).text(
        String(f.page),
        PAGE_W - MARGIN_R - 36,
        rowY,
        { width: 36, align: 'right', lineBreak: false }
      );
      doc.y = Math.max(nextY, rowY + 14) + 3;
    }

    // ==================== LIST OF TABLES ====================
    addNewPage('LIST OF TABLES');
    recordedToc.push({ level: 1, label: 'List of Tables', page: currentPage });
    renderPrelimHeading('LIST OF TABLES');
    const tblSource = knownIndex ? knownIndex.tables : Array.from({ length: 43 }, (_, i) => ({
      num: `${i + 1}`,
      caption: 'Placeholder layout reservation for schema data dictionary or verification matrix',
      page: 12 + i,
    }));
    for (const t of tblSource) {
      doc.font(FONTS.sans).fontSize(8.9);
      const labelText = `Table ${t.num}: ${t.caption}`;
      const h = doc.heightOfString(labelText, { width: CONTENT_W - 44 });
      ensureSpace(h + 6);
      const rowY = doc.y;
      doc.fillColor(COLORS.body).font(FONTS.sans).fontSize(8.9).text(
        labelText,
        MARGIN_L,
        rowY,
        { width: CONTENT_W - 44 }
      );
      const nextY = doc.y;
      doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(8.9).text(
        String(t.page),
        PAGE_W - MARGIN_R - 36,
        rowY,
        { width: 36, align: 'right', lineBreak: false }
      );
      doc.y = Math.max(nextY, rowY + 13) + 2.5;
    }

    // ==================== LIST OF ABBREVIATIONS ====================
    addNewPage('LIST OF ABBREVIATIONS');
    recordedToc.push({ level: 1, label: 'List of Abbreviations', page: currentPage });
    renderPrelimHeading('LIST OF ABBREVIATIONS');

    const renderTableBlock = (
      tableNumber: string | null,
      caption: string | null,
      headers: string[],
      rows: string[][],
      colWeights?: number[]
    ) => {
      if (tableNumber && caption) {
        ensureSpace(64);
        recordedTables.push({ num: tableNumber, caption, page: currentPage });
        doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(9.4).text(
          `Table ${tableNumber}: ${caption}`,
          MARGIN_L,
          doc.y,
          { width: CONTENT_W }
        );
        doc.moveDown(0.3);
      }

      const weights =
        colWeights && colWeights.length === headers.length
          ? colWeights
          : headers.map(() => 100 / headers.length);
      const totalWeight = weights.reduce((acc, v) => acc + v, 0);
      const colWidths = weights.map((w) => (w / totalWeight) * CONTENT_W);

      const calcHeaderHeight = () => {
        let maxH = 20;
        headers.forEach((h, idx) => {
          doc.font(FONTS.bold).fontSize(8.3);
          const hHeight = doc.heightOfString(h, { width: colWidths[idx] - 10 }) + 10;
          if (hHeight > maxH) maxH = hHeight;
        });
        return maxH;
      };

      const drawHeaderRow = () => {
        const maxH = calcHeaderHeight();
        const y0 = doc.y;
        doc.save();
        doc.rect(MARGIN_L, y0, CONTENT_W, maxH).fill(COLORS.navy);
        doc.restore();
        let x = MARGIN_L;
        headers.forEach((h, idx) => {
          doc.fillColor('#FFFFFF').font(FONTS.bold).fontSize(8.3).text(
            h,
            x + 5,
            y0 + 5,
            { width: colWidths[idx] - 10, align: 'left' }
          );
          x += colWidths[idx];
        });
        doc.y = y0 + maxH;
      };

      const firstRowH = (() => {
        if (rows.length === 0) return 20;
        let rh = 18;
        rows[0].forEach((cell, cIdx) => {
          doc.font(cIdx === 0 ? FONTS.bold : FONTS.sans).fontSize(8.1);
          const ch = doc.heightOfString(cell || '', { width: colWidths[cIdx] - 10, lineGap: 1.4 }) + 9;
          if (ch > rh) rh = ch;
        });
        return rh;
      })();

      if (doc.y + calcHeaderHeight() + firstRowH > MAX_Y) {
        addNewPage();
      }
      drawHeaderRow();

      rows.forEach((row, rIdx) => {
        let rowH = 18;
        row.forEach((cell, cIdx) => {
          doc.font(cIdx === 0 ? FONTS.bold : FONTS.sans).fontSize(8.1);
          const ch = doc.heightOfString(cell || '', { width: colWidths[cIdx] - 10, lineGap: 1.4 }) + 9;
          if (ch > rowH) rowH = ch;
        });

        if (doc.y + rowH > MAX_Y) {
          addNewPage();
          drawHeaderRow();
        }

        const y0 = doc.y;
        doc.save();
        doc.rect(MARGIN_L, y0, CONTENT_W, rowH).fillAndStroke(
          rIdx % 2 === 0 ? '#FFFFFF' : COLORS.altRow,
          COLORS.border
        );
        doc.restore();

        let x = MARGIN_L;
        row.forEach((cell, cIdx) => {
          if (cIdx > 0) {
            doc.save();
            doc.moveTo(x, y0).lineTo(x, y0 + rowH).strokeColor(COLORS.border).lineWidth(0.5).stroke();
            doc.restore();
          }
          doc.fillColor(cIdx === 0 ? COLORS.navy : COLORS.body)
            .font(cIdx === 0 ? FONTS.bold : FONTS.sans)
            .fontSize(8.1)
            .text(cell || '', x + 5, y0 + 4.5, {
              width: colWidths[cIdx] - 10,
              align: 'left',
              lineGap: 1.4,
            });
          x += colWidths[cIdx];
        });
        doc.y = y0 + rowH;
      });
      doc.y = Math.min(doc.y + 9, MAX_Y);
    };

    renderTableBlock(
      null,
      null,
      ['Abbreviation', 'Full Technical Term', 'Operational Context in FortiX'],
      docModel.abbreviations.map((a) => [a.abbr, a.full, a.context]),
      [16, 36, 48]
    );

    // Block Renderer for Chapters & Appendices
    const renderBlock = (b: ReportBlock) => {
      if (b.kind === 'p') {
        doc.font(FONTS.sans).fontSize(9.8);
        const h = doc.heightOfString(b.text, { width: CONTENT_W, align: 'justify', lineGap: 2.8 });
        if (h <= MAX_Y - MARGIN_T) {
          ensureSpace(h + 4);
        } else {
          ensureSpace(40);
        }
        doc.fillColor(COLORS.body).font(FONTS.sans).fontSize(9.8).text(b.text, MARGIN_L, doc.y, {
          width: CONTENT_W,
          align: 'justify',
          lineGap: 2.8,
        });
        doc.y = Math.min(doc.y + 7, MAX_Y);
      } else if (b.kind === 'bullets') {
        for (const item of b.items) {
          doc.font(FONTS.sans).fontSize(9.5);
          const h = doc.heightOfString(item, { width: CONTENT_W - 16, align: 'justify', lineGap: 2.3 });
          ensureSpace(Math.min(h + 6, MAX_Y - MARGIN_T));
          const y0 = doc.y;
          doc.fillColor(COLORS.accent).font(FONTS.bold).fontSize(9.8).text('•', MARGIN_L + 4, y0, { lineBreak: false });
          doc.fillColor(COLORS.body).font(FONTS.sans).fontSize(9.5).text(item, MARGIN_L + 16, y0, {
            width: CONTENT_W - 16,
            align: 'justify',
            lineGap: 2.3,
          });
          doc.y = Math.min(doc.y + 5, MAX_Y);
        }
        doc.y = Math.min(doc.y + 3, MAX_Y);
      } else if (b.kind === 'numbered') {
        b.items.forEach((item, idx) => {
          doc.font(FONTS.sans).fontSize(9.4);
          const h = doc.heightOfString(item, { width: CONTENT_W - 26, align: 'justify', lineGap: 2.2 });
          ensureSpace(Math.min(h + 6, MAX_Y - MARGIN_T));
          const y0 = doc.y;
          doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(9.4).text(
            `[${idx + 1}]`,
            MARGIN_L,
            y0,
            { width: 24, lineBreak: false }
          );
          doc.fillColor(COLORS.body).font(FONTS.sans).fontSize(9.4).text(item, MARGIN_L + 26, y0, {
            width: CONTENT_W - 26,
            align: 'justify',
            lineGap: 2.2,
          });
          doc.y = Math.min(doc.y + 5, MAX_Y);
        });
        doc.y = Math.min(doc.y + 3, MAX_Y);
      } else if (b.kind === 'callout') {
        doc.font(FONTS.bold).fontSize(9.5);
        const titleH = doc.heightOfString(b.title, { width: CONTENT_W - 26 });
        doc.font(FONTS.sans).fontSize(9.3);
        const textH = doc.heightOfString(b.text, { width: CONTENT_W - 28, lineGap: 2.3 });
        const boxH = titleH + textH + 22;
        ensureSpace(boxH + 10);
        const y0 = doc.y;
        doc.save();
        doc.roundedRect(MARGIN_L, y0, CONTENT_W, boxH, 5).fillAndStroke(COLORS.calloutBg, COLORS.blue);
        doc.rect(MARGIN_L, y0, 4, boxH).fill(COLORS.blue);
        doc.restore();
        doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(9.5).text(
          b.title,
          MARGIN_L + 14,
          y0 + 7,
          { width: CONTENT_W - 26 }
        );
        doc.fillColor(COLORS.body).font(FONTS.sans).fontSize(9.3).text(
          b.text,
          MARGIN_L + 14,
          y0 + 9 + titleH,
          { width: CONTENT_W - 28, lineGap: 2.3 }
        );
        doc.y = Math.min(y0 + boxH + 9, MAX_Y);
      } else if (b.kind === 'table') {
        renderTableBlock(b.tableNumber, b.caption, b.headers, b.rows, b.colWidths);
      } else if (b.kind === 'figure') {
        const absImg = path.join(ROOT_DIR, b.imagePath);
        if (fs.existsSync(absImg)) {
          const dims = readPngDimensions(absImg);
          const maxImgW = CONTENT_W - 8;
          const maxImgH = 310;
          const scale = Math.min(maxImgW / dims.width, maxImgH / dims.height);
          const drawW = Math.round(dims.width * scale);
          const drawH = Math.round(dims.height * scale);

          doc.font(FONTS.bold).fontSize(9.0);
          const capText = `Figure ${b.figureNumber}: ${b.caption}`;
          const capH = doc.heightOfString(capText, { width: CONTENT_W });
          let noteH = 0;
          if (b.sourceNote) {
            doc.font(FONTS.italic).fontSize(8.0);
            noteH = doc.heightOfString(b.sourceNote, { width: CONTENT_W }) + 3;
          }
          ensureSpace(drawH + capH + noteH + 22);

          recordedFigures.push({ num: b.figureNumber, caption: b.caption, page: currentPage });
          const imgX = MARGIN_L + Math.round((CONTENT_W - drawW) / 2);
          const imgY = doc.y;
          doc.save();
          doc.roundedRect(imgX - 3, imgY - 3, drawW + 6, drawH + 6, 4).strokeColor(COLORS.border).lineWidth(0.8).stroke();
          doc.restore();
          doc.image(absImg, imgX, imgY, { width: drawW, height: drawH });
          doc.y = imgY + drawH + 7;

          doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(9.0).text(
            capText,
            MARGIN_L,
            doc.y,
            { width: CONTENT_W, align: 'center' }
          );
          if (b.sourceNote) {
            doc.fillColor(COLORS.muted).font(FONTS.italic).fontSize(8.0).text(
              b.sourceNote,
              MARGIN_L,
              doc.y + 1,
              { width: CONTENT_W, align: 'center' }
            );
          }
          doc.y = Math.min(doc.y + 10, MAX_Y);
        }
      } else if (b.kind === 'code') {
        const rawLines = b.code.split('\n');
        let lineIdx = 0;
        let isContinuation = false;

        while (lineIdx < rawLines.length) {
          if (doc.y + 68 > MAX_Y) {
            addNewPage();
          }
          const availBodyH = MAX_Y - doc.y - 36;
          const chunkLines: string[] = [];
          doc.font(FONTS.mono).fontSize(7.8);
          while (lineIdx < rawLines.length) {
            const candidate = [...chunkLines, rawLines[lineIdx]].join('\n');
            const candidateH = doc.heightOfString(candidate, { width: CONTENT_W - 20, lineGap: 1.4 });
            if (chunkLines.length > 0 && candidateH > availBodyH) {
              break;
            }
            chunkLines.push(rawLines[lineIdx]);
            lineIdx += 1;
          }

          const chunkText = chunkLines.join('\n');
          doc.font(FONTS.mono).fontSize(7.8);
          const codeH = doc.heightOfString(chunkText, { width: CONTENT_W - 20, lineGap: 1.4 });

          const y0 = doc.y;
          doc.save();
          doc.roundedRect(MARGIN_L, y0, CONTENT_W, 20, 4).fill(COLORS.navy);
          doc.restore();
          const hdrTitle = isContinuation
            ? `${b.title} (continued)  —  ${b.filePath}`
            : `${b.title}  —  ${b.filePath}`;
          doc.fillColor('#F8FAFC').font(FONTS.bold).fontSize(8.2).text(
            hdrTitle,
            MARGIN_L + 8,
            y0 + 5,
            { width: CONTENT_W - 16, lineBreak: false, ellipsis: true }
          );
          const bodyY = y0 + 20;
          doc.save();
          doc.rect(MARGIN_L, bodyY, CONTENT_W, codeH + 14).fillAndStroke(COLORS.lightBg, COLORS.border);
          doc.restore();
          doc.fillColor('#0F172A').font(FONTS.mono).fontSize(7.8).text(
            chunkText,
            MARGIN_L + 10,
            bodyY + 7,
            { width: CONTENT_W - 20, lineGap: 1.4 }
          );
          doc.y = Math.min(bodyY + codeH + 22, MAX_Y);
          isContinuation = true;
          if (lineIdx < rawLines.length) {
            addNewPage();
          }
        }
      }
    };

    // ==================== CHAPTERS 1–6 & APPENDICES A–F ====================
    for (const ch of docModel.chapters) {
      const chDisplay = ch.isAppendix
        ? `${ch.number.toUpperCase()} — ${ch.title}`
        : `${ch.number}. ${ch.title}`;
      addNewPage(chDisplay);
      recordedToc.push({ level: 1, label: chDisplay, page: currentPage });

      // Chapter Banner
      const bannerY = doc.y;
      doc.save();
      doc.roundedRect(MARGIN_L, bannerY, CONTENT_W, 52, 6).fill(COLORS.navy);
      doc.rect(MARGIN_L, bannerY + 48, CONTENT_W, 4).fill(COLORS.accent);
      doc.restore();
      doc.fillColor('#F97316').font(FONTS.bold).fontSize(8.8).text(
        ch.chapterLabel,
        MARGIN_L + 14,
        bannerY + 9,
        { width: CONTENT_W - 28, lineBreak: false }
      );
      doc.fillColor('#FFFFFF').font(FONTS.bold).fontSize(14.5).text(
        ch.isAppendix ? `${ch.number}: ${ch.title}` : `${ch.number}. ${ch.title}`,
        MARGIN_L + 14,
        bannerY + 24,
        { width: CONTENT_W - 28, lineBreak: false, ellipsis: true }
      );
      doc.y = bannerY + 66;

      (ch.blocks || []).forEach(renderBlock);

      for (const sec of ch.sections) {
        ensureSpace(58);
        const secLabel = `${sec.number} ${sec.title}`;
        recordedToc.push({ level: 2, label: secLabel, page: currentPage });
        doc.y += 4;
        doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(12).text(
          secLabel,
          MARGIN_L,
          doc.y,
          { width: CONTENT_W }
        );
        doc.moveTo(MARGIN_L, doc.y + 2).lineTo(PAGE_W - MARGIN_R, doc.y + 2).strokeColor(COLORS.border).lineWidth(0.9).stroke();
        doc.y += 10;

        sec.blocks.forEach(renderBlock);

        for (const sub of sec.subsections || []) {
          ensureSpace(48);
          const subLabel = `${sub.number} ${sub.title}`;
          recordedToc.push({ level: 3, label: subLabel, page: currentPage });
          doc.y += 3;
          doc.fillColor(COLORS.slateDark).font(FONTS.bold).fontSize(10.4).text(
            subLabel,
            MARGIN_L,
            doc.y,
            { width: CONTENT_W }
          );
          doc.y += 5;
          sub.blocks.forEach(renderBlock);
        }
      }
    }

    // Stamp Running Headers & Footers on pages 2..N without triggering PDFKit margin auto-pagination
    const range = doc.bufferedPageRange();
    const totalPages = range.count;
    for (let i = 1; i < totalPages; i++) {
      doc.switchToPage(i);
      const prevTop = doc.page.margins.top;
      const prevBottom = doc.page.margins.bottom;
      doc.page.margins.top = 0;
      doc.page.margins.bottom = 0;

      const hdr = pageHeaders[i] || 'FORTIX PROJECT REPORT';
      doc.save();
      // Header
      doc.fillColor(COLORS.muted).font(FONTS.bold).fontSize(7.6).text(
        'FORTIX — API Security & Resilience Verification Platform',
        MARGIN_L,
        28,
        { width: CONTENT_W * 0.58, lineBreak: false }
      );
      doc.fillColor(COLORS.navy).font(FONTS.sans).fontSize(7.6).text(
        hdr,
        MARGIN_L + CONTENT_W * 0.58,
        28,
        { width: CONTENT_W * 0.42, align: 'right', lineBreak: false, ellipsis: true }
      );
      doc.moveTo(MARGIN_L, 41).lineTo(PAGE_W - MARGIN_R, 41).strokeColor(COLORS.border).lineWidth(0.6).stroke();

      // Footer
      const footerY = PAGE_H - 36;
      doc.moveTo(MARGIN_L, footerY - 5).lineTo(PAGE_W - MARGIN_R, footerY - 5).strokeColor(COLORS.border).lineWidth(0.6).stroke();
      doc.fillColor(COLORS.muted).font(FONTS.sans).fontSize(7.8).text(
        'B.Tech. (Information Technology) Software Project Report',
        MARGIN_L,
        footerY,
        { width: CONTENT_W * 0.7, lineBreak: false }
      );
      doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(8.0).text(
        `Page ${i + 1} of ${totalPages}`,
        PAGE_W - MARGIN_R - 110,
        footerY,
        { width: 110, align: 'right', lineBreak: false }
      );
      doc.restore();

      doc.page.margins.top = prevTop;
      doc.page.margins.bottom = prevBottom;
    }

    doc.end();

    if (outStream) {
      outStream.on('finish', () =>
        resolve({ toc: recordedToc, figures: recordedFigures, tables: recordedTables, totalPages })
      );
      outStream.on('error', reject);
    } else {
      doc.on('end', () =>
        resolve({ toc: recordedToc, figures: recordedFigures, tables: recordedTables, totalPages })
      );
    }
  });
}

async function main() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });

  const chapters: ReportChapter[] = [
    ...CHAPTERS_PART1,
    ...CHAPTERS_PART2,
    ...CHAPTERS_PART3,
  ];

  const docModel: ReportDocumentModel = {
    metadata: REPORT_METADATA,
    abbreviations: REPORT_ABBREVIATIONS,
    preliminary: REPORT_PRELIMINARY,
    chapters,
  };

  fs.writeFileSync(AST_PATH, JSON.stringify(docModel, null, 2), 'utf8');
  console.log(`[Report] Wrote structured AST -> ${AST_PATH}`);

  const md = generateMarkdown(docModel);
  fs.writeFileSync(MD_PATH, md, 'utf8');
  console.log(`[Report] Wrote Markdown report -> ${MD_PATH} (${(md.length / 1024).toFixed(1)} KB)`);

  // Multi-pass PDF layout for exact TOC / List of Figures / List of Tables page numbers
  const pass1 = await renderPdfPass(docModel, null, null);
  const pass2 = await renderPdfPass(docModel, pass1, PDF_PATH);
  const finalIndex =
    pass2.totalPages !== pass1.totalPages
      ? await renderPdfPass(docModel, pass2, PDF_PATH)
      : pass2;

  // Persist final page index into AST for DOCX synchronization
  fs.writeFileSync(
    AST_PATH,
    JSON.stringify({ ...docModel, computedIndex: finalIndex }, null, 2),
    'utf8'
  );

  const stat = fs.statSync(PDF_PATH);
  console.log(
    `[Report] Generated ${PDF_PATH} — ${finalIndex.totalPages} pages, ${finalIndex.figures.length} figures, ${finalIndex.tables.length} tables (${(stat.size / (1024 * 1024)).toFixed(2)} MB)`
  );
}

main().catch((err) => {
  console.error('[generate-md-and-pdf] Fatal error:', err);
  process.exit(1);
});
