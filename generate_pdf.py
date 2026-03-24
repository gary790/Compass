#!/usr/bin/env python3
"""
Agentic RAG Platform - Complete Architecture & Implementation Guide
Generates a comprehensive PDF document
"""

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor, black, white, Color
from reportlab.lib.units import inch, mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, HRFlowable, Preformatted
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY, TA_RIGHT
from reportlab.platypus.flowables import Flowable
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Circle, Polygon
from reportlab.graphics import renderPDF
from reportlab.pdfgen import canvas
from datetime import datetime
import textwrap

# ============================================================
# COLOR PALETTE
# ============================================================
PRIMARY = HexColor("#1a1a2e")
SECONDARY = HexColor("#16213e")
ACCENT = HexColor("#0f3460")
HIGHLIGHT = HexColor("#e94560")
SUCCESS = HexColor("#00b894")
WARNING = HexColor("#fdcb6e")
INFO = HexColor("#74b9ff")
DARK_TEXT = HexColor("#2d3436")
LIGHT_TEXT = HexColor("#636e72")
BG_LIGHT = HexColor("#f8f9fa")
BG_CODE = HexColor("#2d2d2d")
BORDER = HexColor("#dfe6e9")
WHITE = white
PURPLE = HexColor("#6c5ce7")
ORANGE = HexColor("#e17055")
TEAL = HexColor("#00cec9")
BLUE = HexColor("#0984e3")

# ============================================================
# CUSTOM STYLES
# ============================================================
styles = getSampleStyleSheet()

styles.add(ParagraphStyle(
    'CoverTitle', parent=styles['Title'],
    fontSize=36, leading=44, textColor=WHITE,
    alignment=TA_CENTER, spaceAfter=10,
    fontName='Helvetica-Bold'
))

styles.add(ParagraphStyle(
    'CoverSubtitle', parent=styles['Normal'],
    fontSize=16, leading=22, textColor=HexColor("#b2bec3"),
    alignment=TA_CENTER, spaceAfter=6,
    fontName='Helvetica'
))

styles.add(ParagraphStyle(
    'SectionHeader', parent=styles['Heading1'],
    fontSize=22, leading=28, textColor=PRIMARY,
    spaceBefore=24, spaceAfter=12,
    fontName='Helvetica-Bold',
    borderWidth=0, borderPadding=0,
))

styles.add(ParagraphStyle(
    'SubHeader', parent=styles['Heading2'],
    fontSize=16, leading=22, textColor=ACCENT,
    spaceBefore=16, spaceAfter=8,
    fontName='Helvetica-Bold'
))

styles.add(ParagraphStyle(
    'SubSubHeader', parent=styles['Heading3'],
    fontSize=13, leading=18, textColor=DARK_TEXT,
    spaceBefore=12, spaceAfter=6,
    fontName='Helvetica-Bold'
))

styles.add(ParagraphStyle(
    'BodyText2', parent=styles['Normal'],
    fontSize=10.5, leading=16, textColor=DARK_TEXT,
    alignment=TA_JUSTIFY, spaceAfter=8,
    fontName='Helvetica'
))

styles.add(ParagraphStyle(
    'BulletItem', parent=styles['Normal'],
    fontSize=10.5, leading=16, textColor=DARK_TEXT,
    leftIndent=20, spaceAfter=4,
    bulletIndent=8, bulletFontSize=10,
    fontName='Helvetica'
))

styles.add(ParagraphStyle(
    'CodeBlock', parent=styles['Code'],
    fontSize=8.5, leading=12,
    textColor=HexColor("#dfe6e9"),
    backColor=HexColor("#2d3436"),
    leftIndent=12, rightIndent=12,
    spaceBefore=8, spaceAfter=8,
    fontName='Courier',
    borderWidth=1,
    borderColor=HexColor("#636e72"),
    borderPadding=8,
    borderRadius=4,
))

styles.add(ParagraphStyle(
    'TableHeader', parent=styles['Normal'],
    fontSize=10, leading=14, textColor=WHITE,
    fontName='Helvetica-Bold', alignment=TA_CENTER
))

styles.add(ParagraphStyle(
    'TableCell', parent=styles['Normal'],
    fontSize=9.5, leading=13, textColor=DARK_TEXT,
    fontName='Helvetica', alignment=TA_LEFT
))

styles.add(ParagraphStyle(
    'TableCellCenter', parent=styles['Normal'],
    fontSize=9.5, leading=13, textColor=DARK_TEXT,
    fontName='Helvetica', alignment=TA_CENTER
))

styles.add(ParagraphStyle(
    'Caption', parent=styles['Normal'],
    fontSize=9, leading=12, textColor=LIGHT_TEXT,
    alignment=TA_CENTER, spaceAfter=12, spaceBefore=4,
    fontName='Helvetica-Oblique'
))

styles.add(ParagraphStyle(
    'FooterStyle', parent=styles['Normal'],
    fontSize=8, leading=10, textColor=LIGHT_TEXT,
    alignment=TA_CENTER, fontName='Helvetica'
))

styles.add(ParagraphStyle(
    'Callout', parent=styles['Normal'],
    fontSize=10.5, leading=16, textColor=DARK_TEXT,
    leftIndent=16, rightIndent=16,
    spaceBefore=8, spaceAfter=8,
    borderWidth=1, borderColor=INFO,
    borderPadding=12, borderRadius=4,
    backColor=HexColor("#ebf5fb"),
    fontName='Helvetica'
))

styles.add(ParagraphStyle(
    'WarningCallout', parent=styles['Normal'],
    fontSize=10.5, leading=16, textColor=DARK_TEXT,
    leftIndent=16, rightIndent=16,
    spaceBefore=8, spaceAfter=8,
    borderWidth=1, borderColor=WARNING,
    borderPadding=12, borderRadius=4,
    backColor=HexColor("#fef9e7"),
    fontName='Helvetica'
))

styles.add(ParagraphStyle(
    'SuccessCallout', parent=styles['Normal'],
    fontSize=10.5, leading=16, textColor=DARK_TEXT,
    leftIndent=16, rightIndent=16,
    spaceBefore=8, spaceAfter=8,
    borderWidth=1, borderColor=SUCCESS,
    borderPadding=12, borderRadius=4,
    backColor=HexColor("#eafaf1"),
    fontName='Helvetica'
))

# ============================================================
# CUSTOM FLOWABLES
# ============================================================

class ColoredBox(Flowable):
    """A colored box with text inside"""
    def __init__(self, text, bg_color, text_color=WHITE, width=None, height=30, font_size=11):
        Flowable.__init__(self)
        self.text = text
        self.bg_color = bg_color
        self.text_color = text_color
        self.box_width = width or 500
        self.box_height = height
        self.font_size = font_size

    def wrap(self, availWidth, availHeight):
        self.box_width = min(self.box_width, availWidth)
        return (self.box_width, self.box_height)

    def draw(self):
        self.canv.setFillColor(self.bg_color)
        self.canv.roundRect(0, 0, self.box_width, self.box_height, 4, fill=1, stroke=0)
        self.canv.setFillColor(self.text_color)
        self.canv.setFont("Helvetica-Bold", self.font_size)
        self.canv.drawString(12, (self.box_height - self.font_size) / 2 + 1, self.text)


class DiagramBox(Flowable):
    """Generic diagram flowable"""
    def __init__(self, width, height, draw_func):
        Flowable.__init__(self)
        self.width = width
        self.height = height
        self.draw_func = draw_func

    def wrap(self, availWidth, availHeight):
        return (self.width, self.height)

    def draw(self):
        self.draw_func(self.canv, self.width, self.height)


def draw_rounded_rect(c, x, y, w, h, r, fill_color, stroke_color=None, stroke_width=1):
    c.saveState()
    c.setFillColor(fill_color)
    if stroke_color:
        c.setStrokeColor(stroke_color)
        c.setLineWidth(stroke_width)
        c.roundRect(x, y, w, h, r, fill=1, stroke=1)
    else:
        c.roundRect(x, y, w, h, r, fill=1, stroke=0)
    c.restoreState()


def draw_arrow(c, x1, y1, x2, y2, color=LIGHT_TEXT, width=1.5):
    import math
    c.saveState()
    c.setStrokeColor(color)
    c.setFillColor(color)
    c.setLineWidth(width)
    c.line(x1, y1, x2, y2)
    # arrowhead
    angle = math.atan2(y2 - y1, x2 - x1)
    arrow_len = 8
    p = c.beginPath()
    p.moveTo(x2, y2)
    p.lineTo(x2 - arrow_len * math.cos(angle - 0.4), y2 - arrow_len * math.sin(angle - 0.4))
    p.lineTo(x2 - arrow_len * math.cos(angle + 0.4), y2 - arrow_len * math.sin(angle + 0.4))
    p.close()
    c.drawPath(p, fill=1, stroke=0)
    c.restoreState()


def draw_text_in_box(c, text, x, y, w, h, font_size=9, text_color=WHITE, font='Helvetica-Bold'):
    c.saveState()
    c.setFillColor(text_color)
    c.setFont(font, font_size)
    lines = text.split('\n')
    line_height = font_size + 3
    total_height = len(lines) * line_height
    start_y = y + (h + total_height) / 2 - line_height
    for i, line in enumerate(lines):
        text_width = c.stringWidth(line, font, font_size)
        c.drawString(x + (w - text_width) / 2, start_y - i * line_height, line)
    c.restoreState()


# ============================================================
# DIAGRAM GENERATORS
# ============================================================

