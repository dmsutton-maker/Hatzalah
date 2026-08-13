# Print pipeline

Generates the serialized coupons and the Carvel register sign. Both are already built;
this exists so they can be regenerated (new URL, new serial range, new expiry).

## Setup
    pip install -r requirements.txt

## Coupons
    python3 gen_grid.py 1 500 Coupons.pdf
4.1667 x 3.0833 in each, 3 across x 6 down on 13 x 19, 0.25 in margins, cut ticks in the
margins. 500 coupons = 28 sheets (the last holds 14).

## Register sign
    APP_URL="https://your-domain/s/CARVEL-WLB" python3 sign.py Sign.pdf
Letter. 2.62 in QR at EC level Q, plus a SAMPLE coupon at exact actual size carrying
test serial 900001. Laminate it.

## Files
    gen_grid.py     coupon layout + N-up imposition. COLS/ROWS at the top.
    layout50.json   tuned layout values, in a 180pt-wide coordinate space
    bc.py           Code 128 -> inline SVG, merged rects
    sign.py         register sign
    assets/         shield logo, extracted from the vector brand PDF at 600 dpi
    fonts/          Playfair Display instances

## Notes
- Layout values scale linearly from the 180pt base, so changing COLS/ROWS rescales
  type, rules and barcode together. No re-tuning needed.
- Barcode narrow bars land at 24 mil at the current size; decoding verified at 150 dpi.
- The shield is a 600 dpi raster of the vector brand PDF. For anything larger than a
  coupon, go back to jersey_shore_hatzalah_new_logo_light_colors.pdf.
