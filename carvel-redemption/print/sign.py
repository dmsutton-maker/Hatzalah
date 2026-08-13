"""Carvel register sign: QR to the redemption app + a to-scale SAMPLE coupon.

The sample coupon is rendered at exactly the same physical size as a real one
(4.1667 x 3.0833 in) so staff can eyeball a genuine coupon against it, and its
barcode carries a TEST serial so the demo can be scanned live without touching
the real ledger.
"""
import os, base64, io, json, sys
import qrcode
from qrcode.image.svg import SvgPathImage
from weasyprint import HTML, CSS
from weasyprint.text.fonts import FontConfiguration

import gen_grid as G

BASE = os.path.dirname(os.path.abspath(__file__))

# ---- configure ------------------------------------------------------------
APP_URL = os.environ.get('APP_URL', 'https://REPLACE-ME.netlify.app/s/CARVEL-WLB')
SAMPLE_SERIAL = int(os.environ.get('SAMPLE_SERIAL', '900001'))
STORE_LABEL = '175 Monmouth Rd, West Long Branch'
CONTACT = os.environ.get('CONTACT', 'Questions? Contact Jersey Shore Hatzalah')
# ---------------------------------------------------------------------------

LOGO = G.LOGO


def qr_svg(data, px=1000):
    q = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_Q, border=2)
    q.add_data(data)
    q.make(fit=True)
    img = q.make_image(image_factory=SvgPathImage)
    buf = io.BytesIO()
    img.save(buf)
    svg = buf.getvalue().decode()
    # strip the xml decl so it can be inlined
    return svg[svg.index('<svg'):], q.modules_count


QR_SVG, QR_MODULES = qr_svg(APP_URL)

SAMPLE = G.coupon(SAMPLE_SERIAL)


def build(outfile):
    css = G.css_text() + f"""
@page {{ size: Letter; margin:0; }}
.page {{ width:8.5in; height:11in; }}
.grid {{ position:absolute; left:0; top:0; width:auto; height:auto; }}

.sheet {{ position:absolute; left:0; top:0; width:8.5in; height:11in; }}
.hdr {{ position:absolute; top:0.40in; left:0; width:8.5in; text-align:center; }}
.hdr img {{ width:0.76in; height:{0.76*1.29:.3f}in; }}
.t1 {{ position:absolute; top:1.46in; left:0; width:8.5in; text-align:center;
   font-size:22pt; font-weight:700; color:#1D3F62; letter-spacing:0.2pt; }}
.t2 {{ position:absolute; top:1.88in; left:0; width:8.5in; text-align:center;
   font-size:10.5pt; font-weight:500; font-style:italic; color:#44546A; }}
.rule {{ position:absolute; left:1.4in; width:5.7in; height:0;
   border-top:1pt solid #C9D6E4; }}

.qrbox {{ position:absolute; left:{(8.5-2.62)/2:.4f}in; top:2.30in;
   width:2.62in; height:2.62in; padding:0.11in; box-sizing:border-box;
   border:1.5pt solid #22629F; border-radius:0.13in; }}
.qrbox svg {{ display:block; width:100%; height:100%; }}
.url {{ position:absolute; top:5.00in; left:0; width:8.5in; text-align:center;
   font-size:9pt; font-weight:500; color:#5A6B7C; }}

.steps {{ position:absolute; top:5.32in; left:1.05in; width:6.4in; }}
.step {{ position:relative; padding-left:0.40in; margin-bottom:0.085in;
   font-size:10.5pt; font-weight:500; color:#22303D; line-height:1.22; }}
.step .n {{ position:absolute; left:0; top:-0.005in; width:0.25in; height:0.25in;
   border-radius:50%; background:#22629F; color:#fff; text-align:center;
   line-height:0.25in; font-size:9pt; font-weight:700; }}
.step b {{ font-weight:700; color:#1D3F62; }}
.ok {{ color:#1B7F4B; font-weight:700; }}
.no {{ color:#B3202C; font-weight:700; }}

.smphdr {{ position:absolute; top:6.86in; left:0; width:8.5in; text-align:center;
   font-size:9.5pt; font-weight:700; color:#1D3F62; letter-spacing:1.5pt; }}
.smpnote {{ position:absolute; top:7.07in; left:0; width:8.5in; text-align:center;
   font-size:8.4pt; font-weight:500; font-style:italic; color:#6B7885; }}
.smpwrap {{ position:absolute; left:{(8.5-G.CW_IN)/2:.4f}in; top:7.34in;
   width:{G.CW_IN:.4f}in; height:{G.CH_IN:.4f}in; }}
.smpwrap .coupon {{ left:0 !important; top:0 !important; }}
.smpband {{ position:absolute; left:0; top:{G.CH*0.40:.2f}pt; width:{G.CW:.2f}pt;
   height:{G.CH*0.165:.2f}pt; background:rgba(179,32,44,0.58); color:#fff;
   text-align:center; line-height:{G.CH*0.165:.2f}pt; font-size:{G.CW*0.078:.2f}pt;
   font-weight:900; letter-spacing:{G.CW*0.019:.2f}pt; }}
.foot {{ position:absolute; top:10.62in; left:0; width:8.5in; text-align:center;
   font-size:8.6pt; font-weight:500; color:#7C8894; }}
"""
    body = f"""<div class="page"><div class="sheet">
  <div class="hdr"><img src="{LOGO}"/></div>
  <div class="t1">Free Ice Cream Coupon &mdash; Redemption</div>
  <div class="t2">Jersey Shore Hatzalah Helmet Safety Reward &middot; {STORE_LABEL}</div>
  <div class="rule" style="top:2.14in"></div>

  <div class="qrbox">{QR_SVG}</div>
  <div class="url">{APP_URL}</div>

  <div class="steps">
    <div class="step"><span class="n">1</span><b>Scan this QR code</b> with your phone camera to open the
      redemption page. No app or login needed &mdash; bookmark it for next time.</div>
    <div class="step"><span class="n">2</span><b>Scan the barcode</b> at the bottom of the customer's coupon,
      or type the 6&#8209;digit number below it.</div>
    <div class="step"><span class="n">3</span><span class="ok">GREEN &check; VALID</span> &mdash; keep the coupon
      and serve one Kiddie Cup.<br/>
      <span class="no">RED &times; ALREADY USED or NOT VALID</span> &mdash; do not serve; return the coupon.</div>
  </div>

  <div class="rule" style="top:6.68in"></div>
  <div class="smphdr">SAMPLE COUPON &mdash; SHOWN AT ACTUAL SIZE</div>
  <div class="smpnote">A real coupon looks exactly like this and is printed on white cardstock.</div>
  <div class="smpwrap"><div class="grid">{SAMPLE}</div><div class="smpband">SAMPLE</div></div>
  <div class="foot">{CONTACT}</div>
</div></div>"""

    fc = FontConfiguration()
    HTML(string='<html><head><meta charset="utf-8"></head><body>' + body + '</body></html>',
         base_url=BASE).write_pdf(outfile, stylesheets=[CSS(string=css, font_config=fc)],
                                  font_config=fc)
    print(f'wrote {outfile}')
    print(f'  QR -> {APP_URL}  ({QR_MODULES} modules, ~{2.89/QR_MODULES*1000:.0f} mil/module)')
    print(f'  sample coupon at actual size {G.CW_IN:.4f} x {G.CH_IN:.4f} in, serial {SAMPLE_SERIAL:06d}')


if __name__ == '__main__':
    build(sys.argv[1] if len(sys.argv) > 1 else 'sign.pdf')