def draw_system_architecture(canv, w, h):
    """Draw the full system architecture diagram"""
    # Background
    draw_rounded_rect(canv, 0, 0, w, h, 8, HexColor("#f8f9fa"), BORDER, 2)

    # Title
    canv.saveState()
    canv.setFont("Helvetica-Bold", 14)
    canv.setFillColor(PRIMARY)
    canv.drawString(w/2 - 120, h - 25, "Self-Hosted System Architecture")
    canv.restoreState()

    # NGINX Layer
    draw_rounded_rect(canv, 15, h - 70, w - 30, 35, 6, ACCENT)
    draw_text_in_box(canv, "NGINX Reverse Proxy (SSL + Rate Limiting + WebSocket Upgrade)", 15, h - 70, w - 30, 35, 10)

    # Main App
    draw_rounded_rect(canv, 15, h - 250, 250, 165, 6, HexColor("#dfe6e9"), ACCENT, 1.5)
    canv.saveState()
    canv.setFont("Helvetica-Bold", 10)
    canv.setFillColor(ACCENT)
    canv.drawString(50, h - 95, "MAIN APP (Hono :3000)")
    canv.setFont("Helvetica", 8.5)
    canv.setFillColor(DARK_TEXT)
    items = ["GenUI Dashboard", "Agent Trace Visualizer", "File Explorer + Code Editor",
             "Terminal (xterm.js)", "Deploy Console", "SSE + WebSocket APIs"]
    for i, item in enumerate(items):
        canv.drawString(30, h - 115 - i * 15, f"  {item}")
    canv.restoreState()

    # Preview Server
    draw_rounded_rect(canv, 280, h - 150, 220, 65, 6, HexColor("#dfe6e9"), TEAL, 1.5)
    canv.saveState()
    canv.setFont("Helvetica-Bold", 10)
    canv.setFillColor(TEAL)
    canv.drawString(300, h - 105, "PREVIEW SERVER (:3001)")
    canv.setFont("Helvetica", 8.5)
    canv.setFillColor(DARK_TEXT)
    canv.drawString(295, h - 120, "  Live preview of workspace builds")
    canv.drawString(295, h - 135, "  Serves in iframe for testing")
    canv.restoreState()

    # Agent Engine
    draw_rounded_rect(canv, 280, h - 250, 220, 85, 6, HexColor("#ffeaa7"), ORANGE, 1.5)
    canv.saveState()
    canv.setFont("Helvetica-Bold", 10)
    canv.setFillColor(ORANGE)
    canv.drawString(310, h - 175, "AGENT ENGINE")
    canv.setFont("Helvetica", 8.5)
    canv.setFillColor(DARK_TEXT)
    items2 = ["Graph Orchestrator", "MoE LLM Router", "Tool Registry (30+)", "ReAct Loop Controller"]
    for i, item in enumerate(items2):
        canv.drawString(295, h - 195 - i * 14, f"  {item}")
    canv.restoreState()

    # Arrow from NGINX
    draw_arrow(canv, 140, h - 70, 140, h - 85, ACCENT)
    draw_arrow(canv, 390, h - 70, 390, h - 85, ACCENT)

    # LLM Providers
    llms = [("OpenAI", BLUE), ("Claude", PURPLE), ("Gemini", SUCCESS),
            ("Mistral", ORANGE), ("Groq", TEAL), ("Ollama", LIGHT_TEXT)]
    box_w = 75
    start_x = 15
    for i, (name, color) in enumerate(llms):
        x = start_x + i * (box_w + 7)
        draw_rounded_rect(canv, x, h - 300, box_w, 35, 4, color)
        draw_text_in_box(canv, name, x, h - 300, box_w, 35, 9)

    # Arrow from Agent to LLMs
    draw_arrow(canv, 250, h - 260, 250, h - 265, ACCENT)

    # Data Layer
    dbs = [
        ("PostgreSQL\nUsers, Projects\nBM25 Index", ACCENT),
        ("Redis\nCache, Queue\nSessions", HIGHLIGHT),
        ("ChromaDB\nVectors\nEmbeddings", PURPLE),
        ("Filesystem\nWorkspaces\nUploads", SUCCESS),
    ]
    db_w = 115
    for i, (label, color) in enumerate(dbs):
        x = 15 + i * (db_w + 10)
        draw_rounded_rect(canv, x, h - 395, db_w, 75, 4, HexColor("#f8f9fa"), color, 2)
        draw_text_in_box(canv, label, x, h - 395, db_w, 75, 8, color, 'Helvetica')

    # Arrow from LLMs to data
    draw_arrow(canv, 250, h - 300, 250, h - 315, ACCENT)

    # Data Layer label
    canv.saveState()
    canv.setFont("Helvetica-Bold", 11)
    canv.setFillColor(DARK_TEXT)
    canv.drawString(210, h - 328, "DATA LAYER")
    canv.restoreState()


def draw_orchestration_graph(canv, w, h):
    """Draw the orchestration graph diagram"""
    draw_rounded_rect(canv, 0, 0, w, h, 8, HexColor("#f8f9fa"), BORDER, 2)

    canv.saveState()
    canv.setFont("Helvetica-Bold", 14)
    canv.setFillColor(PRIMARY)
    canv.drawString(w/2 - 100, h - 25, "Orchestration Graph (LangGraph)")
    canv.restoreState()

    # User Query
    draw_rounded_rect(canv, w/2 - 60, h - 65, 120, 30, 15, HIGHLIGHT)
    draw_text_in_box(canv, "USER QUERY", w/2 - 60, h - 65, 120, 30, 10)

    # Router
    draw_rounded_rect(canv, w/2 - 70, h - 115, 140, 35, 6, PRIMARY)
    draw_text_in_box(canv, "ROUTER (LLM)", w/2 - 70, h - 115, 140, 35, 10)

    draw_arrow(canv, w/2, h - 65, w/2, h - 80, ACCENT)

    # Sub-agents
    agents = [
        ("RAG\nAgent", BLUE, 30),
        ("CODE\nAgent", PURPLE, 150),
        ("DEPLOY\nAgent", SUCCESS, 270),
        ("DESIGN\nAgent", ORANGE, 390),
    ]
    for name, color, x in agents:
        draw_rounded_rect(canv, x, h - 190, 90, 50, 6, color)
        draw_text_in_box(canv, name, x, h - 190, 90, 50, 9)

    # Arrows from router to agents
    for _, _, x in agents:
        draw_arrow(canv, w/2, h - 115, x + 45, h - 140, ACCENT)

    # Reviewer
    draw_rounded_rect(canv, w/2 - 65, h - 250, 130, 35, 6, ACCENT)
    draw_text_in_box(canv, "REVIEWER (LLM)", w/2 - 65, h - 250, 130, 35, 10)

    # Arrows from agents to reviewer
    for _, _, x in agents:
        draw_arrow(canv, x + 45, h - 190, w/2, h - 215, LIGHT_TEXT)

    # Decision
    # Pass
    draw_rounded_rect(canv, 80, h - 310, 120, 30, 6, SUCCESS)
    draw_text_in_box(canv, "PASS -> Respond", 80, h - 310, 120, 30, 9)

    # Fail
    draw_rounded_rect(canv, 300, h - 310, 120, 30, 6, HIGHLIGHT)
    draw_text_in_box(canv, "FAIL -> Loop Back", 300, h - 310, 120, 30, 9)

    draw_arrow(canv, w/2 - 30, h - 250, 140, h - 280, SUCCESS)
    draw_arrow(canv, w/2 + 30, h - 250, 360, h - 280, HIGHLIGHT)

    # Loop back arrow
    canv.saveState()
    canv.setStrokeColor(HIGHLIGHT)
    canv.setLineWidth(1.5)
    canv.setDash(4, 3)
    canv.line(420, h - 295, 470, h - 295)
    canv.line(470, h - 295, 470, h - 165)
    canv.line(470, h - 165, 420, h - 165)
    canv.restoreState()
    draw_arrow(canv, 425, h - 165, 420, h - 165, HIGHLIGHT)

    # Human breakpoint
    draw_rounded_rect(canv, w/2 - 90, h - 365, 180, 35, 6, WARNING)
    draw_text_in_box(canv, "HUMAN-IN-THE-LOOP\nBREAKPOINT", w/2 - 90, h - 365, 180, 35, 8, DARK_TEXT)
    draw_arrow(canv, 140, h - 310, w/2 - 30, h - 330, WARNING)


def draw_hybrid_search(canv, w, h):
    """Draw the hybrid search diagram"""
    draw_rounded_rect(canv, 0, 0, w, h, 8, HexColor("#f8f9fa"), BORDER, 2)

    canv.saveState()
    canv.setFont("Helvetica-Bold", 14)
    canv.setFillColor(PRIMARY)
    canv.drawString(w/2 - 80, h - 25, "Hybrid Search (BM25 + Vector)")
    canv.restoreState()

    # Query
    draw_rounded_rect(canv, w/2 - 55, h - 60, 110, 28, 14, HIGHLIGHT)
    draw_text_in_box(canv, "User Query", w/2 - 55, h - 60, 110, 28, 10)

    # Split
    draw_arrow(canv, w/2 - 20, h - 60, 100, h - 80, ACCENT)
    draw_arrow(canv, w/2 + 20, h - 60, 380, h - 80, ACCENT)

    # Vector search
    draw_rounded_rect(canv, 30, h - 130, 150, 45, 6, BLUE)
    draw_text_in_box(canv, "VECTOR SEARCH\nCosine Similarity", 30, h - 130, 150, 45, 9)

    # BM25
    draw_rounded_rect(canv, 310, h - 130, 150, 45, 6, PURPLE)
    draw_text_in_box(canv, "BM25 LEXICAL\nToken Matching", 310, h - 130, 150, 45, 9)

    # RRF
    draw_rounded_rect(canv, w/2 - 75, h - 195, 150, 40, 6, SUCCESS)
    draw_text_in_box(canv, "RECIPROCAL RANK\nFUSION (RRF)", w/2 - 75, h - 195, 150, 40, 9)

    draw_arrow(canv, 105, h - 130, w/2 - 20, h - 155, LIGHT_TEXT)
    draw_arrow(canv, 385, h - 130, w/2 + 20, h - 155, LIGHT_TEXT)

    # Reranker
    draw_rounded_rect(canv, w/2 - 60, h - 250, 120, 35, 6, ORANGE)
    draw_text_in_box(canv, "RE-RANKER\n(LLM Judge)", w/2 - 60, h - 250, 120, 35, 9)

    draw_arrow(canv, w/2, h - 195, w/2, h - 215, LIGHT_TEXT)

    # Output
    draw_rounded_rect(canv, w/2 - 55, h - 295, 110, 28, 14, ACCENT)
    draw_text_in_box(canv, "Top 5 Chunks", w/2 - 55, h - 295, 110, 28, 9)

    draw_arrow(canv, w/2, h - 250, w/2, h - 267, LIGHT_TEXT)


