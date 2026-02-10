#!/usr/bin/env python3
import html
import re
import sys
from datetime import datetime
from pathlib import Path

try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.platypus import ListFlowable, ListItem, PageBreak, Paragraph, Preformatted, SimpleDocTemplate, Spacer, Table, TableStyle
except Exception as exc:
    print(f"reportlab import failed: {exc}", file=sys.stderr)
    sys.exit(2)


SEVERITY_COLORS = {
    "critical": colors.HexColor("#7F1D1D"),
    "high": colors.HexColor("#9A3412"),
    "medium": colors.HexColor("#0C4A6E"),
    "low": colors.HexColor("#14532D"),
    "info": colors.HexColor("#334155"),
}


def parse_markdown(text: str):
    blocks = []
    paragraph_lines = []
    list_items = []
    code_lines = []
    in_code = False

    def flush_paragraph():
        nonlocal paragraph_lines
        if paragraph_lines:
            blocks.append(("paragraph", " ".join(line.strip() for line in paragraph_lines).strip()))
            paragraph_lines = []

    def flush_list():
        nonlocal list_items
        if list_items:
            blocks.append(("list", list_items))
            list_items = []

    def flush_code():
        nonlocal code_lines
        if code_lines:
            blocks.append(("code", "\n".join(code_lines)))
            code_lines = []

    for raw_line in text.splitlines():
        line = raw_line.rstrip("\n")

        if line.strip().startswith("```"):
            if in_code:
                flush_code()
                in_code = False
            else:
                flush_paragraph()
                flush_list()
                in_code = True
            continue

        if in_code:
            code_lines.append(line)
            continue

        heading_match = re.match(r"^(#{1,6})\s+(.+)$", line)
        if heading_match:
            flush_paragraph()
            flush_list()
            level = len(heading_match.group(1))
            blocks.append((f"h{level}", heading_match.group(2).strip()))
            continue

        list_match = re.match(r"^\s*(?:[-*]|\d+\.)\s+(.+)$", line)
        if list_match:
            flush_paragraph()
            list_items.append(list_match.group(1).strip())
            continue

        if not line.strip():
            flush_paragraph()
            flush_list()
            continue

        paragraph_lines.append(line)

    if in_code:
        flush_code()
    flush_paragraph()
    flush_list()
    return blocks


def inline_markdown_to_reportlab(text: str) -> str:
    escaped = html.escape(text, quote=False)
    escaped = re.sub(r"`([^`]+)`", r"<font name='Courier'>\1</font>", escaped)
    escaped = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", escaped)
    return escaped


def parse_summary_metrics(markdown: str):
    total_match = re.search(r"-\s*Total findings:\s*(\d+)", markdown, flags=re.IGNORECASE)
    mix_match = re.search(
        r"-\s*Severity mix:\s*critical=(\d+),\s*high=(\d+),\s*medium=(\d+),\s*low=(\d+),\s*info=(\d+)",
        markdown,
        flags=re.IGNORECASE,
    )

    data = {
        "total": int(total_match.group(1)) if total_match else None,
        "critical": None,
        "high": None,
        "medium": None,
        "low": None,
        "info": None,
    }
    if mix_match:
        data["critical"] = int(mix_match.group(1))
        data["high"] = int(mix_match.group(2))
        data["medium"] = int(mix_match.group(3))
        data["low"] = int(mix_match.group(4))
        data["info"] = int(mix_match.group(5))
    return data


def collect_headings(blocks):
    headings = []
    for kind, text in blocks:
        if kind in {"h1", "h2", "h3"}:
            level = int(kind[1])
            headings.append((level, text))
    return headings


