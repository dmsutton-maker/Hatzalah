import os, base64, json
from weasyprint import HTML, CSS
from weasyprint.text.fonts import FontConfiguration
from bc import code128_svg, x_dimension_in

BASE = os.path.dirname(os.path.abspath(__file__))


def b64(pth, mime):
    with open(pth, 'rb') as f:
        return "data:%s;base64,%s" % (mime, base64.b64encode(f.read()).decode())


LOGO = b64(os.path.join(BASE, 'assets/logo_vec.png'), 'image/png')

# ------------------------------------------------------------------ config
PAGE_W, PAGE_H = 13.0, 19.0
MARGIN = 0.25
COLS, ROWS = 3, 6

INNER_W = PAGE_W - 2 * MARGIN
INNER_H = PAGE_H - 2 * MARGIN
CW_IN = INNER_W / COLS
CH_IN = INNER_H / ROWS
CW, CH = CW_IN * 72, CH_IN * 72

# the tuned layout was authored against a 180pt-wide coupon; everything is a
# pure linear scale from there, so type/rules/barcode keep identical relations
BASE_W = 180.0
S = CW / BASE_W

NO_SCALE = {'pill_sx'}
_L = json.load(open(os.path.join(BASE, 'layout50.json')))
L = {k: (v if k in NO_SCALE else v * S) for k, v in _L.items()}


def g(k, d):
    return L.get(k, d * S)


BIKE = ('<svg viewBox="0 0 64 40" class="bike"><g fill="none" stroke="#ffffff" '
        'stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round">'
        '<circle cx="13" cy="26" r="10.5"/><circle cx="51" cy="26" r="10.5"/>'
        '<path d="M13 26 L30 26 L24 12 L13 26"/><path d="M30 26 L45 11"/>'
        '<path d="M24 12 L45 11"/><path d="M45 11 L51 26"/>'
        '<path d="M20 11 L28 11"/><path d="M41 8 L50 8"/></g></svg>')

DOTS = [('#FF6FA4', 172.5, 60.0, 2.0), ('#F6C444', 171.5, 10.5, 1.8),
        ('#55CFA6', 9.5, 124.0, 1.8), ('#58B4EE', 172.0, 123.0, 2.0)]


def dots_html():
    out = []
    for color, cx, cy, r in DOTS:
        cx, cy, r = cx * S, cy * S, r * S
        out.append(f'<i class="cf" style="width:{2*r:.2f}pt;height:{2*r:.2f}pt;border-radius:50%;'
                   f'background:{color};left:{cx-r:.2f}pt;top:{cy-r:.2f}pt"></i>')
    return ''.join(out)


CF = dots_html()
BC_W = g('bc_w', 92.0)
BC_H = g('bc_h', 9.5)


def coupon(serial):
    sn = f"{serial:06d}"
    return f"""<div class="coupon">
  <div class="brd"></div>{CF}
  <img class="logo" src="{LOGO}"/>
  <div class="hero"><span class="one">1</span><span class="free">FREE</span></div>
  <div class="ice">ICE CREAM</div>
  <div class="kid">Kiddie Cup</div>
  <div class="compl">Compliments of Jersey Shore Hatzalah</div>
  <div class="pill">{BIKE}<span>Helmet Safety Reward</span></div>
  <div class="redeem">Only redeemable at <span class="carvel">CARVEL</span><span class="reg">&#174;</span></div>
  <div class="addr">175 Monmouth Rd, West Long Branch, NJ 07764</div>
  <div class="fine">Valid for one (1) free Kiddie Cup only. Topping extra. Not redeemable for cash.<br/>
  May not be copied or reproduced. One per child. Expires 12/31/2026.</div>
  <div class="sn">No. {sn}</div>
  <div class="bcw">{code128_svg(sn, BC_W, BC_H)}</div>
</div>"""