def draw_genui_stream(canv, w, h):
    """Draw the GenUI streaming protocol diagram"""
    draw_rounded_rect(canv, 0, 0, w, h, 8, HexColor("#f8f9fa"), BORDER, 2)

    canv.saveState()
    canv.setFont("Helvetica-Bold", 14)
    canv.setFillColor(PRIMARY)
    canv.drawString(w/2 - 90, h - 25, "GenUI Streaming Protocol (SSE)")
    canv.restoreState()

    # Server
    draw_rounded_rect(canv, 20, h - 65, 180, 30, 6, ACCENT)
    draw_text_in_box(canv, "SERVER (Hono + Node.js)", 20, h - 65, 180, 30, 9)

    # Client
    draw_rounded_rect(canv, 300, h - 65, 180, 30, 6, PURPLE)
    draw_text_in_box(canv, "CLIENT (Browser)", 300, h - 65, 180, 30, 9)

    # SSE Events
    events = [
        ("thinking", "Analyzing data...", INFO),
        ("component", "Chart {type: bar, data: [...]}", SUCCESS),
        ("text", "Here's the analysis...", BLUE),
        ("component", "FileTree {files: [...]}", SUCCESS),
        ("component", "ApprovalGate {actions}", WARNING),
        ("done", "Stream complete", LIGHT_TEXT),
    ]

    for i, (evt_type, content, color) in enumerate(events):
        y = h - 100 - i * 38
        draw_rounded_rect(canv, 30, y, 450, 28, 4, HexColor("#ffffff"), color, 1)
        canv.saveState()
        canv.setFont("Helvetica-Bold", 8)
        canv.setFillColor(color)
        canv.drawString(40, y + 16, f"SSE: {evt_type}")
        canv.setFont("Helvetica", 8)
        canv.setFillColor(DARK_TEXT)
        canv.drawString(40, y + 4, content[:60])
        # Arrow
        canv.setStrokeColor(color)
        canv.setLineWidth(1)
        canv.line(200, y + 14, 300, y + 14)
        # arrowhead
        canv.line(295, y + 18, 300, y + 14)
        canv.line(295, y + 10, 300, y + 14)
        canv.restoreState()


def draw_deployment_options(canv, w, h):
    """Draw deployment options diagram"""
    draw_rounded_rect(canv, 0, 0, w, h, 8, HexColor("#f8f9fa"), BORDER, 2)

    canv.saveState()
    canv.setFont("Helvetica-Bold", 14)
    canv.setFillColor(PRIMARY)
    canv.drawString(w/2 - 70, h - 25, "Deployment Options")
    canv.restoreState()

    options = [
        ("Option A: Home Server", "Your PC / NUC\nDocker Compose\nCloudflare Tunnel\n(Free, Private)", SUCCESS),
        ("Option B: VPS", "Hetzner / DO / AWS\nAlways Online\nStatic IP\nLet's Encrypt SSL", BLUE),
        ("Option C: Hybrid", "VPS = Platform\nHome GPU = Ollama\nWireGuard VPN\nBest of Both", PURPLE),
    ]

    box_w = 150
    gap = 15
    start_x = (w - 3 * box_w - 2 * gap) / 2
    for i, (title, desc, color) in enumerate(options):
        x = start_x + i * (box_w + gap)
        draw_rounded_rect(canv, x, h - 70, box_w, 30, 6, color)
        draw_text_in_box(canv, title, x, h - 70, box_w, 30, 8.5)
        draw_rounded_rect(canv, x, h - 180, box_w, 100, 6, WHITE, color, 1.5)
        draw_text_in_box(canv, desc, x, h - 180, box_w, 100, 8, DARK_TEXT, 'Helvetica')


# ============================================================
# HELPER FUNCTIONS
# ============================================================

def make_table(data, col_widths=None, header_color=PRIMARY):
    """Create a styled table"""
    if col_widths is None:
        col_widths = [100] * len(data[0])

    # Wrap cells in paragraphs
    table_data = []
    for i, row in enumerate(data):
        new_row = []
        for j, cell in enumerate(row):
            if i == 0:
                new_row.append(Paragraph(str(cell), styles['TableHeader']))
            else:
                new_row.append(Paragraph(str(cell), styles['TableCell']))
        table_data.append(new_row)

    t = Table(table_data, colWidths=col_widths, repeatRows=1)
    style_commands = [
        ('BACKGROUND', (0, 0), (-1, 0), header_color),
        ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
        ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 10),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 10),
        ('TOPPADDING', (0, 0), (-1, 0), 10),
        ('BACKGROUND', (0, 1), (-1, -1), WHITE),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, BG_LIGHT]),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 1), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 6),
    ]
    t.setStyle(TableStyle(style_commands))
    return t


def section_divider():
    return HRFlowable(width="100%", thickness=1, color=BORDER, spaceBefore=8, spaceAfter=8)


def bullet(text):
    return Paragraph(f"<bullet>&bull;</bullet> {text}", styles['BulletItem'])


def bold_text(text):
    return f"<b>{text}</b>"


# ============================================================
# COVER PAGE
# ============================================================

def create_cover_page(canv, doc):
    canv.saveState()
    # Background gradient
    canv.setFillColor(PRIMARY)
    canv.rect(0, 0, letter[0], letter[1], fill=1, stroke=0)

    # Accent stripe
    canv.setFillColor(HIGHLIGHT)
    canv.rect(0, letter[1] * 0.42, letter[0], 4, fill=1, stroke=0)

    # Subtle grid pattern
    canv.setStrokeColor(HexColor("#252547"))
    canv.setLineWidth(0.5)
    for x in range(0, int(letter[0]), 40):
        canv.line(x, 0, x, letter[1])
    for y in range(0, int(letter[1]), 40):
        canv.line(0, y, letter[0], y)

    # Title area
    canv.setFillColor(WHITE)
    canv.setFont("Helvetica-Bold", 42)
    canv.drawCentredString(letter[0]/2, letter[1] * 0.65, "Agentic RAG Platform")

    canv.setFont("Helvetica", 18)
    canv.setFillColor(HexColor("#b2bec3"))
    canv.drawCentredString(letter[0]/2, letter[1] * 0.60, "Complete Architecture & Implementation Guide")

    canv.setFont("Helvetica", 14)
    canv.setFillColor(HIGHLIGHT)
    canv.drawCentredString(letter[0]/2, letter[1] * 0.55, "Self-Hosted AI Development Platform")

    # Feature boxes
    features = [
        "MoE Architecture",
        "GenUI Streaming",
        "Hybrid RAG Search",
        "30+ AI Tools",
        "Multi-LLM Router",
        "Graph Orchestration"
    ]
    box_w = 130
    box_h = 28
    cols = 3
    rows = 2
    start_x = (letter[0] - cols * box_w - (cols - 1) * 10) / 2
    start_y = letter[1] * 0.36

    for i, feat in enumerate(features):
        row = i // cols
        col = i % cols
        x = start_x + col * (box_w + 10)
        y = start_y - row * (box_h + 8)
        canv.setFillColor(ACCENT)
        canv.roundRect(x, y, box_w, box_h, 4, fill=1, stroke=0)
        canv.setFillColor(WHITE)
        canv.setFont("Helvetica-Bold", 9)
        tw = canv.stringWidth(feat, "Helvetica-Bold", 9)
        canv.drawString(x + (box_w - tw)/2, y + 10, feat)

    # Bottom info
    canv.setFillColor(LIGHT_TEXT)
    canv.setFont("Helvetica", 11)
    canv.drawCentredString(letter[0]/2, letter[1] * 0.15, f"Version 1.0  |  {datetime.now().strftime('%B %Y')}")
    canv.setFont("Helvetica", 10)
    canv.drawCentredString(letter[0]/2, letter[1] * 0.12, "Docker Compose  |  Node.js + Hono  |  PostgreSQL + ChromaDB + Redis")
    canv.drawCentredString(letter[0]/2, letter[1] * 0.09, "OpenAI  |  Anthropic  |  Google  |  Mistral  |  Groq  |  Ollama")

    canv.restoreState()


def page_header_footer(canv, doc):
    canv.saveState()
    # Header line
    canv.setStrokeColor(HIGHLIGHT)
    canv.setLineWidth(2)
    canv.line(50, letter[1] - 40, letter[0] - 50, letter[1] - 40)

    canv.setFont("Helvetica-Bold", 8)
    canv.setFillColor(PRIMARY)
    canv.drawString(50, letter[1] - 35, "Agentic RAG Platform")
    canv.setFont("Helvetica", 8)
    canv.setFillColor(LIGHT_TEXT)
    canv.drawRightString(letter[0] - 50, letter[1] - 35, "Architecture & Implementation Guide")

    # Footer
    canv.setStrokeColor(BORDER)
    canv.setLineWidth(0.5)
    canv.line(50, 40, letter[0] - 50, 40)
    canv.setFont("Helvetica", 8)
    canv.setFillColor(LIGHT_TEXT)
    canv.drawCentredString(letter[0]/2, 28, f"Page {doc.page}")
    canv.drawString(50, 28, f"Generated: {datetime.now().strftime('%Y-%m-%d')}")
    canv.drawRightString(letter[0] - 50, 28, "Confidential")

    canv.restoreState()