def collect_findings(blocks):
    findings = []
    current = None

    for kind, payload in blocks:
        if kind == "h3":
            finding_match = re.match(r"^\[([^\]]+)\]\s+(.+)$", payload)
            if finding_match:
                current = {
                    "id": finding_match.group(1),
                    "title": finding_match.group(2),
                    "severity": "unknown",
                    "confidence": "n/a",
                    "asset": "n/a",
                }
                findings.append(current)
                continue
            current = None
            continue

        if not current:
            continue

        text = payload if isinstance(payload, str) else ""
        sev = re.match(r"^-\s*Severity\s*:\s*(.+)$", text, flags=re.IGNORECASE)
        conf = re.match(r"^-\s*Confidence\s*:\s*(.+)$", text, flags=re.IGNORECASE)
        asset = re.match(r"^-\s*Asset\s*:\s*(.+)$", text, flags=re.IGNORECASE)
        if sev:
            current["severity"] = sev.group(1).strip().lower()
        if conf:
            current["confidence"] = conf.group(1).strip()
        if asset:
            current["asset"] = asset.group(1).strip()

        if kind == "list":
            for item in payload:
                sev_i = re.match(r"^Severity\s*:\s*(.+)$", item, flags=re.IGNORECASE)
                conf_i = re.match(r"^Confidence\s*:\s*(.+)$", item, flags=re.IGNORECASE)
                asset_i = re.match(r"^Asset\s*:\s*(.+)$", item, flags=re.IGNORECASE)
                if sev_i:
                    current["severity"] = sev_i.group(1).strip().lower()
                if conf_i:
                    current["confidence"] = conf_i.group(1).strip()
                if asset_i:
                    current["asset"] = asset_i.group(1).strip()

    return findings


def draw_page_chrome(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor("#CBD5E1"))
    canvas.setLineWidth(0.6)
    canvas.line(doc.leftMargin, letter[1] - 0.63 * inch, letter[0] - doc.rightMargin, letter[1] - 0.63 * inch)

    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#64748B"))
    canvas.drawRightString(letter[0] - doc.rightMargin, 0.45 * inch, f"Page {canvas.getPageNumber()}")
    canvas.drawString(doc.leftMargin, 0.45 * inch, "ULMCode Security Assessment")
    canvas.restoreState()


def build_styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "ReportTitle",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=30,
            leading=34,
            textColor=colors.HexColor("#F8FAFC"),
            alignment=1,
            spaceAfter=8,
        ),
        "subtitle": ParagraphStyle(
            "ReportSubtitle",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=11,
            leading=14,
            textColor=colors.HexColor("#E2E8F0"),
            alignment=1,
            spaceAfter=4,
        ),
        "section_tag": ParagraphStyle(
            "SectionTag",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8,
            leading=10,
            textColor=colors.HexColor("#0F172A"),
            alignment=0,
            spaceAfter=2,
        ),
        "h1": ParagraphStyle(
            "Heading1Custom",
            parent=base["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=19,
            leading=24,
            textColor=colors.HexColor("#0F172A"),
            spaceBefore=16,
            spaceAfter=8,
        ),
        "h2": ParagraphStyle(
            "Heading2Custom",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=14,
            leading=18,
            textColor=colors.HexColor("#0F172A"),
            spaceBefore=10,
            spaceAfter=6,
        ),
        "h3": ParagraphStyle(
            "Heading3Custom",
            parent=base["Heading3"],
            fontName="Helvetica-Bold",
            fontSize=12,
            leading=15,
            textColor=colors.HexColor("#111827"),
            spaceBefore=8,
            spaceAfter=5,
        ),
        "body": ParagraphStyle(
            "BodyCustom",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10,
            leading=14,
            textColor=colors.HexColor("#0F172A"),
            spaceAfter=6,
        ),
        "muted": ParagraphStyle(
            "Muted",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9,
            leading=12,
            textColor=colors.HexColor("#475569"),
            spaceAfter=4,
        ),
        "severity": ParagraphStyle(
            "SeverityLine",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9,
            leading=12,
            textColor=colors.white,
            leftIndent=6,
            rightIndent=6,
            spaceBefore=2,
            spaceAfter=6,
        ),
        "code": ParagraphStyle(
            "CodeCustom",
            parent=base["Code"],
            fontName="Courier",
            fontSize=8,
            leading=11,
            textColor=colors.HexColor("#111827"),
        ),
        "list": ParagraphStyle(
            "ListItem",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10,
            leading=14,
            textColor=colors.HexColor("#111827"),
        ),
        "toc_h2": ParagraphStyle(
            "TocH2",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=10,
            leading=13,
            textColor=colors.HexColor("#1E293B"),
            leftIndent=2,
            spaceAfter=2,
        ),
        "toc_h3": ParagraphStyle(
            "TocH3",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9,
            leading=12,
            textColor=colors.HexColor("#334155"),
            leftIndent=14,
            spaceAfter=1,
        ),
    }


