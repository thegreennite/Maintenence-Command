"""Renders the Inspect Funnels logo kit (PNG icons, favicon, share image) from the SVG sources.
Run: python3 brand/render.py   (needs `pip install playwright` + `playwright install chromium`)"""
import pathlib
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
PUB = ROOT / "public"
mark = (HERE / "logo-mark.svg").read_text()

def page_for(svg_markup, size, bg="transparent", pad=0, scale=1.0, tile_bg=None):
    inner = svg_markup
    return f"""<html><body style="margin:0;background:{bg};width:{size}px;height:{size}px;display:grid;place-items:center;overflow:hidden">
    <div style="width:{size*scale}px;height:{size*scale}px">{inner}</div></body></html>"""

# One full-bleed design for every size: art sits inside the maskable safe zone, so the phone can crop it freely.
maskable = mark

jobs = [
    ("icons/icon-192.png", mark, 192), ("icons/icon-512.png", mark, 512),
    ("icons/maskable-512.png", maskable, 512), ("icons/apple-touch-icon.png", maskable, 180),
    ("icons/favicon-32.png", mark, 32), ("icons/favicon-48.png", mark, 48),
]
with sync_playwright() as p:
    b = p.chromium.launch()
    for rel, svg, size in jobs:
        pg = b.new_page(viewport={"width": size, "height": size}, device_scale_factor=1)
        pg.set_content(page_for(svg, size)); pg.wait_for_timeout(120)
        pg.screenshot(path=str(PUB / rel), omit_background=True); pg.close()
    # 1024 master for stores / social profile
    pg = b.new_page(viewport={"width": 1024, "height": 1024}); pg.set_content(page_for(mark, 1024)); pg.wait_for_timeout(120)
    pg.screenshot(path=str(HERE / "logo-mark-1024.png"), omit_background=True); pg.close()
    # Wordmark + share image (1200x630)
    share = f"""<html><head><link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;700;800&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet"></head>
    <body style="margin:0;width:1200px;height:630px;background:radial-gradient(90% 120% at 80% 10%,#1d5c52 0%,#0b1a18 60%,#07110f 100%);color:#e8efe9;font-family:'Inter Tight',Arial,sans-serif;display:flex;align-items:center;gap:56px;padding:0 90px;box-sizing:border-box">
    <div style="width:250px;height:250px;flex:none;border-radius:58px;overflow:hidden;box-shadow:0 24px 48px rgba(0,0,0,.5)">{mark}</div>
    <div><div style="font-weight:800;font-size:118px;letter-spacing:-.05em;line-height:.95">Inspect<br><span style="font-family:'Instrument Serif',Georgia,serif;font-style:italic;font-weight:400;color:#dceb61;letter-spacing:-.02em">Funnels</span></div>
    <div style="margin-top:26px;font-size:30px;color:#a9bbb4;font-weight:500">Maintenance operations, with proof.</div></div></body></html>"""
    pg = b.new_page(viewport={"width": 1200, "height": 630}); pg.set_content(share); pg.wait_for_timeout(1500)
    pg.screenshot(path=str(HERE / "share-image.png")); pg.close(); b.close()
print("rendered:", [j[0] for j in jobs], "+ logo-mark-1024.png + share-image.png")