def css_text():
    mx = (PAGE_W - COLS * CW_IN) / 2
    my = (PAGE_H - ROWS * CH_IN) / 2
    return f"""
@font-face {{ font-family:'Playfair'; src:url('file://{BASE}/fonts/PlayfairDisplay-Regular.ttf'); font-weight:400; }}
@font-face {{ font-family:'Playfair'; src:url('file://{BASE}/fonts/PlayfairDisplay-Medium.ttf'); font-weight:500; }}
@font-face {{ font-family:'Playfair'; src:url('file://{BASE}/fonts/PlayfairDisplay-Bold.ttf'); font-weight:700; }}
@font-face {{ font-family:'Playfair'; src:url('file://{BASE}/fonts/PlayfairDisplay-Black.ttf'); font-weight:900; }}
@font-face {{ font-family:'Playfair'; src:url('file://{BASE}/fonts/PlayfairDisplay-MediumItalic.ttf'); font-weight:500; font-style:italic; }}
@page {{ size: {PAGE_W}in {PAGE_H}in; margin:0; }}
html,body {{ margin:0; padding:0; }}
body {{ font-family:'Playfair', serif; font-feature-settings:'lnum' 1,'onum' 0; }}
.page {{ width:{PAGE_W}in; height:{PAGE_H}in; position:relative; page-break-after:always; }}
.page:last-child {{ page-break-after:auto; }}
.grid {{ position:absolute; left:{mx}in; top:{my}in;
   width:{COLS*CW_IN}in; height:{ROWS*CH_IN}in; }}
.coupon {{ position:absolute; width:{CW:.3f}pt; height:{CH:.3f}pt; overflow:hidden; background:#fff; }}
.brd {{ position:absolute; left:{g('brd',2.6):.2f}pt; top:{g('brd',2.6):.2f}pt;
   right:{g('brd',2.6):.2f}pt; bottom:{g('brd',2.6):.2f}pt;
   border:{g('brd_w',0.7):.2f}pt solid #255C98; }}
i.cf {{ position:absolute; display:block; }}
.tick {{ position:absolute; background:#9aa3ad; }}

.logo {{ position:absolute; left:{g('logo_x',7.5):.2f}pt; top:{g('logo_y',8.0):.2f}pt;
   width:{g('logo_w',31.0):.2f}pt; height:{g('logo_w',31.0)*1.29:.2f}pt; }}
.pill {{ position:absolute; left:{g('pill_x',66.0):.2f}pt; top:{g('pill_y',62.0):.2f}pt;
   width:{g('pill_w',104.0):.2f}pt; height:{g('pill_h',8.6):.2f}pt; background:#22629F;
   border-radius:{g('pill_h',8.6)/2:.2f}pt; color:#fff; text-align:center;
   line-height:{g('pill_h',8.6):.2f}pt; white-space:nowrap; }}
.pill .bike {{ display:inline-block; vertical-align:middle; position:relative;
   top:{g('pill_ty',0.0):.2f}pt;
   width:{g('bike_w',7.0):.2f}pt; height:{g('bike_w',7.0)*0.656:.2f}pt;
   margin-right:{g('bike_gap',2.6):.2f}pt; }}
.pill span {{ display:inline-block; vertical-align:middle; line-height:1;
   position:relative; top:{g('pill_ty',0.0):.2f}pt;
   font-size:{g('pill_s',4.4):.2f}pt; font-weight:700;
   letter-spacing:{g('pill_ls',0.45):.2f}pt; margin-right:{-g('pill_ls',0.45):.2f}pt;
   text-transform:uppercase; }}

.hero {{ position:absolute; left:{g('rcol_x',62.0):.2f}pt; width:{g('rcol_w',112.0):.2f}pt; top:{g('hero_y',46.0):.2f}pt;
   text-align:center; color:#C0202E; line-height:1; }}
.hero .one {{ font-size:{g('one_s',25.0):.2f}pt; font-weight:900; }}
.hero .free {{ font-size:{g('free_s',16.0):.2f}pt; font-weight:900;
   letter-spacing:{g('free_ls',0.3):.2f}pt; margin-left:{g('hero_gap',3.4):.2f}pt; }}
.ice {{ position:absolute; left:{g('rcol_x',62.0):.2f}pt; width:{g('rcol_w',112.0):.2f}pt; top:{g('ice_y',66.0):.2f}pt; text-align:center;
   font-size:{g('ice_s',13.4):.2f}pt; font-weight:700; color:#1a1a1a;
   letter-spacing:{g('ice_ls',0.3):.2f}pt; line-height:1; }}
.kid {{ position:absolute; left:{g('rcol_x',62.0):.2f}pt; width:{g('rcol_w',112.0):.2f}pt; top:{g('kid_y',80.0):.2f}pt; text-align:center;
   font-size:{g('kid_s',5.2):.2f}pt; font-weight:700; color:#2C6096;
   letter-spacing:{g('kid_ls',1.7):.2f}pt; text-indent:{g('kid_ls',1.7):.2f}pt;
   text-transform:uppercase; line-height:1; }}
.compl {{ position:absolute; left:{g('rcol_x',62.0):.2f}pt; width:{g('rcol_w',112.0):.2f}pt;
   top:{g('compl_y',55.5):.2f}pt; text-align:center; font-style:italic; font-weight:500;
   font-size:{g('compl_s',4.6):.2f}pt; color:#2C4A6B; line-height:1; white-space:nowrap; }}
.redeem {{ position:absolute; left:0; width:{CW:.3f}pt; top:{g('red_y',89.0):.2f}pt; text-align:center;
   font-size:{g('red_s',7.2):.2f}pt; font-weight:500; color:#1f1f1f; line-height:1; white-space:nowrap; }}
.redeem .carvel {{ font-size:{g('carv_s',9.0):.2f}pt; font-weight:700; color:#275E97; }}
.redeem .reg {{ font-size:{g('carv_s',9.0)*0.36:.2f}pt; color:#275E97;
   vertical-align:{g('carv_s',9.0)*0.34:.2f}pt; }}
.addr {{ position:absolute; left:0; width:{CW:.3f}pt; top:{g('addr_y',99.0):.2f}pt; text-align:center;
   font-size:{g('addr_s',5.6):.2f}pt; font-weight:500; color:#2b2b2b; line-height:1; white-space:nowrap; }}
.fine {{ position:absolute; left:{g('fine_x',10.0):.2f}pt;
   width:{CW-2*g('fine_x',10.0):.2f}pt; top:{g('fine_y',106.5):.2f}pt; text-align:center;
   font-size:{g('fine_s',4.0):.2f}pt; font-weight:500; color:#4a4a4a;
   line-height:{g('fine_lh',4.9):.2f}pt; }}
.sn {{ position:absolute; left:0; width:{CW:.3f}pt; top:{g('sn_y',117.0):.2f}pt; text-align:center;
   font-size:{g('sn_s',5.4):.2f}pt; font-weight:500; letter-spacing:{g('sn_ls',0.7):.2f}pt;
   color:#4a5a6b; line-height:1; }}
.bcw {{ position:absolute; left:{(CW-BC_W)/2:.2f}pt; top:{g('bc_y',124.0):.2f}pt;
   width:{BC_W:.2f}pt; height:{BC_H:.2f}pt; }}
.bcw svg {{ display:block; width:{BC_W:.2f}pt; height:{BC_H:.2f}pt; }}
"""


