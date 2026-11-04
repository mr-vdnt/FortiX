#!/usr/bin/env python3
"""
Builds a standards-compliant, editable OpenXML (.docx) B.Tech IT Project Report
from docs/reports/report-ast.json, embedding all 32 rendered PNG diagrams and
redacted live UI screenshots, bordered tables, Consolas code blocks, headers,
dynamic PAGE/NUMPAGES footers, and Heading1..Heading3 outline styles.
Validates every XML member inside the archive before exiting.
"""

import json
import os
import struct
import zipfile
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

ROOT_DIR = os.getcwd()
AST_PATH = os.path.join(ROOT_DIR, "docs/reports/report-ast.json")
DOCX_PATH = os.path.join(ROOT_DIR, "docs/reports/FORTIX_BTECH_PROJECT_REPORT.docx")

# Maximum inline image dimensions in EMUs (1 inch = 914400 EMUs; ~6.15in wide max on A4)
MAX_IMG_W_EMU = int(6.10 * 914400)
MAX_IMG_H_EMU = int(4.15 * 914400)


def xml_safe(text: str) -> str:
    if text is None:
        return ""
    cleaned = "".join(
        ch for ch in str(text)
        if ch in ("\t", "\n", "\r") or (0x20 <= ord(ch) <= 0xD7FF) or (0xE000 <= ord(ch) <= 0xFFFD)
    )
    return escape(cleaned, {'"': "&quot;", "'": "&apos;"})


def png_dimensions(path: str):
    with open(path, "rb") as f:
        hdr = f.read(24)
    if len(hdr) >= 24 and hdr[:8] == b"\x89PNG\r\n\x1a\n":
        w, h = struct.unpack(">II", hdr[16:24])
        return max(1, w), max(1, h)
    return 1200, 750


def para(text: str, style: str = "Normal", bold: bool = False, italic: bool = False,
         color: str = None, align: str = None, space_before: int = None, space_after: int = None,
         page_break_before: bool = False) -> str:
    ppr = [f'<w:pStyle w:val="{style}"/>']
    if page_break_before:
        ppr.append("<w:pageBreakBefore/>")
    if align:
        ppr.append(f'<w:jc w:val="{align}"/>')
    if space_before is not None or space_after is not None:
        sb = f' w:before="{space_before}"' if space_before is not None else ""
        sa = f' w:after="{space_after}"' if space_after is not None else ""
        ppr.append(f"<w:spacing{sb}{sa}/>")

    rpr = []
    if bold:
        rpr.append("<w:b/>")
    if italic:
        rpr.append("<w:i/>")
    if color:
        rpr.append(f'<w:color w:val="{color}"/>')
    rpr_xml = f"<w:rPr>{''.join(rpr)}</w:rPr>" if rpr else ""

    lines = str(text or "").split("\n")
    runs = []
    for idx, ln in enumerate(lines):
        if idx > 0:
            runs.append("<w:r><w:br/></w:r>")
        runs.append(f'<w:r>{rpr_xml}<w:t xml:space="preserve">{xml_safe(ln)}</w:t></w:r>')

    return f"<w:p><w:pPr>{''.join(ppr)}</w:pPr>{''.join(runs)}</w:p>"


def page_break_xml() -> str:
    return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'


