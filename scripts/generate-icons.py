"""Rasterize the owned SVG mark into transparent Windows icon assets."""
from pathlib import Path
from io import BytesIO
import fitz
from PIL import Image

root = Path(__file__).resolve().parents[1]
mark = (root / "assets/mark.svg").read_text(encoding="utf-8")
mark = mark.replace('viewBox="0 0 64 72"', 'width="512" height="512" viewBox="-12 -8 88 88"')
svg = fitz.open(stream=mark.encode(), filetype="svg")
pdf = fitz.open(stream=svg.convert_to_pdf(), filetype="pdf")
page = pdf[0]
pixmap = page.get_pixmap(matrix=fitz.Matrix(512/page.rect.width, 512/page.rect.height), alpha=True)
image = Image.open(BytesIO(pixmap.tobytes("png"))).convert("RGBA")
assert image.getpixel((0, 0))[3] == 0
image.save(root / "assets/icon.png")
image.save(root / "assets/icon.ico", sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
