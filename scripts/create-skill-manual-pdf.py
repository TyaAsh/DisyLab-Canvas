from pathlib import Path
import re

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs' / 'Disylab-Skill-实施手册.md'
OUTPUT = ROOT / 'output' / 'pdf' / 'Disylab-Skill-系统实施手册（项目实况版）.pdf'

pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
FONT = 'STSong-Light'

def esc(value: str) -> str:
    return value.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

def inline(value: str) -> str:
    value = esc(value)
    value = re.sub(r'`([^`]+)`', r'<font name="Courier" color="#25364A">\1</font>', value)
    value = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', value)
    return value

def page_number(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor('#C9D5E1'))
    canvas.line(18 * mm, 15 * mm, 192 * mm, 15 * mm)
    canvas.setFont(FONT, 8)
    canvas.setFillColor(colors.HexColor('#60758A'))
    canvas.drawString(18 * mm, 9.5 * mm, 'DisyLab · Skill 系统实施手册 · 项目实况版')
    canvas.drawRightString(192 * mm, 9.5 * mm, str(doc.page))
    canvas.restoreState()

def build_story(text: str):
    styles = getSampleStyleSheet()
    normal = ParagraphStyle('ManualBody', parent=styles['BodyText'], fontName=FONT, fontSize=9.6, leading=16, textColor=colors.HexColor('#233244'), spaceAfter=6)
    title = ParagraphStyle('ManualTitle', parent=normal, fontSize=27, leading=36, textColor=colors.HexColor('#123A5B'), alignment=TA_CENTER, spaceAfter=11)
    subtitle = ParagraphStyle('ManualSubtitle', parent=normal, fontSize=10.5, leading=17, textColor=colors.HexColor('#627B90'), alignment=TA_CENTER, spaceAfter=26)
    h1 = ParagraphStyle('ManualH1', parent=normal, fontSize=17, leading=24, textColor=colors.HexColor('#123A5B'), spaceBefore=19, spaceAfter=9, keepWithNext=True)
    h2 = ParagraphStyle('ManualH2', parent=normal, fontSize=12.5, leading=19, textColor=colors.HexColor('#187A8A'), spaceBefore=12, spaceAfter=6, keepWithNext=True)
    bullet = ParagraphStyle('ManualBullet', parent=normal, leftIndent=13, firstLineIndent=-8, bulletIndent=4, spaceAfter=3)
    # STSong-Light keeps Chinese identifiers and comments legible inside code
    # samples. Courier is unsuitable because it has no CJK glyph coverage.
    code = ParagraphStyle('ManualCode', fontName=FONT, fontSize=7.4, leading=10.5, textColor=colors.HexColor('#20384C'), backColor=colors.HexColor('#F1F5F8'), borderColor=colors.HexColor('#D7E1E9'), borderWidth=.35, borderPadding=7, spaceBefore=5, spaceAfter=8)
    story = []
    lines = text.splitlines()
    i = 0
    in_code = False
    code_lines = []
    while i < len(lines):
        line = lines[i]
        if line.startswith('```'):
            if in_code:
                story.append(Preformatted('\n'.join(code_lines), code))
                code_lines = []
            in_code = not in_code
            i += 1
            continue
        if in_code:
            code_lines.append(line)
            i += 1
            continue
        if not line.strip():
            i += 1
            continue
        if line.startswith('# '):
            story.append(Spacer(1, 42 * mm))
            story.append(Paragraph(inline(line[2:]), title))
            i += 1
            while i < len(lines) and not lines[i].strip():
                i += 1
            meta = []
            while i < len(lines) and lines[i].strip() and not lines[i].startswith('#'):
                meta.append(lines[i].replace('  ', ''))
                i += 1
            story.append(Paragraph('<br/>'.join(inline(m) for m in meta), subtitle))
            story.append(PageBreak())
            continue
        if line.startswith('## '):
            story.append(Paragraph(inline(line[3:]), h1))
        elif line.startswith('### '):
            # Keep the final prioritization matrix as a complete, readable
            # decision page instead of stranding its last rows on a near-empty page.
            if line.startswith('### 16.6 '):
                story.append(PageBreak())
            story.append(Paragraph(inline(line[4:]), h2))
        elif line.startswith('* '):
            story.append(Paragraph(inline(line[2:]), bullet, bulletText='•'))
        elif re.match(r'^\d+\. ', line):
            num, body = line.split('. ', 1)
            story.append(Paragraph(inline(body), bullet, bulletText=f'{num}.'))
        elif line.startswith('|'):
            rows = []
            while i < len(lines) and lines[i].startswith('|'):
                cells = [c.strip() for c in lines[i].strip('|').split('|')]
                if not all(re.match(r'^:?-{3,}:?$', c) for c in cells):
                    rows.append(cells)
                i += 1
            if rows:
                table_data = [[Paragraph(inline(c), normal) for c in row] for row in rows]
                widths = [156 * mm / len(rows[0])] * len(rows[0])
                table = Table(table_data, colWidths=widths, repeatRows=1, hAlign='LEFT')
                table.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#DDEEF0')),
                    ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor('#123A5B')),
                    ('GRID', (0, 0), (-1, -1), .3, colors.HexColor('#C9D5E1')),
                    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                    ('LEFTPADDING', (0, 0), (-1, -1), 5),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 5),
                    ('TOPPADDING', (0, 0), (-1, -1), 5),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
                ]))
                story.append(Spacer(1, 3))
                story.append(table)
                story.append(Spacer(1, 7))
            continue
        else:
            story.append(Paragraph(inline(line), normal))
        i += 1
    return story

def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    document = SimpleDocTemplate(str(OUTPUT), pagesize=A4, rightMargin=18 * mm, leftMargin=18 * mm, topMargin=18 * mm, bottomMargin=22 * mm, title='DisyLab Skill 系统实施手册（项目实况版）', author='DisyLab')
    document.build(build_story(SOURCE.read_text(encoding='utf-8')), onFirstPage=page_number, onLaterPages=page_number)
    print(OUTPUT)

if __name__ == '__main__':
    main()