# ============================================================
# BUILD THE PDF
# ============================================================

def build_pdf():
    filename = "/home/user/webapp/Agentic_RAG_Platform_Architecture_Guide.pdf"

    doc = SimpleDocTemplate(
        filename,
        pagesize=letter,
        topMargin=55,
        bottomMargin=55,
        leftMargin=50,
        rightMargin=50,
        title="Agentic RAG Platform - Architecture & Implementation Guide",
        author="AI Architecture Team"
    )

    story = []

    # ========================================
    # TABLE OF CONTENTS
    # ========================================
    story.append(PageBreak())

    story.append(Paragraph("Table of Contents", styles['SectionHeader']))
    story.append(Spacer(1, 12))

    toc_items = [
        ("1.", "Executive Summary", "Overview of the platform and its capabilities"),
        ("2.", "System Architecture", "Complete architecture diagram and component breakdown"),
        ("3.", "Orchestration Engine", "LangGraph-based graph orchestrator with MoE routing"),
        ("4.", "RAG Pipeline", "Hybrid search with BM25 + Vector + Reciprocal Rank Fusion"),
        ("5.", "Multi-LLM Router", "Mixture-of-Experts routing across 6+ LLM providers"),
        ("6.", "GenUI Streaming Protocol", "Server-Sent Events for streaming UI components"),
        ("7.", "Tool Registry", "30+ tools for file, shell, Git, deploy, and more"),
        ("8.", "Data Architecture", "PostgreSQL, Redis, ChromaDB, and filesystem design"),
        ("9.", "Frontend Dashboard", "GenUI dashboard with file explorer, editor, terminal"),
        ("10.", "Deployment Guide", "Docker Compose setup for self-hosted deployment"),
        ("11.", "Hardware Requirements", "Tier 1/2/3 specs and cost analysis"),
        ("12.", "Security & Authentication", "API key management, auth, and sandboxing"),
        ("13.", "Feature Roadmap", "Complete feature map and development phases"),
        ("14.", "Quick Start Guide", "Get running in 5 minutes with Docker Compose"),
    ]

    for num, title, desc in toc_items:
        story.append(Paragraph(
            f"<b>{num}</b> &nbsp;&nbsp; <b>{title}</b> &mdash; <i>{desc}</i>",
            styles['BodyText2']
        ))
        story.append(Spacer(1, 2))

    # ========================================
    # SECTION 1: EXECUTIVE SUMMARY
    # ========================================
    story.append(PageBreak())
    story.append(ColoredBox("1. EXECUTIVE SUMMARY", PRIMARY, WHITE, height=36, font_size=14))
    story.append(Spacer(1, 16))

    story.append(Paragraph(
        "The <b>Agentic RAG Platform</b> is a self-hosted AI development environment that combines "
        "Generative UI (GenUI), Retrieval-Augmented Generation (RAG), and an autonomous agent orchestration "
        "engine into a single, deployable platform. It enables users to build, test, and deploy web applications "
        "through natural language interaction with an AI that can see, edit, and manage code in real-time.",
        styles['BodyText2']
    ))

    story.append(Spacer(1, 8))
    story.append(Paragraph(bold_text("Core Capabilities:"), styles['SubSubHeader']))

    capabilities = [
        "<b>Super Agent Orchestration</b> &mdash; A graph-based orchestrator (LangGraph pattern) that coordinates "
        "specialized sub-agents (RAG, Code, Deploy, Design) with conditional routing, parallel execution, "
        "and human-in-the-loop breakpoints.",
        "<b>Mixture-of-Experts (MoE) LLM Routing</b> &mdash; Intelligent routing across 6+ LLM providers "
        "(OpenAI, Anthropic, Google, Mistral, Groq, Ollama) selecting the best model for each sub-task.",
        "<b>Hybrid RAG Search</b> &mdash; Combines vector similarity search (ChromaDB) with BM25 lexical search "
        "(PostgreSQL) using Reciprocal Rank Fusion (RRF) for superior retrieval accuracy.",
        "<b>GenUI Streaming</b> &mdash; Server-Sent Events (SSE) protocol that streams interactive UI components "
        "(charts, file trees, code blocks, approval gates) to the browser in real-time.",
        "<b>30+ Integrated Tools</b> &mdash; File system operations, shell execution, GitHub API, deployment "
        "pipelines (Cloudflare Pages, Vercel), web search, code analysis, and more.",
        "<b>Self-Hosted & Private</b> &mdash; Runs entirely on your infrastructure via Docker Compose. "
        "No data leaves your server except API calls to LLM providers.",
    ]
    for cap in capabilities:
        story.append(bullet(cap))

    story.append(Spacer(1, 12))
    story.append(Paragraph(
        '<b>Key Design Decision:</b> The orchestration uses <b>emergent routing via LLM tool calls</b>, '
        'not regex or rule-based dispatch. The router LLM receives the user query and available sub-agents '
        'as tool definitions, then "calls" the appropriate agents. This makes routing composable and '
        'self-improving as new agents are added.',
        styles['Callout']
    ))

    # ========================================
    # SECTION 2: SYSTEM ARCHITECTURE
    # ========================================
    story.append(PageBreak())
    story.append(ColoredBox("2. SYSTEM ARCHITECTURE", PRIMARY, WHITE, height=36, font_size=14))
    story.append(Spacer(1, 16))

    story.append(Paragraph(
        "The platform follows a layered architecture designed for self-hosted deployment on a single server "
        "(or distributed across multiple machines for scale). All components are containerized with Docker.",
        styles['BodyText2']
    ))

    story.append(Spacer(1, 8))
    story.append(DiagramBox(500, 410, draw_system_architecture))
    story.append(Paragraph("Figure 1: Complete self-hosted system architecture", styles['Caption']))

    story.append(Spacer(1, 8))
    story.append(Paragraph(bold_text("Component Breakdown:"), styles['SubSubHeader']))

    arch_table = [
        ["Layer", "Component", "Technology", "Purpose"],
        ["Proxy", "NGINX", "nginx:alpine", "SSL termination, rate limiting, WebSocket upgrade, static cache"],
        ["App", "Main Server", "Hono + Node.js", "API routes, SSE streaming, WebSocket, static serving"],
        ["App", "Preview Server", "Express/Hono", "Serves workspace builds for live iframe preview"],
        ["Engine", "Agent Orchestrator", "Custom TypeScript", "Graph-based agent coordination with ReAct loop"],
        ["Engine", "MoE Router", "Custom TypeScript", "LLM selection based on task type and model capabilities"],
        ["Engine", "Tool Registry", "Plugin system", "30+ tools with schema validation (Zod)"],
        ["Data", "PostgreSQL", "postgres:16", "Users, projects, chat history, audit logs, BM25 full-text index"],
        ["Data", "Redis", "redis:7-alpine", "Sessions, caching, pub/sub, rate limiting, BullMQ task queue"],
        ["Data", "ChromaDB", "chromadb:latest", "Vector embeddings for RAG document retrieval"],
        ["Data", "Filesystem", "Docker volume", "Workspace project files, uploads, temp storage"],
        ["LLM", "API Providers", "REST APIs", "OpenAI, Anthropic, Google, Mistral, Groq"],
        ["LLM", "Local Models", "Ollama", "Optional: Llama 3.1, CodeLlama, Mistral, embedding models"],
    ]
    story.append(make_table(arch_table, [45, 85, 100, 240]))

    # ========================================
    # SECTION 3: ORCHESTRATION ENGINE
    # ========================================
    story.append(PageBreak())
    story.append(ColoredBox("3. ORCHESTRATION ENGINE", PRIMARY, WHITE, height=36, font_size=14))
    story.append(Spacer(1, 16))

    story.append(Paragraph(
        "The orchestration engine is the brain of the platform. Unlike simple sequential chains (LangChain), "
        "it implements a <b>graph-based execution model</b> inspired by LangGraph. This enables cycles "
        "(retry loops), conditional edges (if/else routing), parallel fan-out, and human-in-the-loop breakpoints.",
        styles['BodyText2']
    ))

    story.append(Spacer(1, 8))
    story.append(DiagramBox(500, 380, draw_orchestration_graph))
    story.append(Paragraph("Figure 2: Graph-based orchestration with LangGraph pattern", styles['Caption']))

    story.append(Spacer(1, 8))
    story.append(Paragraph(bold_text("Key Components of the Orchestration Loop:"), styles['SubSubHeader']))

    orch_components = [
        "<b>Controller (Router Agent)</b> &mdash; The core LLM that analyzes user intent and decides which "
        "sub-agents to invoke. Uses structured tool calls for emergent routing.",
        "<b>Sub-Agents</b> &mdash; Specialized agents for RAG retrieval, code generation, deployment, "
        "design, and testing. Each has its own tools and context window.",
        "<b>Reviewer</b> &mdash; An LLM judge that evaluates the output of sub-agents for correctness, "
        "security, and completeness. Can trigger retry loops.",
        "<b>State Machine</b> &mdash; Tracks the execution state (pending, running, reviewing, waiting_human, "
        "complete, failed) with full audit trail.",
        "<b>Human Breakpoints</b> &mdash; Configurable pause points before destructive operations (deploy, "
        "delete), high-cost operations, or when agent confidence is low.",
        "<b>Output Aggregation</b> &mdash; Combines results from parallel sub-agents into a coherent "
        "response, resolving conflicts and deduplication.",
    ]
    for comp in orch_components:
        story.append(bullet(comp))

    story.append(Spacer(1, 12))
    story.append(Paragraph(
        '<b>Why Graph, Not Chain?</b> A flat chain breaks when: (1) the code agent needs to loop back '
        'for RAG context mid-generation, (2) the test agent fails and needs the code agent to fix and '
        'retry, (3) multiple agents need to run in parallel, (4) the user needs to approve before '
        'deployment. Graphs handle all of these natively.',
        styles['WarningCallout']
    ))

    # ========================================
    # SECTION 4: RAG PIPELINE
    # ========================================
    story.append(PageBreak())
    story.append(ColoredBox("4. RAG PIPELINE (HYBRID SEARCH)", PRIMARY, WHITE, height=36, font_size=14))
    story.append(Spacer(1, 16))

    story.append(Paragraph(
        "The RAG pipeline uses a <b>hybrid retrieval strategy</b> combining semantic vector search with "
        "BM25 lexical search. This dual approach ensures that both conceptual queries ('how to handle "
        "authentication') and exact-match queries ('CORS Access-Control-Allow-Origin header') return "
        "relevant results.",
        styles['BodyText2']
    ))

    story.append(Spacer(1, 8))
    story.append(DiagramBox(500, 310, draw_hybrid_search))
    story.append(Paragraph("Figure 3: Hybrid search with Reciprocal Rank Fusion", styles['Caption']))

    story.append(Spacer(1, 8))
    story.append(Paragraph(bold_text("RAG Pipeline Stages:"), styles['SubSubHeader']))

    rag_stages = [
        ["Stage", "Process", "Technology", "Details"],
        ["1. Ingest", "Document upload", "API endpoint", "PDF, Markdown, HTML, code files, web URLs"],
        ["2. Parse", "Content extraction", "pdf-parse, cheerio", "Extract text, preserve structure/headings"],
        ["3. Chunk", "Semantic splitting", "Custom splitter", "Split by headings, paragraphs; 500-token chunks with 50-token overlap"],
        ["4. Embed", "Vector encoding", "OpenAI / nomic", "text-embedding-3-small (1536d) or nomic-embed-text (local)"],
        ["5. Index", "Dual storage", "ChromaDB + PG", "Vectors in ChromaDB; text + BM25 tsvector in PostgreSQL"],
        ["6. Query", "Hybrid search", "Vector + BM25", "Parallel search, then Reciprocal Rank Fusion (k=60)"],
        ["7. Rerank", "Quality filter", "LLM or cross-enc", "Optional LLM-as-judge to re-score top results"],
        ["8. Generate", "Answer synthesis", "GPT-4o / Claude", "Top 5 chunks injected into prompt as context"],
    ]
    story.append(make_table(rag_stages, [45, 80, 90, 255]))

    story.append(Spacer(1, 12))
    story.append(Paragraph(bold_text("Reciprocal Rank Fusion (RRF) Formula:"), styles['SubSubHeader']))
    story.append(Paragraph(
        "For each document <i>d</i> appearing in result sets from vector and BM25 search:<br/><br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;<b>RRF_score(d) = 1/(k + rank_vector(d)) + 1/(k + rank_bm25(d))</b><br/><br/>"
        "Where <b>k = 60</b> (standard constant). Documents are then sorted by RRF_score descending. "
        "This naturally boosts documents that appear highly in BOTH result sets while still including "
        "documents that score well in only one.",
        styles['Callout']
    ))

    # ========================================
    # SECTION 5: MULTI-LLM ROUTER
    # ========================================
    story.append(PageBreak())
    story.append(ColoredBox("5. MULTI-LLM ROUTER (Mixture-of-Experts)", PRIMARY, WHITE, height=36, font_size=14))
    story.append(Spacer(1, 16))

    story.append(Paragraph(
        "The MoE Router automatically selects the optimal LLM for each sub-task based on the task type, "
        "required capabilities, latency requirements, and cost constraints. This is NOT a simple round-robin "
        "&mdash; it's an intelligent routing layer that matches task characteristics to model strengths.",
        styles['BodyText2']
    ))

    story.append(Spacer(1, 8))
    story.append(Paragraph(bold_text("LLM Provider Matrix:"), styles['SubSubHeader']))

    llm_table = [
        ["Provider", "Models", "Best For", "Speed", "Cost"],
        ["OpenAI", "GPT-4o, GPT-4o-mini", "Code generation, general reasoning, tool use", "Medium", "$$"],
        ["Anthropic", "Claude 3.5 Sonnet, Haiku", "Code review, long context, safety analysis", "Medium", "$$"],
        ["Google", "Gemini 2.0 Flash/Pro", "Multi-modal, fast reasoning, large context", "Fast", "$"],
        ["Mistral", "Mistral Large, Small", "European hosting, multilingual, efficient", "Fast", "$"],
        ["Groq", "Llama 3.1 70B/8B", "Ultra-fast inference (~500 tok/s), prototyping", "Fastest", "$"],
        ["Ollama", "Any local model", "Privacy, no API cost, offline operation", "Varies", "Free"],
    ]
    story.append(make_table(llm_table, [60, 95, 160, 55, 40]))

    story.append(Spacer(1, 12))
    story.append(Paragraph(bold_text("Routing Strategy:"), styles['SubSubHeader']))

    routing_table = [
        ["Task Type", "Primary Model", "Fallback", "Reasoning"],
        ["Code Generation", "GPT-4o", "Claude 3.5 Sonnet", "Best structured output and tool calling"],
        ["Code Review", "Claude 3.5 Sonnet", "GPT-4o", "Superior at finding edge cases and security issues"],
        ["RAG Retrieval", "GPT-4o-mini", "Gemini Flash", "Fast, cheap, good at query reformulation"],
        ["Planning", "GPT-4o", "Claude 3.5 Sonnet", "Best at decomposing complex tasks into steps"],
        ["Quick Classification", "Groq (Llama 3.1 8B)", "GPT-4o-mini", "Ultra-fast for simple routing decisions"],
        ["Long Context", "Claude 3.5 Sonnet (200K)", "Gemini Pro (1M)", "Best at maintaining coherence over long inputs"],
        ["Embedding", "text-embedding-3-small", "nomic-embed-text", "Best quality/cost ratio for RAG"],
        ["Local/Private", "Ollama (any)", "N/A", "When data cannot leave the server"],
    ]
    story.append(make_table(routing_table, [90, 105, 100, 175]))

    story.append(Spacer(1, 12))
    story.append(Paragraph(
        '<b>Cost Optimization:</b> The router tracks token usage and cost per model. For high-volume tasks '
        '(like chunking 1000 documents), it automatically downgrades to cheaper models (GPT-4o-mini, Groq) '
        'while reserving premium models (GPT-4o, Claude) for complex reasoning tasks. Expected monthly cost: '
        '$10-30 for moderate use, $50-100 for heavy use.',
        styles['SuccessCallout']
    ))

    # ========================================
    # SECTION 6: GENUI STREAMING PROTOCOL
    # ========================================
    story.append(PageBreak())
    story.append(ColoredBox("6. GenUI STREAMING PROTOCOL", PRIMARY, WHITE, height=36, font_size=14))
    story.append(Spacer(1, 16))

    story.append(Paragraph(
        "GenUI (Generative UI) allows the AI to stream interactive UI components to the browser in real-time, "
        "not just text. When the agent decides to show a chart, file tree, or approval button, it sends a "
        "structured SSE event that the frontend renders as a live React-like component.",
        styles['BodyText2']
    ))

    story.append(Spacer(1, 8))
    story.append(DiagramBox(500, 320, draw_genui_stream))
    story.append(Paragraph("Figure 4: GenUI SSE streaming protocol", styles['Caption']))

    story.append(Spacer(1, 8))
    story.append(Paragraph(bold_text("SSE Event Types:"), styles['SubSubHeader']))

    sse_table = [
        ["Event Type", "Payload", "Frontend Action"],
        ["thinking", '{content: "Analyzing..."}', "Shows animated thinking indicator with message"],
        ["text", '{content: "Here is...", delta: true}', "Appends text token-by-token (streaming)"],
        ["component", '{name: "Chart", props: {...}}', "Renders interactive component (Chart, Table, FileTree, etc.)"],
        ["tool_call", '{tool: "shell_exec", args: {...}}', "Shows tool execution in trace viewer"],
        ["tool_result", '{tool: "shell_exec", result: {...}}', "Shows tool output in trace viewer"],
        ["approval", '{message: "Deploy?", actions: [...]}', "Renders approval gate, pauses until user responds"],
        ["error", '{message: "Failed to...", code: 500}', "Shows error notification with retry option"],
        ["done", '{usage: {tokens: 1500, cost: 0.02}}', "Closes stream, shows usage summary"],
    ]
    story.append(make_table(sse_table, [65, 175, 230]))

    story.append(Spacer(1, 12))
    story.append(Paragraph(bold_text("Available GenUI Components:"), styles['SubSubHeader']))

    comp_list = [
        "<b>Chart</b> &mdash; Bar, line, pie, area charts via Chart.js. Auto-rendered from data.",
        "<b>FileTree</b> &mdash; Interactive file explorer synced with real workspace filesystem.",
        "<b>CodeBlock</b> &mdash; Syntax-highlighted code with copy button and language detection.",
        "<b>Terminal</b> &mdash; Live terminal output with ANSI color support.",
        "<b>Table</b> &mdash; Sortable, filterable data tables for structured output.",
        "<b>Markdown</b> &mdash; Rich markdown rendering with math, diagrams, and code blocks.",
        "<b>ApprovalGate</b> &mdash; Approve/reject/edit buttons for human-in-the-loop control.",
        "<b>DeployProgress</b> &mdash; Step-by-step deployment progress tracker.",
        "<b>DiffViewer</b> &mdash; Side-by-side or unified diff view for code changes.",
        "<b>ImagePreview</b> &mdash; Generated or fetched images with zoom and download.",
    ]
    for comp in comp_list:
        story.append(bullet(comp))

    # ========================================
    # SECTION 7: TOOL REGISTRY
    # ========================================
    story.append(PageBreak())
    story.append(ColoredBox("7. TOOL REGISTRY (30+ Tools)", PRIMARY, WHITE, height=36, font_size=14))
    story.append(Spacer(1, 16))

    story.append(Paragraph(
        "The tool registry is a plugin-based system where each tool is defined with a Zod schema for input "
        "validation, a description for the LLM, and an execute function. Tools are automatically available "
        "to any sub-agent that needs them.",
        styles['BodyText2']
    ))

    story.append(Spacer(1, 8))

    # Split tools into categories
    tool_categories = [
        ("File System Tools", [
            ["read_file", "Read contents of a file from workspace", "path: string"],
            ["write_file", "Create or overwrite a file", "path: string, content: string"],
            ["list_directory", "List files and directories", "path: string, recursive?: boolean"],
            ["delete_file", "Delete a file or directory", "path: string"],
            ["search_files", "Search file contents with regex", "pattern: string, path?: string"],
            ["file_info", "Get file metadata (size, modified, type)", "path: string"],
        ]),
        ("Shell & System Tools", [
            ["shell_exec", "Execute a shell command in workspace", "command: string, cwd?: string"],
            ["npm_install", "Install npm packages", "packages: string[]"],
            ["npm_run", "Run npm script", "script: string"],
            ["process_list", "List running processes", "filter?: string"],
            ["system_info", "Get system resource usage", "None"],
        ]),
        ("Git & GitHub Tools", [
            ["git_init", "Initialize a git repository", "path: string"],
            ["git_commit", "Stage and commit changes", "message: string, files?: string[]"],
            ["git_push", "Push to remote repository", "remote?: string, branch?: string"],
            ["github_create_repo", "Create a new GitHub repository", "name: string, private?: boolean"],
            ["github_create_pr", "Create a pull request", "title: string, body: string, branch: string"],
            ["github_list_repos", "List user's repositories", "org?: string"],
            ["github_read_file", "Read file from GitHub repo", "owner: string, repo: string, path: string"],
            ["github_edit_file", "Edit file in GitHub repo", "owner: string, repo: string, path: string, content: string"],
        ]),
    ]

    for cat_name, tools in tool_categories:
        story.append(Paragraph(bold_text(cat_name), styles['SubSubHeader']))
        table_data = [["Tool Name", "Description", "Key Parameters"]]
        table_data.extend(tools)
        story.append(make_table(table_data, [100, 210, 160]))
        story.append(Spacer(1, 8))

    story.append(PageBreak())

    tool_categories_2 = [
        ("Deployment Tools", [
            ["deploy_cloudflare", "Deploy to Cloudflare Pages", "project_name: string, dist_dir: string"],
            ["deploy_vercel", "Deploy to Vercel", "project_name: string"],
            ["deploy_status", "Check deployment status", "deployment_id: string"],
            ["deploy_preview", "Start local preview server", "workspace: string, port?: number"],
        ]),
        ("Web & Research Tools", [
            ["web_search", "Search the web (Google/Bing)", "query: string, num_results?: number"],
            ["web_scrape", "Scrape content from a URL", "url: string, selector?: string"],
            ["web_fetch", "Fetch raw content from URL", "url: string"],
        ]),
        ("Code Analysis Tools", [
            ["code_analyze", "Analyze code for issues/improvements", "code: string, language: string"],
            ["code_explain", "Explain what code does", "code: string"],
            ["code_test", "Generate tests for code", "code: string, framework?: string"],
            ["code_refactor", "Suggest refactoring improvements", "code: string"],
        ]),
        ("RAG & Knowledge Tools", [
            ["rag_ingest", "Ingest document into knowledge base", "content: string, metadata?: object"],
            ["rag_query", "Search knowledge base", "query: string, top_k?: number"],
            ["rag_list_docs", "List ingested documents", "collection?: string"],
            ["rag_delete_doc", "Remove document from knowledge base", "doc_id: string"],
        ]),
        ("Database Tools", [
            ["db_query", "Execute SQL query (read-only)", "sql: string"],
            ["db_execute", "Execute SQL write operation", "sql: string, params?: any[]"],
            ["db_schema", "Get database schema information", "table?: string"],
        ]),
    ]

    for cat_name, tools in tool_categories_2:
        story.append(Paragraph(bold_text(cat_name), styles['SubSubHeader']))
        table_data = [["Tool Name", "Description", "Key Parameters"]]
        table_data.extend(tools)
        story.append(make_table(table_data, [105, 210, 155]))
        story.append(Spacer(1, 8))

    # ========================================
    # SECTION 8: DATA ARCHITECTURE
    # ========================================
    story.append(PageBreak())
    story.append(ColoredBox("8. DATA ARCHITECTURE", PRIMARY, WHITE, height=36, font_size=14))
    story.append(Spacer(1, 16))

    story.append(Paragraph(bold_text("PostgreSQL Schema (Core Data):"), styles['SubSubHeader']))

    pg_tables = [
        ["Table", "Purpose", "Key Columns"],
        ["users", "User accounts and auth", "id, email, name, api_keys (encrypted), created_at"],
        ["projects", "Workspace projects", "id, user_id, name, workspace_path, config (JSONB), status"],
        ["conversations", "Chat sessions", "id, project_id, title, model, created_at"],
        ["messages", "Chat messages", "id, conversation_id, role, content, tool_calls (JSONB), tokens_used"],
        ["documents", "RAG source documents", "id, title, source_url, content, chunk_count, tsvector (BM25)"],
        ["chunks", "Document chunks for RAG", "id, document_id, content, embedding_id, token_count, tsvector"],
        ["tool_executions", "Audit log of tool calls", "id, message_id, tool_name, input, output, duration_ms"],
        ["deployments", "Deployment history", "id, project_id, platform, url, status, logs, created_at"],
    ]
    story.append(make_table(pg_tables, [85, 120, 265]))

    story.append(Spacer(1, 12))
    story.append(Paragraph(bold_text("Redis Data Structures:"), styles['SubSubHeader']))

    redis_table = [
        ["Key Pattern", "Type", "Purpose", "TTL"],
        ["session:{id}", "Hash", "User session data", "24h"],
        ["cache:llm:{hash}", "String", "LLM response cache (identical queries)", "1h"],
        ["rate:{user}:{endpoint}", "Counter", "API rate limiting", "1min"],
        ["ws:connections", "Set", "Active WebSocket connection IDs", "None"],
        ["queue:agent:*", "BullMQ", "Agent task queue for async processing", "24h"],
        ["pubsub:workspace:{id}", "Channel", "Real-time workspace file change notifications", "None"],
    ]
    story.append(make_table(redis_table, [110, 55, 220, 50]))

    story.append(Spacer(1, 12))
    story.append(Paragraph(bold_text("ChromaDB Collections:"), styles['SubSubHeader']))

    chroma_table = [
        ["Collection", "Embedding Model", "Dimensions", "Purpose"],
        ["agentic_rag_docs", "text-embedding-3-small", "1536", "Primary RAG document chunks"],
        ["code_embeddings", "text-embedding-3-small", "1536", "Code file embeddings for code search"],
        ["conversation_memory", "text-embedding-3-small", "1536", "Long-term conversation context"],
    ]
    story.append(make_table(chroma_table, [120, 130, 70, 150]))

    # ========================================
    # SECTION 9: FRONTEND DASHBOARD
    # ========================================
    story.append(PageBreak())
    story.append(ColoredBox("9. FRONTEND DASHBOARD (GenUI)", PRIMARY, WHITE, height=36, font_size=14))
    story.append(Spacer(1, 16))

    story.append(Paragraph(
        "The frontend is a single-page application served as static HTML/CSS/JS from the Hono server. "
        "It uses Tailwind CSS for styling, no build step required for frontend changes. The dashboard "
        "provides a complete AI development environment in the browser.",
        styles['BodyText2']
    ))

    story.append(Spacer(1, 8))
    story.append(Paragraph(bold_text("Dashboard Layout:"), styles['SubSubHeader']))

    layout_desc = """
    The dashboard uses a three-panel layout optimized for AI-assisted development:
    """
    story.append(Paragraph(layout_desc.strip(), styles['BodyText2']))

    layout_table = [
        ["Panel", "Position", "Contents", "Features"],
        ["Sidebar", "Left (280px)", "File Explorer, Project List, Settings", "Tree view, drag-drop, context menu, workspace sync"],
        ["Main Chat", "Center (flex)", "Chat interface, GenUI components", "SSE streaming, component rendering, markdown, code blocks"],
        ["Inspector", "Right (350px)", "Agent Trace, Terminal, Preview", "Step-by-step trace, xterm.js terminal, live preview iframe"],
    ]
    story.append(make_table(layout_table, [60, 80, 150, 180]))

    story.append(Spacer(1, 12))
    story.append(Paragraph(bold_text("Frontend Technology Stack:"), styles['SubSubHeader']))

    frontend_tech = [
        "<b>Tailwind CSS</b> (CDN) &mdash; Utility-first styling, dark mode support",
        "<b>Font Awesome</b> (CDN) &mdash; Icons for UI elements",
        "<b>Monaco Editor</b> (CDN) &mdash; VS Code's editor for code editing",
        "<b>xterm.js</b> (CDN) &mdash; Terminal emulator connected via WebSocket",
        "<b>Chart.js</b> (CDN) &mdash; Charts for GenUI component rendering",
        "<b>Marked.js</b> (CDN) &mdash; Markdown rendering for chat messages",
        "<b>Highlight.js</b> (CDN) &mdash; Syntax highlighting in code blocks",
        "<b>Vanilla JS</b> &mdash; No React/Vue build step; pure JS with custom component system",
    ]
    for tech in frontend_tech:
        story.append(bullet(tech))

    story.append(Spacer(1, 12))
    story.append(Paragraph(
        '<b>Why Vanilla JS?</b> By avoiding React/Vue/Svelte, we eliminate the build step for frontend '
        'changes. Edit an HTML or JS file, refresh the browser, and see changes instantly. The GenUI '
        'component system uses a custom lightweight renderer (~200 lines) that maps SSE component events '
        'to DOM elements. This keeps the frontend under 50KB total.',
        styles['Callout']
    ))

    # ========================================
    # SECTION 10: DEPLOYMENT GUIDE
    # ========================================
    story.append(PageBreak())
    story.append(ColoredBox("10. DEPLOYMENT GUIDE (Docker Compose)", PRIMARY, WHITE, height=36, font_size=14))
    story.append(Spacer(1, 16))

    story.append(Paragraph(
        "The entire platform deploys with a single <b>docker-compose up -d</b> command. All services "
        "(app, PostgreSQL, Redis, ChromaDB, Ollama) are containerized and configured to work together.",
        styles['BodyText2']
    ))

    story.append(Spacer(1, 8))
    story.append(Paragraph(bold_text("Docker Compose Services:"), styles['SubSubHeader']))

    docker_table = [
        ["Service", "Image", "Ports", "Volumes", "Purpose"],
        ["app", "node:20-alpine + custom", "3000:3000", "workspaces, uploads", "Main application"],
        ["postgres", "postgres:16-alpine", "5432:5432", "pg_data", "Relational database"],
        ["redis", "redis:7-alpine", "6379:6379", "redis_data", "Cache, queue, pub/sub"],
        ["chromadb", "chromadb/chroma:latest", "8000:8000", "chroma_data", "Vector database"],
        ["ollama", "ollama/ollama:latest", "11434:11434", "ollama_models", "Local LLMs (optional)"],
        ["nginx", "nginx:alpine", "80:80, 443:443", "nginx_conf, certs", "Reverse proxy (production)"],
    ]
    story.append(make_table(docker_table, [55, 100, 70, 80, 165]))

    story.append(Spacer(1, 12))
    story.append(Paragraph(bold_text("Quick Start (5 Minutes):"), styles['SubSubHeader']))

    steps = [
        "<b>Step 1: Clone the repository</b><br/>git clone https://github.com/your-username/agentic-rag-platform.git<br/>cd agentic-rag-platform",
        "<b>Step 2: Configure environment</b><br/>cp .env.example .env<br/>nano .env &nbsp;&nbsp;# Add your API keys (at minimum, OPENAI_API_KEY)",
        "<b>Step 3: Start all services</b><br/>docker-compose up -d",
        "<b>Step 4: Run database migrations</b><br/>docker-compose exec app npm run db:migrate",
        "<b>Step 5: Access the platform</b><br/>Open http://localhost:3000 in your browser",
    ]
    for step in steps:
        story.append(Paragraph(step, styles['BodyText2']))
        story.append(Spacer(1, 4))

    story.append(Spacer(1, 12))
    story.append(Paragraph(bold_text("Exposing to the Internet (Optional):"), styles['SubSubHeader']))

    expose_options = [
        "<b>Option A: Cloudflare Tunnel (Recommended, Free)</b> &mdash; Install cloudflared, run "
        "<i>cloudflared tunnel --url http://localhost:3000</i>. Gives you a free HTTPS URL with "
        "DDoS protection. No port forwarding needed.",
        "<b>Option B: NGINX + Let's Encrypt</b> &mdash; Point a domain to your server's IP, "
        "configure NGINX reverse proxy with SSL via certbot. Best for VPS deployment.",
        "<b>Option C: Tailscale / WireGuard</b> &mdash; Private mesh VPN for accessing from "
        "your phone/laptop without exposing to the public internet.",
    ]
    for opt in expose_options:
        story.append(bullet(opt))

    # ========================================
    # SECTION 11: HARDWARE REQUIREMENTS
    # ========================================
    story.append(PageBreak())
    story.append(ColoredBox("11. HARDWARE REQUIREMENTS", PRIMARY, WHITE, height=36, font_size=14))
    story.append(Spacer(1, 16))

    story.append(Paragraph(
        "Hardware requirements vary significantly based on whether you use cloud LLM APIs (Tier 1), "
        "run small local models alongside APIs (Tier 2), or run large local models for full independence "
        "(Tier 3). Most users should start with Tier 1.",
        styles['BodyText2']
    ))

    story.append(Spacer(1, 8))

    # Tier 1
    story.append(ColoredBox("TIER 1: API-Only Mode (Recommended Starting Point)", SUCCESS, WHITE, height=30, font_size=11))
    story.append(Spacer(1, 8))
    story.append(Paragraph(
        "All LLM inference is handled by cloud APIs (OpenAI, Anthropic, etc.). Your server only runs "
        "the application, databases, and orchestration logic.",
        styles['BodyText2']
    ))

    tier1_table = [
        ["Component", "Minimum", "Recommended", "Notes"],
        ["CPU", "4 cores", "8 cores", "Any modern x86_64 processor"],
        ["RAM", "8 GB", "16 GB", "PostgreSQL + Redis + ChromaDB + App"],
        ["Storage", "50 GB SSD", "200 GB NVMe", "Workspace files + DB + vectors"],
        ["GPU", "Not needed", "Not needed", "All inference via API"],
        ["Network", "50 Mbps", "100+ Mbps", "API calls + user traffic"],
        ["Monthly Cost (VPS)", "$20-40", "$50-80", "Hetzner, DigitalOcean, Linode"],
        ["Monthly Cost (APIs)", "$10-20", "$20-50", "Based on usage volume"],
    ]
    story.append(make_table(tier1_table, [90, 80, 95, 205]))

    story.append(Spacer(1, 12))

    # Tier 2
    story.append(ColoredBox("TIER 2: Hybrid Mode (Small Local LLMs + APIs)", BLUE, WHITE, height=30, font_size=11))
    story.append(Spacer(1, 8))
    story.append(Paragraph(
        "Run 7B-8B parameter models locally for fast, cheap tasks (classification, simple generation). "
        "Use cloud APIs for complex tasks (GPT-4o, Claude 3.5 Sonnet).",
        styles['BodyText2']
    ))

    tier2_table = [
        ["Component", "Minimum", "Recommended", "Notes"],
        ["CPU", "8 cores", "16 cores", "More cores for parallel tool execution"],
        ["RAM", "32 GB", "64 GB", "Local model loading + services"],
        ["Storage", "200 GB NVMe", "500 GB NVMe", "Model files (4-8 GB each) + data"],
        ["GPU", "RTX 3060 12GB", "RTX 4070 12-16GB", "Runs 7B-8B models at ~30 tok/s"],
        ["VRAM", "12 GB", "12-16 GB", "Minimum for quantized 7B models"],
        ["Network", "100 Mbps", "500+ Mbps", "Reduced API usage but still needed"],
        ["Build Cost", "$800-1200", "$1500-2000", "Desktop PC or workstation"],
        ["Monthly APIs", "$5-15", "$10-30", "Only for complex tasks"],
    ]
    story.append(make_table(tier2_table, [90, 90, 95, 195]))

    story.append(Spacer(1, 12))

    # Tier 3
    story.append(ColoredBox("TIER 3: Full Local Mode (Large Models, No API Dependency)", PURPLE, WHITE, height=30, font_size=11))
    story.append(Spacer(1, 8))
    story.append(Paragraph(
        "Run 70B+ parameter models locally for full independence from API providers. "
        "Best for privacy-sensitive environments or heavy usage where API costs exceed hardware amortization.",
        styles['BodyText2']
    ))

    tier3_table = [
        ["Component", "Minimum", "Recommended", "Notes"],
        ["CPU", "16 cores", "32+ cores (Threadripper)", "Model loading + parallel agents"],
        ["RAM", "64 GB", "128 GB", "Large models need RAM for context"],
        ["Storage", "1 TB NVMe", "2 TB NVMe", "Multiple large model files (30-70 GB each)"],
        ["GPU", "RTX 4090 24GB", "2x RTX 4090 or A6000 48GB", "70B models need 40+ GB VRAM"],
        ["VRAM", "24 GB", "48-80 GB", "More VRAM = larger models + longer context"],
        ["Network", "500 Mbps", "1 Gbps", "Only for user traffic (no API calls)"],
        ["Build Cost", "$3500-5000", "$8000-15000", "Workstation or server build"],
        ["Monthly APIs", "$0", "$0", "Fully self-contained"],
    ]
    story.append(make_table(tier3_table, [90, 95, 110, 175]))

    story.append(Spacer(1, 12))
    story.append(Paragraph(
        '<b>Recommendation:</b> Start with <b>Tier 1</b>. A $40/month VPS or any modern home computer '
        'with 16 GB RAM is all you need. GPT-4o and Claude 3.5 Sonnet are better than any local model '
        'for code generation. API costs are typically $10-30/month. You can always add local models later '
        '&mdash; the platform supports hot-swapping between API and local models with zero code changes.',
        styles['SuccessCallout']
    ))

    # ========================================
    # SECTION 12: SECURITY
    # ========================================
    story.append(PageBreak())
    story.append(ColoredBox("12. SECURITY & AUTHENTICATION", PRIMARY, WHITE, height=36, font_size=14))
    story.append(Spacer(1, 16))

    security_items = [
        "<b>API Key Encryption</b> &mdash; All API keys stored in PostgreSQL are encrypted at rest "
        "using AES-256. Keys are only decrypted in memory when making API calls.",
        "<b>Workspace Sandboxing</b> &mdash; Each workspace is confined to its directory. Shell commands "
        "are executed with restricted permissions (no access to /etc, /root, other workspaces).",
        "<b>Rate Limiting</b> &mdash; Redis-backed rate limiting on all API endpoints. Configurable "
        "per-user and per-endpoint limits to prevent abuse.",
        "<b>Input Validation</b> &mdash; All tool inputs are validated with Zod schemas before execution. "
        "SQL queries in the db_query tool are read-only (SELECT, EXPLAIN only).",
        "<b>Authentication</b> &mdash; JWT-based authentication with secure httpOnly cookies. "
        "Optional: integrate with Firebase Auth, Auth0, or Clerk for SSO.",
        "<b>Audit Logging</b> &mdash; Every tool execution is logged with input, output, duration, "
        "and user context. Full audit trail in the tool_executions table.",
        "<b>CORS Configuration</b> &mdash; Configurable CORS policy. Default: same-origin only. "
        "Expand as needed for API access from other domains.",
        "<b>Environment Variables</b> &mdash; All secrets stored in .env file (not committed to git). "
        "Docker secrets supported for production deployments.",
    ]
    for item in security_items:
        story.append(bullet(item))

    story.append(Spacer(1, 12))
    story.append(Paragraph(
        '<b>Security Warning:</b> This platform executes shell commands and writes files based on AI '
        'instructions. Always review the agent trace before approving destructive operations. Enable '
        'human-in-the-loop breakpoints for production use. Never expose the platform to the public '
        'internet without authentication enabled.',
        styles['WarningCallout']
    ))

    # ========================================
    # SECTION 13: FEATURE ROADMAP
    # ========================================
    story.append(PageBreak())
    story.append(ColoredBox("13. FEATURE ROADMAP", PRIMARY, WHITE, height=36, font_size=14))
    story.append(Spacer(1, 16))

    story.append(Paragraph(bold_text("Complete Feature Map:"), styles['SubSubHeader']))

    feature_map = [
        ["Category", "Feature", "Priority", "Phase"],
        ["Core", "Graph Orchestrator (LangGraph pattern)", "Critical", "Phase 1"],
        ["Core", "MoE LLM Router (6+ providers)", "Critical", "Phase 1"],
        ["Core", "ReAct Agent Loop (think-act-observe)", "Critical", "Phase 1"],
        ["Core", "Tool Registry with Zod validation", "Critical", "Phase 1"],
        ["RAG", "Document ingestion (PDF, MD, HTML, code)", "Critical", "Phase 1"],
        ["RAG", "Hybrid search (BM25 + Vector + RRF)", "Critical", "Phase 1"],
        ["RAG", "ChromaDB vector storage", "Critical", "Phase 1"],
        ["RAG", "PostgreSQL BM25 full-text search", "Critical", "Phase 1"],
        ["GenUI", "SSE streaming protocol", "Critical", "Phase 1"],
        ["GenUI", "Component rendering (Chart, Table, Code, FileTree)", "Critical", "Phase 1"],
        ["GenUI", "Agent trace visualizer", "High", "Phase 1"],
        ["UI", "Chat interface with streaming", "Critical", "Phase 1"],
        ["UI", "File explorer (real filesystem sync)", "High", "Phase 1"],
        ["UI", "Dark/light theme", "Medium", "Phase 1"],
        ["Tools", "File system tools (read, write, list, delete, search)", "Critical", "Phase 1"],
        ["Tools", "Shell execution tool", "Critical", "Phase 1"],
        ["Tools", "Git tools (init, commit, push)", "High", "Phase 1"],
        ["Tools", "Code analysis tools", "High", "Phase 2"],
        ["Tools", "GitHub API tools (repos, PRs, issues)", "High", "Phase 2"],
        ["Tools", "Deployment tools (Cloudflare, Vercel)", "High", "Phase 2"],
        ["Tools", "Web search/scrape tools", "Medium", "Phase 2"],
        ["Tools", "Database tools (query, schema)", "Medium", "Phase 2"],
        ["UI", "Monaco code editor integration", "High", "Phase 2"],
        ["UI", "xterm.js terminal emulator", "High", "Phase 2"],
        ["UI", "Live preview iframe", "High", "Phase 2"],
        ["Core", "Human-in-the-loop breakpoints", "High", "Phase 2"],
        ["Core", "Parallel agent fan-out", "High", "Phase 2"],
        ["Core", "Conversation memory (long-term)", "Medium", "Phase 2"],
        ["Deploy", "One-click Cloudflare Pages deploy", "High", "Phase 3"],
        ["Deploy", "One-click Vercel deploy", "High", "Phase 3"],
        ["Deploy", "GitHub Actions CI/CD integration", "Medium", "Phase 3"],
        ["Auth", "User authentication (JWT)", "High", "Phase 3"],
        ["Auth", "Multi-user support", "Medium", "Phase 3"],
        ["Auth", "Firebase Auth / Auth0 SSO", "Low", "Phase 3"],
        ["Mobile", "PWA (installable web app)", "Medium", "Phase 3"],
        ["Mobile", "Capacitor native wrapper", "Low", "Phase 4"],
        ["Local", "Ollama integration", "Medium", "Phase 3"],
        ["Local", "Local embedding models", "Medium", "Phase 3"],
        ["Advanced", "Custom tool creation UI", "Low", "Phase 4"],
        ["Advanced", "Multi-workspace management", "Low", "Phase 4"],
        ["Advanced", "Plugin marketplace", "Low", "Phase 4"],
    ]
    story.append(make_table(feature_map, [55, 235, 55, 55]))

    # ========================================
    # SECTION 14: QUICK START GUIDE
    # ========================================
    story.append(PageBreak())
    story.append(ColoredBox("14. QUICK START GUIDE", PRIMARY, WHITE, height=36, font_size=14))
    story.append(Spacer(1, 16))

    story.append(Paragraph(bold_text("Prerequisites:"), styles['SubSubHeader']))
    prereqs = [
        "Docker and Docker Compose installed (Docker Desktop or docker-ce)",
        "At least 8 GB RAM available",
        "At least one LLM API key (OpenAI recommended)",
        "Git installed (for cloning and version control)",
    ]
    for p in prereqs:
        story.append(bullet(p))

    story.append(Spacer(1, 12))
    story.append(Paragraph(bold_text("Installation Steps:"), styles['SubSubHeader']))

    install_steps = [
        ("<b>1. Clone the Repository</b>",
         "git clone https://github.com/your-username/agentic-rag-platform.git\ncd agentic-rag-platform"),
        ("<b>2. Configure Environment Variables</b>",
         "cp .env.example .env\n# Edit .env and add your API keys:\n# OPENAI_API_KEY=sk-...\n# (Other keys are optional)"),
        ("<b>3. Start All Services</b>",
         "docker-compose up -d\n# This starts: app, postgres, redis, chromadb\n# First run takes 2-3 minutes to pull images"),
        ("<b>4. Run Database Migrations</b>",
         "docker-compose exec app npm run db:migrate\n# Creates all required tables"),
        ("<b>5. Access the Platform</b>",
         "# Open in browser:\nhttp://localhost:3000\n\n# The GenUI dashboard should load\n# Start chatting with the AI agent!"),
        ("<b>6. (Optional) Add Local LLMs</b>",
         "# If you have a GPU and want local models:\ndocker-compose --profile ollama up -d\n# Then pull a model:\ndocker-compose exec ollama ollama pull llama3.1:8b"),
        ("<b>7. (Optional) Expose to Internet</b>",
         "# Using Cloudflare Tunnel (free):\ncloudflared tunnel --url http://localhost:3000\n\n# Or configure NGINX + Let's Encrypt for a custom domain"),
    ]

    for title, code in install_steps:
        story.append(Paragraph(title, styles['BodyText2']))
        # Use preformatted text for code blocks
        story.append(Spacer(1, 4))
        for line in code.split('\n'):
            story.append(Paragraph(
                f'<font face="Courier" size="8.5" color="#2d3436">&nbsp;&nbsp;{line}</font>',
                styles['BodyText2']
            ))
        story.append(Spacer(1, 8))

    story.append(Spacer(1, 16))
    story.append(Paragraph(bold_text("Deployment Options Comparison:"), styles['SubSubHeader']))
    story.append(Spacer(1, 8))
    story.append(DiagramBox(500, 200, draw_deployment_options))
    story.append(Paragraph("Figure 5: Three deployment options for the platform", styles['Caption']))

    story.append(Spacer(1, 16))
    story.append(section_divider())
    story.append(Spacer(1, 8))

    story.append(Paragraph(
        '<b>You are now ready to build.</b> This document contains the complete architecture, '
        'implementation details, and deployment guide for the Agentic RAG Platform. Clone the '
        'repository, add your API keys, run docker-compose up, and start building web applications '
        'with AI assistance. The platform is designed to grow with you &mdash; start with Tier 1 '
        '(API-only), add features from the roadmap as needed, and optionally add local LLMs when '
        'you want full independence.',
        styles['SuccessCallout']
    ))

    story.append(Spacer(1, 20))
    story.append(Paragraph(
        "End of Document &mdash; Agentic RAG Platform Architecture & Implementation Guide v1.0",
        styles['Caption']
    ))

    # ========================================
    # BUILD
    # ========================================
    doc.build(
        story,
        onFirstPage=create_cover_page,
        onLaterPages=page_header_footer,
    )

    print(f"PDF generated successfully: {filename}")
    return filename


if __name__ == "__main__":
    build_pdf()