def build_table_xml(headers, rows, col_weights=None) -> str:
    total_dxa = 9360  # ~6.5 inches in twentieths of a point
    ncols = max(1, len(headers))
    if col_weights and len(col_weights) == ncols:
        tw = sum(col_weights) or 1
        widths = [int(round((w / tw) * total_dxa)) for w in col_weights]
    else:
        widths = [total_dxa // ncols] * ncols

    grid_cols = "".join(f'<w:gridCol w:w="{w}"/>' for w in widths)

    tbl_pr = """
    <w:tblPr>
      <w:tblW w:w="5000" w:type="pct"/>
      <w:tblBorders>
        <w:top w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>
        <w:left w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>
        <w:bottom w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>
        <w:right w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>
        <w:insideH w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>
        <w:insideV w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>
      </w:tblBorders>
      <w:tblCellMar>
        <w:top w:w="90" w:type="dxa"/>
        <w:left w:w="120" w:type="dxa"/>
        <w:bottom w:w="90" w:type="dxa"/>
        <w:right w:w="120" w:type="dxa"/>
      </w:tblCellMar>
    </w:tblPr>
    """

    # Header row
    h_cells = []
    for idx, h in enumerate(headers):
        h_cells.append(f"""
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="{widths[idx]}" w:type="dxa"/>
            <w:shd w:val="clear" w:color="auto" w:fill="0F172A"/>
          </w:tcPr>
          <w:p>
            <w:pPr><w:spacing w:before="20" w:after="20"/></w:pPr>
            <w:r>
              <w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>
              <w:t xml:space="preserve">{xml_safe(h)}</w:t>
            </w:r>
          </w:p>
        </w:tc>
        """)
    tr_list = [f"<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>{''.join(h_cells)}</w:tr>"]

    for r_idx, row in enumerate(rows):
        fill = "FFFFFF" if r_idx % 2 == 0 else "F8FAFC"
        c_xml = []
        for c_idx in range(ncols):
            val = row[c_idx] if c_idx < len(row) else ""
            bold_tag = "<w:b/>" if c_idx == 0 else ""
            col_color = "0F172A" if c_idx == 0 else "1F2937"
            c_xml.append(f"""
            <w:tc>
              <w:tcPr>
                <w:tcW w:w="{widths[c_idx]}" w:type="dxa"/>
                <w:shd w:val="clear" w:color="auto" w:fill="{fill}"/>
              </w:tcPr>
              <w:p>
                <w:pPr><w:spacing w:before="20" w:after="20"/></w:pPr>
                <w:r>
                  <w:rPr>{bold_tag}<w:color w:val="{col_color}"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>
                  <w:t xml:space="preserve">{xml_safe(val)}</w:t>
                </w:r>
              </w:p>
            </w:tc>
            """)
        tr_list.append(f"<w:tr><w:trPr><w:cantSplit/></w:trPr>{''.join(c_xml)}</w:tr>")

    return f"<w:tbl>{tbl_pr}<w:tblGrid>{grid_cols}</w:tblGrid>{''.join(tr_list)}</w:tbl>"


def build_code_block_xml(title: str, file_path: str, code: str) -> str:
    header_text = f"{title}  —  {file_path}"
    code_lines = str(code or "").split("\n")
    runs = []
    for i, ln in enumerate(code_lines):
        if i > 0:
            runs.append("<w:r><w:br/></w:r>")
        runs.append(
            f'<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>'
            f'<w:color w:val="0F172A"/><w:sz w:val="17"/><w:szCs w:val="17"/></w:rPr>'
            f'<w:t xml:space="preserve">{xml_safe(ln)}</w:t></w:r>'
        )
    return f"""
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="5000" w:type="pct"/>
        <w:tblBorders>
          <w:top w:val="single" w:sz="6" w:space="0" w:color="0F172A"/>
          <w:left w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>
          <w:bottom w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>
          <w:right w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>
          <w:insideH w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>
        </w:tblBorders>
        <w:tblCellMar>
          <w:top w:w="80" w:type="dxa"/><w:left w:w="140" w:type="dxa"/>
          <w:bottom w:w="80" w:type="dxa"/><w:right w:w="140" w:type="dxa"/>
        </w:tblCellMar>
      </w:tblPr>
      <w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid>
      <w:tr>
        <w:tc>
          <w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="0F172A"/></w:tcPr>
          <w:p>
            <w:pPr><w:spacing w:before="10" w:after="10"/></w:pPr>
            <w:r>
              <w:rPr><w:b/><w:color w:val="F8FAFC"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>
              <w:t xml:space="preserve">{xml_safe(header_text)}</w:t>
            </w:r>
          </w:p>
        </w:tc>
      </w:tr>
      <w:tr>
        <w:tc>
          <w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="F8FAFC"/></w:tcPr>
          <w:p>
            <w:pPr><w:spacing w:before="40" w:after="40" w:line="240" w:lineRule="auto"/></w:pPr>
            {''.join(runs)}
          </w:p>
        </w:tc>
      </w:tr>
    </w:tbl>
    """


def build_image_drawing_xml(rel_id: str, doc_pr_id: int, name: str, cx: int, cy: int) -> str:
    safe_name = xml_safe(name)
    return f"""
    <w:p>
      <w:pPr><w:jc w:val="center"/><w:spacing w:before="140" w:after="60"/></w:pPr>
      <w:r>
        <w:drawing>
          <wp:inline distT="0" distB="0" distL="0" distR="0">
            <wp:extent cx="{cx}" cy="{cy}"/>
            <wp:docPr id="{doc_pr_id}" name="{safe_name}"/>
            <wp:cNvGraphicFramePr>
              <a:graphicFrameLocks noChangeAspect="1"/>
            </wp:cNvGraphicFramePr>
            <a:graphic>
              <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:pic>
                  <pic:nvPicPr>
                    <pic:cNvPr id="{doc_pr_id}" name="{safe_name}"/>
                    <pic:cNvPicPr/>
                  </pic:nvPicPr>
                  <pic:blipFill>
                    <a:blip r:embed="{rel_id}"/>
                    <a:stretch><a:fillRect/></a:stretch>
                  </pic:blipFill>
                  <pic:spPr>
                    <a:xfrm>
                      <a:off x="0" y="0"/>
                      <a:ext cx="{cx}" cy="{cy}"/>
                    </a:xfrm>
                    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                  </pic:spPr>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:inline>
        </w:drawing>
      </w:r>
    </w:p>
    """


def main():
    with open(AST_PATH, "r", encoding="utf-8") as f:
        model = json.load(f)

    meta = model["metadata"]
    prelim = model["preliminary"]
    computed = model.get("computedIndex", {})

    body_parts = []
    media_entries = []  # (rel_id, archive_path, disk_path)
    img_counter = 0

    # ==================== COVER PAGE ====================
    body_parts.append(para("BACHELOR OF TECHNOLOGY IN INFORMATION TECHNOLOGY — MAJOR PROJECT REPORT",
                           bold=True, color="EA580C", align="center", space_before=360, space_after=140))
    body_parts.append(para(meta["projectTitle"], style="Title", bold=True, color="0F172A", align="center", space_after=80))
    body_parts.append(para(meta["projectSubtitle"], style="Subtitle", bold=True, color="1E293B", align="center", space_after=120))
    body_parts.append(para(meta["corePrinciple"], bold=True, color="1D4ED8", align="center", space_after=360))
    body_parts.append(para(
        "A Comprehensive Software Engineering Project Report Submitted in Partial Fulfillment of the Requirements for the Award of the Degree of",
        align="center", space_after=100
    ))
    body_parts.append(para(meta["degreeProgram"], bold=True, color="0F172A", align="center", space_after=300))
    body_parts.append(para("SUBMITTED BY", bold=True, color="475569", align="center", space_after=80))
    for st in meta["studentsPlaceholder"]:
        body_parts.append(para(f"{st['name']}  —  {st['rollNo']}", bold=True, color="0F172A", align="center", space_after=60))
    body_parts.append(para("UNDER THE SUPERVISION OF", bold=True, color="475569", align="center", space_before=280, space_after=60))
    body_parts.append(para(meta["guidePlaceholder"], bold=True, color="0F172A", align="center", space_after=320))
    body_parts.append(para(meta["departmentPlaceholder"].upper(), bold=True, color="0F172A", align="center", space_after=60))
    body_parts.append(para(meta["institutionPlaceholder"], bold=True, color="1E293B", align="center", space_after=60))
    body_parts.append(para(meta["universityPlaceholder"], color="475569", align="center", space_after=80))
    body_parts.append(para(meta["academicYearPlaceholder"], bold=True, color="EA580C", align="center"))

    # ==================== PRELIMINARY PAGES ====================
    body_parts.append(para("CERTIFICATE", style="Heading1", page_break_before=True))
    for p in prelim["certificateText"]:
        body_parts.append(para(p, align="both", space_after=140))
    body_parts.append(para(f"{meta['guidePlaceholder']} (Project Supervisor)          |          {meta['hodPlaceholder']} (Head of Department)",
                           bold=True, space_before=360, space_after=240))

    body_parts.append(para("CANDIDATE DECLARATION", style="Heading1", page_break_before=True))
    for p in prelim["declarationText"]:
        body_parts.append(para(p, align="both", space_after=140))
    for st in meta["studentsPlaceholder"]:
        body_parts.append(para(f"{st['name']} ({st['rollNo']})  —  Signature: ________________________", bold=True, space_before=120))

    body_parts.append(para("ACKNOWLEDGEMENT", style="Heading1", page_break_before=True))
    for p in prelim["acknowledgementText"]:
        body_parts.append(para(p, align="both", space_after=140))

    body_parts.append(para("ABSTRACT", style="Heading1", page_break_before=True))
    for p in prelim["abstractParagraphs"]:
        body_parts.append(para(p, align="both", space_after=140))
    body_parts.append(para("Keywords: " + " · ".join(prelim["keywords"]), bold=True, color="0F172A", space_before=120))

    # ==================== TABLE OF CONTENTS, LOF, LOT, ABBREVIATIONS ====================
    body_parts.append(para("TABLE OF CONTENTS", style="Heading1", page_break_before=True))
    # Include both Word native TOC field instruction AND synchronized summary table
    body_parts.append(
        '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>'
        '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r>'
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
        '<w:r><w:rPr><w:i/><w:color w:val="475569"/></w:rPr>'
        '<w:t>Right-click and select "Update Field" in Microsoft Word to refresh dynamic page numbers, or consult the synchronized index below.</w:t></w:r>'
        '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
    )
    if computed.get("toc"):
        toc_rows = [
            [("    " * (item["level"] - 1)) + item["label"], str(item["page"])]
            for item in computed["toc"]
        ]
        body_parts.append(build_table_xml(["Section / Heading", "PDF Page"], toc_rows, [85, 15]))

    body_parts.append(para("LIST OF FIGURES", style="Heading1", page_break_before=True))
    if computed.get("figures"):
        fig_rows = [[f"Figure {f['num']}", f["caption"], str(f["page"])] for f in computed["figures"]]
        body_parts.append(build_table_xml(["Figure", "Title / Caption", "PDF Page"], fig_rows, [16, 72, 12]))

    body_parts.append(para("LIST OF TABLES", style="Heading1", page_break_before=True))
    if computed.get("tables"):
        tbl_rows = [[f"Table {t['num']}", t["caption"], str(t["page"])] for t in computed["tables"]]
        body_parts.append(build_table_xml(["Table", "Title / Caption", "PDF Page"], tbl_rows, [16, 72, 12]))

    body_parts.append(para("LIST OF ABBREVIATIONS", style="Heading1", page_break_before=True))
    abbr_rows = [[a["abbr"], a["full"], a["context"]] for a in model["abbreviations"]]
    body_parts.append(build_table_xml(["Abbreviation", "Full Term", "Operational Context in FortiX"], abbr_rows, [16, 36, 48]))

    # ==================== BLOCK RENDERER ====================
    def render_block(b):
        nonlocal img_counter
        kind = b["kind"]
        if kind == "p":
            body_parts.append(para(b["text"], align="both", space_after=120))
        elif kind == "bullets":
            for item in b["items"]:
                body_parts.append(para(f"•  {item}", align="both", space_after=80))
        elif kind == "numbered":
            for idx, item in enumerate(b["items"], start=1):
                body_parts.append(para(f"[{idx}]  {item}", align="both", space_after=80))
        elif kind == "callout":
            body_parts.append(build_table_xml([b["title"]], [[b["text"]]], [100]))
            body_parts.append(para("", space_after=60))
        elif kind == "table":
            body_parts.append(para(f"Table {b['tableNumber']}: {b['caption']}", bold=True, color="0F172A", space_before=140, space_after=60))
            body_parts.append(build_table_xml(b["headers"], b["rows"], b.get("colWidths")))
            body_parts.append(para("", space_after=80))
        elif kind == "figure":
            disk_path = os.path.join(ROOT_DIR, b["imagePath"])
            if os.path.exists(disk_path):
                img_counter += 1
                rel_id = f"rIdImg{img_counter}"
                arc_name = f"media/fig_{img_counter:02d}.png"
                media_entries.append((rel_id, arc_name, disk_path))
                pw, ph = png_dimensions(disk_path)
                # Convert @2x pixels smoothly into EMUs bounded by MAX_IMG_W_EMU x MAX_IMG_H_EMU
                raw_cx = pw * 4762
                raw_cy = ph * 4762
                scale = min(1.0, MAX_IMG_W_EMU / raw_cx, MAX_IMG_H_EMU / raw_cy)
                cx = int(raw_cx * scale)
                cy = int(raw_cy * scale)
                body_parts.append(build_image_drawing_xml(rel_id, img_counter, f"Figure {b['figureNumber']}", cx, cy))
                body_parts.append(para(f"Figure {b['figureNumber']}: {b['caption']}", bold=True, color="0F172A", align="center", space_after=40))
                if b.get("sourceNote"):
                    body_parts.append(para(b["sourceNote"], italic=True, color="475569", align="center", space_after=120))
        elif kind == "code":
            body_parts.append(build_code_block_xml(b["title"], b["filePath"], b["code"]))
            body_parts.append(para("", space_after=100))

    # ==================== CHAPTERS & APPENDICES ====================
    for ch in model["chapters"]:
        ch_heading = f"{ch['number']} — {ch['title']}" if ch.get("isAppendix") else f"{ch['number']}. {ch['title']}"
        body_parts.append(para(ch_heading, style="Heading1", page_break_before=True))
        for b in ch.get("blocks", []):
            render_block(b)
        for sec in ch["sections"]:
            body_parts.append(para(f"{sec['number']} {sec['title']}", style="Heading2"))
            for b in sec["blocks"]:
                render_block(b)
            for sub in sec.get("subsections", []):
                body_parts.append(para(f"{sub['number']} {sub['title']}", style="Heading3"))
                for b in sub["blocks"]:
                    render_block(b)

    # Section Properties (A4, Header rIdHdr1, Footer rIdFtr1, titlePg enabled)
    sect_pr = """
    <w:sectPr>
      <w:headerReference w:type="default" r:id="rIdHdr1"/>
      <w:footerReference w:type="default" r:id="rIdFtr1"/>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1280" w:right="1150" w:bottom="1280" w:left="1150" w:header="680" w:footer="680" w:gutter="0"/>
      <w:titlePg/>
    </w:sectPr>
    """

    document_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    {''.join(body_parts)}
    {sect_pr}
  </w:body>
</w:document>
"""

    styles_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>
        <w:color w:val="1F2937"/>
        <w:sz w:val="21"/>
        <w:szCs w:val="21"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr><w:spacing w:line="276" w:lineRule="auto"/></w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:rPr><w:b/><w:color w:val="0F172A"/><w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle">
    <w:name w:val="Subtitle"/>
    <w:rPr><w:b/><w:color w:val="1E293B"/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="240" w:after="140"/>
      <w:pBdr><w:bottom w:val="single" w:sz="12" w:space="4" w:color="EA580C"/></w:pBdr>
      <w:outlineLvl w:val="0"/>
    </w:pPr>
    <w:rPr><w:b/><w:color w:val="0F172A"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="220" w:after="100"/>
      <w:outlineLvl w:val="1"/>
    </w:pPr>
    <w:rPr><w:b/><w:color w:val="0F172A"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="160" w:after="80"/>
      <w:outlineLvl w:val="2"/>
    </w:pPr>
    <w:rPr><w:b/><w:color w:val="1E293B"/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr>
  </w:style>
</w:styles>
"""

    header_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr>
      <w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="CBD5E1"/></w:pBdr>
    </w:pPr>
    <w:r>
      <w:rPr><w:b/><w:color w:val="475569"/><w:sz w:val="17"/></w:rPr>
      <w:t>FORTIX — API Security &amp; Resilience Verification Platform (B.Tech. IT Project Report)</w:t>
    </w:r>
  </w:p>
</w:hdr>
"""

    footer_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr>
      <w:pBdr><w:top w:val="single" w:sz="6" w:space="4" w:color="CBD5E1"/></w:pBdr>
      <w:jc w:val="right"/>
    </w:pPr>
    <w:r><w:rPr><w:color w:val="475569"/><w:sz w:val="17"/></w:rPr><w:t xml:space="preserve">Department of Information Technology   |   Page </w:t></w:r>
    <w:fldSimple w:instr="PAGE"><w:r><w:rPr><w:b/><w:sz w:val="17"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple>
    <w:r><w:rPr><w:color w:val="475569"/><w:sz w:val="17"/></w:rPr><w:t xml:space="preserve"> of </w:t></w:r>
    <w:fldSimple w:instr="NUMPAGES"><w:r><w:rPr><w:b/><w:sz w:val="17"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple>
  </w:p>
</w:ftr>
"""

    doc_rels = [
        '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
        '<Relationship Id="rIdHdr1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>',
        '<Relationship Id="rIdFtr1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>',
    ]
    for rel_id, arc_name, _ in media_entries:
        doc_rels.append(
            f'<Relationship Id="{rel_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="{arc_name}"/>'
        )

    doc_rels_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  {''.join(doc_rels)}
</Relationships>
"""

    root_rels_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdDoc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rIdCore" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rIdApp" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
"""

    content_types_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>
"""

    core_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties
  xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>FORTIX — API Security &amp; Resilience Verification Platform (B.Tech IT Project Report)</dc:title>
  <dc:subject>B.Tech Information Technology Final Year Software Project Report</dc:subject>
  <dc:creator>FortiX Engineering Team</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">2026-11-03T18:00:00Z</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">2026-11-03T18:00:00Z</dcterms:modified>
</cp:coreProperties>
"""

    app_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>FortiX Academic Report Builder</Application>
</Properties>
"""

    xml_members = {
        "[Content_Types].xml": content_types_xml,
        "_rels/.rels": root_rels_xml,
        "docProps/core.xml": core_xml,
        "docProps/app.xml": app_xml,
        "word/document.xml": document_xml,
        "word/styles.xml": styles_xml,
        "word/header1.xml": header_xml,
        "word/footer1.xml": footer_xml,
        "word/_rels/document.xml.rels": doc_rels_xml,
    }

    # Validate every XML payload before writing archive
    for member_name, xml_text in xml_members.items():
        ET.fromstring(xml_text.encode("utf-8"))

    with zipfile.ZipFile(DOCX_PATH, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for member_name, xml_text in xml_members.items():
            zf.writestr(member_name, xml_text.encode("utf-8"))
        for _, arc_name, disk_path in media_entries:
            zf.write(disk_path, f"word/{arc_name}")

    # Post-write integrity verification
    with zipfile.ZipFile(DOCX_PATH, "r") as zf:
        bad = zf.testzip()
        if bad is not None:
            raise RuntimeError(f"Corrupt ZIP entry in DOCX: {bad}")
        for name in zf.namelist():
            if name.endswith(".xml") or name.endswith(".rels"):
                ET.fromstring(zf.read(name))

    size_mb = os.path.getsize(DOCX_PATH) / (1024 * 1024)
    print(f"[DOCX] Generated & XML-validated {DOCX_PATH} ({size_mb:.2f} MB, {len(media_entries)} embedded PNG figures)")


if __name__ == "__main__":
    main()