def add_cover_page(story, styles):
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    cover = Table(
        [[
            Paragraph("Client Pentest Report", styles["title"]),
            Paragraph("ULMCode Report Writer", styles["subtitle"]),
            Paragraph(now, styles["subtitle"]),
        ]],
        colWidths=[6.9 * inch],
    )
    cover.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#0B1324")),
                ("BOX", (0, 0), (-1, -1), 0, colors.white),
                ("TOPPADDING", (0, 0), (-1, -1), 76),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 76),
                ("LEFTPADDING", (0, 0), (-1, -1), 22),
                ("RIGHTPADDING", (0, 0), (-1, -1), 22),
            ]
        )
    )
    story.append(Spacer(1, 1.65 * inch))
    story.append(cover)
    story.append(PageBreak())


def add_summary_cards(story, styles, metrics):
    story.append(Paragraph("EXECUTIVE SNAPSHOT", styles["section_tag"]))
    labels = [
        ("Total Findings", str(metrics.get("total") if metrics.get("total") is not None else "n/a"), colors.HexColor("#0F172A")),
        ("Critical", str(metrics.get("critical") if metrics.get("critical") is not None else "n/a"), SEVERITY_COLORS["critical"]),
        ("High", str(metrics.get("high") if metrics.get("high") is not None else "n/a"), SEVERITY_COLORS["high"]),
        ("Medium", str(metrics.get("medium") if metrics.get("medium") is not None else "n/a"), SEVERITY_COLORS["medium"]),
        ("Low", str(metrics.get("low") if metrics.get("low") is not None else "n/a"), SEVERITY_COLORS["low"]),
    ]

    row = []
    for label, value, color in labels:
        card = Table(
            [[Paragraph(label, styles["muted"])], [Paragraph(f"<b>{value}</b>", styles["h2"]) ]],
            colWidths=[1.24 * inch],
        )
        card.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
                    ("BOX", (0, 0), (-1, -1), 0.8, colors.HexColor("#CBD5E1")),
                    ("TOPPADDING", (0, 0), (-1, -1), 6),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                    ("LINEABOVE", (0, 0), (-1, 0), 3, color),
                ]
            )
        )
        row.append(card)

    summary = Table([row], colWidths=[1.26 * inch] * len(row))
    summary.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.append(summary)
    story.append(Spacer(1, 12))


def add_toc(story, styles, headings):
    if not headings:
        return
    story.append(Paragraph("TABLE OF CONTENTS", styles["section_tag"]))
    for level, title in headings:
        if level == 1:
            continue
        style = styles["toc_h2"] if level == 2 else styles["toc_h3"]
        story.append(Paragraph(inline_markdown_to_reportlab(title), style))
    story.append(Spacer(1, 12))