def page_html(serials):
    cells = []
    for i, s in enumerate(serials):
        r, c = divmod(i, COLS)
        cells.append(coupon(s).replace(
            'class="coupon"',
            f'class="coupon" style="left:{c*CW_IN:.4f}in;top:{r*CH_IN:.4f}in"'))
    mx = (PAGE_W - COLS * CW_IN) / 2
    my = (PAGE_H - ROWS * CH_IN) / 2
    ticks = []
    for c in range(COLS + 1):
        x = mx + c * CW_IN
        ticks.append(f'<i class="tick" style="left:{x:.4f}in;top:0.07in;width:0.4pt;height:{my-0.09:.4f}in"></i>')
        ticks.append(f'<i class="tick" style="left:{x:.4f}in;top:{my+ROWS*CH_IN+0.02:.4f}in;width:0.4pt;height:{my-0.09:.4f}in"></i>')
    for r in range(ROWS + 1):
        y = my + r * CH_IN
        ticks.append(f'<i class="tick" style="top:{y:.4f}in;left:0.07in;height:0.4pt;width:{mx-0.09:.4f}in"></i>')
        ticks.append(f'<i class="tick" style="top:{y:.4f}in;left:{mx+COLS*CW_IN+0.02:.4f}in;height:0.4pt;width:{mx-0.09:.4f}in"></i>')
    return ('<div class="page">' + ''.join(ticks)
            + '<div class="grid">' + ''.join(cells) + '</div></div>')


def build(start, end, outfile):
    per = COLS * ROWS
    serials = list(range(start, end + 1))
    pages = [page_html(serials[i:i + per]) for i in range(0, len(serials), per)]
    html = '<html><head><meta charset="utf-8"></head><body>' + ''.join(pages) + '</body></html>'
    fc = FontConfiguration()
    HTML(string=html, base_url=BASE).write_pdf(
        outfile, stylesheets=[CSS(string=css_text(), font_config=fc)], font_config=fc)
    print(f'wrote {outfile}: {len(pages)} pages, {len(serials)} coupons, '
          f'{per}/page, coupon {CW_IN:.4f}x{CH_IN:.4f}in')


if __name__ == '__main__':
    import sys
    print(f'scale {S:.4f}  coupon {CW:.2f}x{CH:.2f}pt  '
          f'fine print {g("fine_s",4.0):.2f}pt  barcode X {x_dimension_in(BC_W)*1000:.1f} mil')
    build(int(sys.argv[1]), int(sys.argv[2]), sys.argv[3])
