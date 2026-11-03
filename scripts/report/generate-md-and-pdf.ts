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
const MARGIN_B = 56;
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;
const MAX_Y = PAGE_H - MARGIN_B;

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
  // PNG IHDR chunk starts at byte 16: 4 bytes width, 4 bytes height (big-endian)
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
      margins: { top: MARGIN_T, bottom: MARGIN_B, left: MARGIN_L, right: MARGIN_R },
      bufferPages: true,
      autoFirstPage: false,
      info: {
        Title: 'FORTIX — API Security & Resilience Verification Platform (B.Tech IT Project Report)',
        Author: 'FortiX Engineering Team',
        Subject: 'B.Tech Information Technology Final Year Software Project Report',
        Keywords: docModel.preliminary.keywords.join(', '),
      },
    });

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

    const addNewPage = (headerLabel?: string) => {
      if (headerLabel) currentHeaderLabel = headerLabel;
      doc.addPage();
      currentPage += 1;
      pageHeaders[currentPage - 1] = currentHeaderLabel;
      doc.y = MARGIN_T;
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

    doc.fillColor('#F97316').font('Helvetica-Bold').fontSize(10.5).text(
      'BACHELOR OF TECHNOLOGY IN INFORMATION TECHNOLOGY — MAJOR PROJECT REPORT',
      MARGIN_L,
      46,
      { width: CONTENT_W, align: 'center' }
    );
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(30).text(
      m.projectTitle,
      MARGIN_L,
      74,
      { width: CONTENT_W, align: 'center' }
    );
    doc.fillColor('#E2E8F0').font('Helvetica-Bold').fontSize(15.5).text(
      m.projectSubtitle,
      MARGIN_L,
      114,
      { width: CONTENT_W, align: 'center' }
    );
    doc.fillColor('#94A3B8').font('Courier-Bold').fontSize(10.5).text(
      m.corePrinciple,
      MARGIN_L,
      148,
      { width: CONTENT_W, align: 'center' }
    );
    doc.restore();

    doc.y = 236;
    doc.fillColor(COLORS.slateDark).font('Helvetica').fontSize(11.5).text(
      'A Comprehensive Software Engineering Project Report Submitted in Partial Fulfillment of the Requirements for the Award of the Degree of',
      MARGIN_L,
      doc.y,
      { width: CONTENT_W, align: 'center', lineGap: 4 }
    );
    doc.moveDown(0.7);
    doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(14).text(
      m.degreeProgram,
      MARGIN_L,
      doc.y,
      { width: CONTENT_W, align: 'center' }
    );

    doc.moveDown(1.5);
    const boxY = doc.y;
    doc.save();
    doc.roundedRect(MARGIN_L + 35, boxY, CONTENT_W - 70, 132, 6).fillAndStroke(COLORS.lightBg, COLORS.border);
    doc.restore();
    doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(10.5).text(
      'SUBMITTED BY',
      MARGIN_L + 50,
      boxY + 14,
      { width: CONTENT_W - 100, align: 'center' }
    );
    let sy = boxY + 38;
    for (const st of m.studentsPlaceholder) {
      doc.fillColor(COLORS.body).font('Helvetica-Bold').fontSize(11).text(
        `${st.name}   —   ${st.rollNo}`,
        MARGIN_L + 50,
        sy,
        { width: CONTENT_W - 100, align: 'center' }
      );
      sy += 26;
    }

    doc.y = boxY + 156;
    doc.fillColor(COLORS.muted).font('Helvetica-Bold').fontSize(10).text(
      'UNDER THE SUPERVISION OF',
      MARGIN_L,
      doc.y,
      { width: CONTENT_W, align: 'center' }
    );
    doc.moveDown(0.35);
    doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(12).text(
      m.guidePlaceholder,
      MARGIN_L,
      doc.y,
      { width: CONTENT_W, align: 'center' }
    );

    doc.moveDown(1.8);
    doc.moveTo(MARGIN_L + 90, doc.y).lineTo(PAGE_W - MARGIN_R - 90, doc.y).strokeColor(COLORS.border).lineWidth(1).stroke();
    doc.moveDown(1.1);
    doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(12.5).text(
      m.departmentPlaceholder.toUpperCase(),
      MARGIN_L,
      doc.y,
      { width: CONTENT_W, align: 'center' }
    );
    doc.moveDown(0.35);
    doc.fillColor(COLORS.slateDark).font('Helvetica-Bold').fontSize(12).text(
      m.institutionPlaceholder,
      MARGIN_L,
      doc.y,
      { width: CONTENT_W, align: 'center' }
    );
    doc.moveDown(0.3);
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(11).text(
      m.universityPlaceholder,
      MARGIN_L,
      doc.y,
      { width: CONTENT_W, align: 'center' }
    );
    doc.moveDown(0.6);
    doc.fillColor(COLORS.accent).font('Helvetica-Bold').fontSize(11).text(
      m.academicYearPlaceholder,
      MARGIN_L,
      doc.y,
      { width: CONTENT_W, align: 'center' }
    );

    // Helper for Preliminary Formal Headings
    const renderPrelimHeading = (title: string) => {
      doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(16).text(title, MARGIN_L, doc.y, {
        width: CONTENT_W,
        align: 'left',
      });
      doc.moveDown(0.25);
      doc.moveTo(MARGIN_L, doc.y).lineTo(PAGE_W - MARGIN_R, doc.y).strokeColor(COLORS.accent).lineWidth(1.6).stroke();
      doc.moveDown(0.8);
    };

    // ==================== PAGE 2: CERTIFICATE & DECLARATION ====================
    addNewPage('PRELIMINARY — CERTIFICATE & DECLARATION');
    recordedToc.push({ level: 1, label: 'Certificate & Candidate Declaration', page: currentPage });
    renderPrelimHeading('CERTIFICATE');
    for (const p of docModel.preliminary.certificateText) {
      doc.fillColor(COLORS.body).font('Helvetica').fontSize(10.5).text(p, MARGIN_L, doc.y, {
        width: CONTENT_W,
        align: 'justify',
        lineGap: 3.5,
      });
      doc.moveDown(0.7);
    }
    doc.moveDown(1.4);
    const sigY = doc.y;
    doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(10).text(
      `_____________________________\n${m.guidePlaceholder}\nProject Supervisor`,
      MARGIN_L,
      sigY,
      { width: 220 }
    );
    doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(10).text(
      `_____________________________\n${m.hodPlaceholder}\nHead of Department`,
      PAGE_W - MARGIN_R - 220,
      sigY,
      { width: 220, align: 'right' }
    );
    doc.y = sigY + 66;
    doc.moveDown(1.0);

    renderPrelimHeading('CANDIDATE DECLARATION');
    for (const p of docModel.preliminary.declarationText) {
      doc.fillColor(COLORS.body).font('Helvetica').fontSize(10.5).text(p, MARGIN_L, doc.y, {
        width: CONTENT_W,
        align: 'justify',
        lineGap: 3.5,
      });
      doc.moveDown(0.7);
    }
    doc.moveDown(0.6);
    for (const st of m.studentsPlaceholder) {
      doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(10).text(
        `${st.name} (${st.rollNo})   —   Signature: ______________________`,
        MARGIN_L,
        doc.y,
        { width: CONTENT_W }
      );
      doc.moveDown(0.5);
    }

    // ==================== PAGE 3: ACKNOWLEDGEMENT & ABSTRACT ====================
    addNewPage('PRELIMINARY — ACKNOWLEDGEMENT & ABSTRACT');
    recordedToc.push({ level: 1, label: 'Acknowledgement & Abstract', page: currentPage });
    renderPrelimHeading('ACKNOWLEDGEMENT');
    for (const p of docModel.preliminary.acknowledgementText) {
      doc.fillColor(COLORS.body).font('Helvetica').fontSize(10.5).text(p, MARGIN_L, doc.y, {
        width: CONTENT_W,
        align: 'justify',
        lineGap: 3.2,
      });
      doc.moveDown(0.6);
    }
    doc.moveDown(0.8);

    renderPrelimHeading('ABSTRACT');
    for (const p of docModel.preliminary.abstractParagraphs) {
      doc.fillColor(COLORS.body).font('Helvetica').fontSize(10.2).text(p, MARGIN_L, doc.y, {
        width: CONTENT_W,
        align: 'justify',
        lineGap: 3,
      });
      doc.moveDown(0.55);
    }
    doc.moveDown(0.3);
    doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(9.8).text(
      `Keywords: ${docModel.preliminary.keywords.join(' · ')}`,
      MARGIN_L,
      doc.y,
      { width: CONTENT_W }
    );

    // ==================== TABLE OF CONTENTS ====================
    addNewPage('TABLE OF CONTENTS');
    recordedToc.push({ level: 1, label: 'Table of Contents', page: currentPage });
    renderPrelimHeading('TABLE OF CONTENTS');
    const tocSource = knownIndex ? knownIndex.toc : [
      { level: 1 as const, label: '1. ABOUT THE SYSTEM', page: 8 },
      { level: 1 as const, label: '2. SYSTEM DESIGN USING UML', page: 18 },
      { level: 1 as const, label: '3. DATA DICTIONARY', page: 34 },
      { level: 1 as const, label: '4. IMPLEMENTATION', page: 46 },
      { level: 1 as const, label: '5. CONCLUSION', page: 62 },
      { level: 1 as const, label: '6. REFERENCES', page: 64 },
    ];
    for (const item of tocSource) {
      ensureSpace(18);
      const indent = item.level === 1 ? 0 : item.level === 2 ? 16 : 32;
      const font = item.level === 1 ? 'Helvetica-Bold' : 'Helvetica';
      const fontSize = item.level === 1 ? 10.2 : 9.5;
      const rowY = doc.y;
      doc.fillColor(item.level === 1 ? COLORS.navy : COLORS.body).font(font).fontSize(fontSize).text(
        item.label,
        MARGIN_L + indent,
        rowY,
        { width: CONTENT_W - indent - 45, lineBreak: false, ellipsis: true }
      );
      doc.fillColor(COLORS.navy).font(font).fontSize(fontSize).text(
        String(item.page),
        PAGE_W - MARGIN_R - 40,
        rowY,
        { width: 40, align: 'right' }
      );
      doc.y = rowY + (item.level === 1 ? 16 : 14);
    }

    // ==================== LIST OF FIGURES ====================
    addNewPage('LIST OF FIGURES');
    recordedToc.push({ level: 1, label: 'List of Figures', page: currentPage });
    renderPrelimHeading('LIST OF FIGURES');
    const figSource = knownIndex ? knownIndex.figures : Array.from({ length: 26 }, (_, i) => ({
      num: `${i + 1}`,
      caption: 'Placeholder layout reservation',
      page: 10 + i,
    }));
    for (const f of figSource) {
      ensureSpace(24);
      const rowY = doc.y;
      doc.fillColor(COLORS.body).font('Helvetica').fontSize(9.3).text(
        `Figure ${f.num}: ${f.caption}`,
        MARGIN_L,
        rowY,
        { width: CONTENT_W - 42 }
      );
      const nextY = doc.y;
      doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(9.3).text(
        String(f.page),
        PAGE_W - MARGIN_R - 36,
        rowY,
        { width: 36, align: 'right' }
      );
      doc.y = Math.max(nextY, rowY + 14) + 3;
    }

    // ==================== LIST OF TABLES ====================
    addNewPage('LIST OF TABLES');
    recordedToc.push({ level: 1, label: 'List of Tables', page: currentPage });
    renderPrelimHeading('LIST OF TABLES');
    const tblSource = knownIndex ? knownIndex.tables : Array.from({ length: 38 }, (_, i) => ({
      num: `${i + 1}`,
      caption: 'Placeholder table layout reservation',
      page: 12 + i,
    }));
    for (const t of tblSource) {
      ensureSpace(22);
      const rowY = doc.y;
      doc.fillColor(COLORS.body).font('Helvetica').fontSize(9.2).text(
        `Table ${t.num}: ${t.caption}`,
        MARGIN_L,
        rowY,
        { width: CONTENT_W - 42 }
      );
      const nextY = doc.y;
      doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(9.2).text(
        String(t.page),
        PAGE_W - MARGIN_R - 36,
        rowY,
        { width: 36, align: 'right' }
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
        ensureSpace(58);
        recordedTables.push({ num: tableNumber, caption, page: currentPage });
        doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(9.6).text(
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

      const drawHeaderRow = () => {
        const y0 = doc.y;
        let maxH = 20;
        headers.forEach((h, idx) => {
          doc.font('Helvetica-Bold').fontSize(8.6);
          const hHeight = doc.heightOfString(h, { width: colWidths[idx] - 10 }) + 10;
          if (hHeight > maxH) maxH = hHeight;
        });
        doc.save();
        doc.rect(MARGIN_L, y0, CONTENT_W, maxH).fill(COLORS.navy);
        doc.restore();
        let x = MARGIN_L;
        headers.forEach((h, idx) => {
          doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8.6).text(
            h,
            x + 5,
            y0 + 5,
            { width: colWidths[idx] - 10, align: 'left' }
          );
          x += colWidths[idx];
        });
        doc.y = y0 + maxH;
      };

      drawHeaderRow();

      rows.forEach((row, rIdx) => {
        let rowH = 18;
        row.forEach((cell, cIdx) => {
          doc.font(cIdx === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.4);
          const ch = doc.heightOfString(cell || '', { width: colWidths[cIdx] - 10, lineGap: 1.5 }) + 9;
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
            .font(cIdx === 0 ? 'Helvetica-Bold' : 'Helvetica')
            .fontSize(8.4)
            .text(cell || '', x + 5, y0 + 4.5, {
              width: colWidths[cIdx] - 10,
              align: 'left',
              lineGap: 1.5,
            });
          x += colWidths[cIdx];
        });
        doc.y = y0 + rowH;
      });
      doc.moveDown(0.75);
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
        ensureSpace(34);
        doc.fillColor(COLORS.body).font('Helvetica').fontSize(10).text(b.text, MARGIN_L, doc.y, {
          width: CONTENT_W,
          align: 'justify',
          lineGap: 3,
        });
        doc.moveDown(0.55);
      } else if (b.kind === 'bullets') {
        for (const item of b.items) {
          ensureSpace(26);
          const y0 = doc.y;
          doc.fillColor(COLORS.accent).font('Helvetica-Bold').fontSize(10).text('•', MARGIN_L + 4, y0);
          doc.fillColor(COLORS.body).font('Helvetica').fontSize(9.8).text(item, MARGIN_L + 16, y0, {
            width: CONTENT_W - 16,
            align: 'justify',
            lineGap: 2.5,
          });
          doc.moveDown(0.38);
        }
        doc.moveDown(0.25);
      } else if (b.kind === 'numbered') {
        b.items.forEach((item, idx) => {
          ensureSpace(26);
          const y0 = doc.y;
          doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(9.6).text(
            `[${idx + 1}]`,
            MARGIN_L,
            y0,
            { width: 24 }
          );
          doc.fillColor(COLORS.body).font('Helvetica').fontSize(9.6).text(item, MARGIN_L + 26, y0, {
            width: CONTENT_W - 26,
            align: 'justify',
            lineGap: 2.4,
          });
          doc.moveDown(0.38);
        });
        doc.moveDown(0.25);
      } else if (b.kind === 'callout') {
        doc.font('Helvetica').fontSize(9.6);
        const textH = doc.heightOfString(b.text, { width: CONTENT_W - 28, lineGap: 2.5 });
        const boxH = textH + 34;
        ensureSpace(boxH + 10);
        const y0 = doc.y;
        doc.save();
        doc.roundedRect(MARGIN_L, y0, CONTENT_W, boxH, 5).fillAndStroke(COLORS.calloutBg, COLORS.blue);
        doc.rect(MARGIN_L, y0, 4, boxH).fill(COLORS.blue);
        doc.restore();
        doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(9.8).text(
          b.title,
          MARGIN_L + 14,
          y0 + 8,
          { width: CONTENT_W - 24 }
        );
        doc.fillColor(COLORS.body).font('Helvetica').fontSize(9.5).text(
          b.text,
          MARGIN_L + 14,
          y0 + 23,
          { width: CONTENT_W - 26, lineGap: 2.5 }
        );
        doc.y = y0 + boxH + 10;
      } else if (b.kind === 'table') {
        renderTableBlock(b.tableNumber, b.caption, b.headers, b.rows, b.colWidths);
      } else if (b.kind === 'figure') {
        const absImg = path.join(ROOT_DIR, b.imagePath);
        if (fs.existsSync(absImg)) {
          const dims = readPngDimensions(absImg);
          const maxImgW = CONTENT_W - 8;
          const maxImgH = 315;
          const scale = Math.min(maxImgW / dims.width, maxImgH / dims.height);
          const drawW = Math.round(dims.width * scale);
          const drawH = Math.round(dims.height * scale);

          doc.font('Helvetica-Bold').fontSize(9.3);
          const capH = doc.heightOfString(`Figure ${b.figureNumber}: ${b.caption}`, { width: CONTENT_W });
          const noteH = b.sourceNote ? 14 : 0;
          ensureSpace(drawH + capH + noteH + 26);

          recordedFigures.push({ num: b.figureNumber, caption: b.caption, page: currentPage });
          const imgX = MARGIN_L + Math.round((CONTENT_W - drawW) / 2);
          const imgY = doc.y;
          doc.save();
          doc.roundedRect(imgX - 3, imgY - 3, drawW + 6, drawH + 6, 4).strokeColor(COLORS.border).lineWidth(0.8).stroke();
          doc.restore();
          doc.image(absImg, imgX, imgY, { width: drawW, height: drawH });
          doc.y = imgY + drawH + 8;

          doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(9.2).text(
            `Figure ${b.figureNumber}: ${b.caption}`,
            MARGIN_L,
            doc.y,
            { width: CONTENT_W, align: 'center' }
          );
          if (b.sourceNote) {
            doc.fillColor(COLORS.muted).font('Helvetica-Oblique').fontSize(8.2).text(
              b.sourceNote,
              MARGIN_L,
              doc.y + 1,
              { width: CONTENT_W, align: 'center' }
            );
          }
          doc.moveDown(0.85);
        }
      } else if (b.kind === 'code') {
        doc.font('Courier').fontSize(8.1);
        const codeH = doc.heightOfString(b.code, { width: CONTENT_W - 20, lineGap: 1.6 });
        const totalBoxH = codeH + 34;
        ensureSpace(Math.min(totalBoxH + 12, MAX_Y - MARGIN_T - 20));

        const y0 = doc.y;
        doc.save();
        doc.roundedRect(MARGIN_L, y0, CONTENT_W, 20, 4).fill(COLORS.navy);
        doc.restore();
        doc.fillColor('#F8FAFC').font('Helvetica-Bold').fontSize(8.5).text(
          `${b.title}  —  ${b.filePath}`,
          MARGIN_L + 8,
          y0 + 5.5,
          { width: CONTENT_W - 16, lineBreak: false, ellipsis: true }
        );
        const bodyY = y0 + 20;
        doc.save();
        doc.rect(MARGIN_L, bodyY, CONTENT_W, codeH + 14).fillAndStroke(COLORS.lightBg, COLORS.border);
        doc.restore();
        doc.fillColor('#0F172A').font('Courier').fontSize(8.1).text(
          b.code,
          MARGIN_L + 10,
          bodyY + 7,
          { width: CONTENT_W - 20, lineGap: 1.6 }
        );
        doc.y = bodyY + codeH + 22;
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
      doc.fillColor('#F97316').font('Helvetica-Bold').fontSize(9).text(
        ch.chapterLabel,
        MARGIN_L + 14,
        bannerY + 10,
        { width: CONTENT_W - 28 }
      );
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(15).text(
        ch.isAppendix ? `${ch.number}: ${ch.title}` : `${ch.number}. ${ch.title}`,
        MARGIN_L + 14,
        bannerY + 24,
        { width: CONTENT_W - 28 }
      );
      doc.y = bannerY + 66;

      (ch.blocks || []).forEach(renderBlock);

      for (const sec of ch.sections) {
        ensureSpace(54);
        const secLabel = `${sec.number} ${sec.title}`;
        recordedToc.push({ level: 2, label: secLabel, page: currentPage });
        doc.moveDown(0.25);
        doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(12.5).text(
          secLabel,
          MARGIN_L,
          doc.y,
          { width: CONTENT_W }
        );
        doc.moveTo(MARGIN_L, doc.y + 2).lineTo(PAGE_W - MARGIN_R, doc.y + 2).strokeColor(COLORS.border).lineWidth(0.9).stroke();
        doc.y += 10;

        sec.blocks.forEach(renderBlock);

        for (const sub of sec.subsections || []) {
          ensureSpace(44);
          const subLabel = `${sub.number} ${sub.title}`;
          recordedToc.push({ level: 3, label: subLabel, page: currentPage });
          doc.moveDown(0.2);
          doc.fillColor(COLORS.slateDark).font('Helvetica-Bold').fontSize(10.8).text(
            subLabel,
            MARGIN_L,
            doc.y,
            { width: CONTENT_W }
          );
          doc.moveDown(0.35);
          sub.blocks.forEach(renderBlock);
        }
      }
    }

    // Stamp Running Headers & Footers on pages 2..N
    const range = doc.bufferedPageRange();
    const totalPages = range.count;
    for (let i = 1; i < totalPages; i++) {
      doc.switchToPage(i);
      const hdr = pageHeaders[i] || 'FORTIX PROJECT REPORT';
      doc.save();
      // Header
      doc.fillColor(COLORS.muted).font('Helvetica-Bold').fontSize(7.8).text(
        'FORTIX — API Security & Resilience Verification Platform',
        MARGIN_L,
        28,
        { width: CONTENT_W * 0.58, lineBreak: false }
      );
      doc.fillColor(COLORS.navy).font('Helvetica').fontSize(7.8).text(
        hdr,
        MARGIN_L + CONTENT_W * 0.58,
        28,
        { width: CONTENT_W * 0.42, align: 'right', lineBreak: false, ellipsis: true }
      );
      doc.moveTo(MARGIN_L, 41).lineTo(PAGE_W - MARGIN_R, 41).strokeColor(COLORS.border).lineWidth(0.6).stroke();

      // Footer
      const footerY = PAGE_H - 36;
      doc.moveTo(MARGIN_L, footerY - 5).lineTo(PAGE_W - MARGIN_R, footerY - 5).strokeColor(COLORS.border).lineWidth(0.6).stroke();
      doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8).text(
        'B.Tech. (Information Technology) Software Project Report',
        MARGIN_L,
        footerY,
        { width: CONTENT_W * 0.7, lineBreak: false }
      );
      doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(8.2).text(
        `Page ${i + 1} of ${totalPages}`,
        PAGE_W - MARGIN_R - 110,
        footerY,
        { width: 110, align: 'right', lineBreak: false }
      );
      doc.restore();
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

  // Two-pass PDF layout for exact TOC / List of Figures / List of Tables page numbers
  const pass1 = await renderPdfPass(docModel, null, null);
  const pass2 = await renderPdfPass(docModel, pass1, PDF_PATH);
  // If TOC expansion shifted page numbers by 1 page, run one final convergence pass!
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