def add_findings_matrix(story, styles, findings):
    if not findings:
        return
    story.append(Paragraph("FINDINGS MATRIX", styles["section_tag"]))
    rows = [["ID", "Title", "Severity", "Confidence"]]
    for finding in findings:
        rows.append([
            finding["id"],
            finding["title"],
            finding["severity"].upper() if finding["severity"] != "unknown" else "UNKNOWN",
            finding["confidence"],
        ])

    table = Table(rows, colWidths=[1.1 * inch, 3.75 * inch, 1.0 * inch, 0.95 * inch], repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E2E8F0")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]

    for row_index, finding in enumerate(findings, start=1):
        sev = finding["severity"].lower()
        sev_color = SEVERITY_COLORS.get(sev, colors.HexColor("#334155"))
        style.extend(
            [
                ("BACKGROUND", (2, row_index), (2, row_index), sev_color),
                ("TEXTCOLOR", (2, row_index), (2, row_index), colors.white),
                ("FONTNAME", (2, row_index), (2, row_index), "Helvetica-Bold"),
            ]
        )

    table.setStyle(TableStyle(style))
    story.append(table)
    story.append(Spacer(1, 12))


def render_markdown_to_story(markdown: str):
    styles = build_styles()
    blocks = parse_markdown(markdown)
    headings = collect_headings(blocks)
    findings = collect_findings(blocks)
    metrics = parse_summary_metrics(markdown)

    story = []
    add_cover_page(story, styles)
    add_summary_cards(story, styles, metrics)
    add_toc(story, styles, headings)
    add_findings_matrix(story, styles, findings)
    story.append(PageBreak())

    for block_type, payload in blocks:
        if block_type == "h1":
            if payload.strip().lower() == "client pentest report":
                continue
            story.append(Paragraph(inline_markdown_to_reportlab(payload), styles["h1"]))
            continue

        if block_type == "h2":
            divider = Table([[" "]], colWidths=[6.9 * inch], rowHeights=[0.08 * inch])
            divider.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#DBEAFE")), ("BOX", (0, 0), (-1, -1), 0, colors.white)]))
            story.append(Spacer(1, 8))
            story.append(divider)
            story.append(Paragraph(inline_markdown_to_reportlab(payload), styles["h2"]))
            continue

        if block_type in {"h3", "h4", "h5", "h6"}:
            story.append(Paragraph(inline_markdown_to_reportlab(payload), styles["h3"]))
            continue

        if block_type == "paragraph":
            severity_match = re.match(r"^-\s*Severity\s*:\s*(critical|high|medium|low|info)\s*$", payload, flags=re.IGNORECASE)
            meta_match = re.match(r"^-\s*(Confidence|Asset|Generated|Session)\s*:\s*(.+)$", payload, flags=re.IGNORECASE)
            if severity_match:
                sev = severity_match.group(1).lower()
                sev_color = SEVERITY_COLORS.get(sev, colors.HexColor("#334155"))
                sev_style = ParagraphStyle("severity-inline", parent=styles["severity"], backColor=sev_color)
                story.append(Paragraph(f"Severity: {sev.upper()}", sev_style))
            elif meta_match:
                story.append(Paragraph(inline_markdown_to_reportlab(payload), styles["muted"]))
            else:
                story.append(Paragraph(inline_markdown_to_reportlab(payload), styles["body"]))
            continue

        if block_type == "list":
            items = [ListItem(Paragraph(inline_markdown_to_reportlab(item), styles["list"]), leftIndent=10) for item in payload]
            story.append(ListFlowable(items, bulletType="bullet", start="circle", leftPadding=16))
            story.append(Spacer(1, 4))
            continue

        if block_type == "code":
            code_block = Table([[Preformatted(payload or " ", styles["code"])]], colWidths=[6.7 * inch])
            code_block.setStyle(
                TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
                        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#CBD5E1")),
                        ("LEFTPADDING", (0, 0), (-1, -1), 8),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                        ("TOPPADDING", (0, 0), (-1, -1), 6),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                    ]
                )
            )
            story.append(code_block)
            story.append(Spacer(1, 6))
            continue

    return story


def main():
    if len(sys.argv) != 3:
        print("usage: generate_report_pdf.py <input_markdown> <output_pdf>", file=sys.stderr)
        return 1

    input_md = Path(sys.argv[1])
    output_pdf = Path(sys.argv[2])
    if not input_md.exists():
        print(f"input markdown does not exist: {input_md}", file=sys.stderr)
        return 1

    markdown = input_md.read_text(encoding="utf-8")
    output_pdf.parent.mkdir(parents=True, exist_ok=True)

    doc = SimpleDocTemplate(
        str(output_pdf),
        pagesize=letter,
        title="Client Pentest Report",
        topMargin=0.9 * inch,
        bottomMargin=0.75 * inch,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
    )
    story = render_markdown_to_story(markdown)
    doc.build(story, onFirstPage=draw_page_chrome, onLaterPages=draw_page_chrome)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
