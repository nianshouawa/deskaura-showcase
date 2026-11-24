"""Build the current beginner handbook from its maintained Markdown source."""
from pathlib import Path
import re

from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "learning-guide.md"
OUTPUT = ROOT / "桌面虚拟数字人伴侣项目 最终执行总方案.docx"


def font(style, name, size):
    style.font.name = name
    style.font.size = Pt(size)
    style.font.color.rgb = RGBColor(0, 0, 0)
    props = style.element.get_or_add_rPr()
    fonts = props.find(qn("w:rFonts"))
    if fonts is None:
        fonts = OxmlElement("w:rFonts")
        props.append(fonts)
    fonts.set(qn("w:eastAsia"), "Microsoft YaHei")


def main():
    doc = Document()
    section = doc.sections[0]
    section.page_width, section.page_height = Inches(8.5), Inches(11)
    section.top_margin = section.bottom_margin = Inches(.7)
    section.left_margin = section.right_margin = Inches(.7)
    for name, size in [("Normal", 11), ("Title", 25), ("Heading 1", 18),
                       ("Heading 2", 13), ("Subtitle", 11)]:
        font(doc.styles[name], "Calibri", size)
        ppr = doc.styles[name].element.find(qn("w:pPr"))
        if ppr is not None:
            for border in list(ppr.findall(qn("w:pBdr"))):
                ppr.remove(border)
    normal = doc.styles["Normal"].paragraph_format
    normal.line_spacing = 1.25
    normal.space_after = Pt(7)
    for name in ("Heading 1", "Heading 2"):
        fmt = doc.styles[name].paragraph_format
        fmt.space_before, fmt.space_after = Pt(15), Pt(8)
        fmt.keep_with_next = True
    code = doc.styles.add_style("Code", 1)
    font(code, "Consolas", 9)
    code.paragraph_format.line_spacing = 1.08
    code.paragraph_format.space_after = Pt(1)
    doc.core_properties.title = "DeskAura 零基础项目教程与实现总方案"
    doc.core_properties.author = "DeskAura"
    doc.core_properties.subject = "从基础概念到源码阅读 测试与 Windows 发布"
    lines = SOURCE.read_text(encoding="utf-8").splitlines()
    i, in_code = 0, False
    while i < len(lines):
        line = lines[i]
        if line.startswith("```"):
            in_code = not in_code
            i += 1
            continue
        if in_code:
            doc.add_paragraph(line, "Code")
        elif line.startswith("# "):
            doc.add_paragraph(line[2:], "Title")
            doc.add_paragraph("从零理解架构 读懂代码 完成测试与发布", "Subtitle")
            doc.add_paragraph("当前源码教学版  2026 年 11 月 11 日")
        elif line.startswith("## "):
            doc.add_heading(line[3:], 1)
        elif line.startswith("### "):
            doc.add_heading(line[4:], 2)
        elif line.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                cells = [s.strip() for s in lines[i].strip("|").split("|")]
                if not all(re.fullmatch(r"[-: ]+", s) for s in cells):
                    rows.append(cells)
                i += 1
            source_index = rows[0][0] == "学习目标"
            table = doc.add_table(rows=1, cols=len(rows[0]))
            table.autofit = False
            width = 7.1 / len(rows[0])
            for column in table.columns:
                column.width = Inches(width)
            for n, values in enumerate(rows):
                cells = table.rows[0].cells if n == 0 else table.add_row().cells
                for cell, value in zip(cells, values):
                    cell.text = value
                    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
                    tcpr = cell._tc.get_or_add_tcPr()
                    shade = OxmlElement("w:shd")
                    shade.set(qn("w:fill"), "E5E7EB" if n == 0 else ("F5F6F7" if n % 2 == 0 else "FFFFFF"))
                    tcpr.append(shade)
                    margins = OxmlElement("w:tcMar")
                    for side in ("top", "left", "bottom", "right"):
                        edge = OxmlElement(f"w:{side}")
                        edge.set(qn("w:w"), "60" if source_index and side in ("top", "bottom") else "90")
                        edge.set(qn("w:type"), "dxa")
                        margins.append(edge)
                    tcpr.append(margins)
                    for paragraph in cell.paragraphs:
                        paragraph.paragraph_format.space_after = Pt(3)
                        paragraph.paragraph_format.line_spacing = 1.12
                        for run in paragraph.runs:
                            run.font.size = Pt(9)
                            run.bold = n == 0
                if n == 0:
                    header = OxmlElement("w:tblHeader")
                    table.rows[0]._tr.get_or_add_trPr().append(header)
            borders = OxmlElement("w:tblBorders")
            for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
                edge = OxmlElement(f"w:{side}")
                for key, value in {"val": "single", "sz": "4", "color": "D9D9D9"}.items():
                    edge.set(qn(f"w:{key}"), value)
                borders.append(edge)
            table._tbl.tblPr.append(borders)
            doc.add_paragraph()
            continue
        elif line.startswith("- "):
            doc.add_paragraph(line[2:], "List Bullet")
        elif line.strip():
            paragraph = doc.add_paragraph(line)
            if line.startswith("第一行进入项目"):
                paragraph.paragraph_format.keep_with_next = True
        i += 1
    footer = section.footer.paragraphs[0]
    footer.alignment = 2
    field = OxmlElement("w:fldSimple")
    field.set(qn("w:instr"), "PAGE")
    footer._p.append(field)
    doc.save(OUTPUT)
    print(OUTPUT)
    print(f"paragraphs={len(doc.paragraphs)} tables={len(doc.tables)}")


if __name__ == "__main__":
    main()
