from barcode import Code128


def code128_svg(data, width_pt, height_pt, quiet_modules=10, color="#111111"):
    """Return an inline SVG string for `data`, sized to width_pt x height_pt.

    width_pt covers bars + quiet zones so the symbol is scan-safe when placed
    flush in a layout. Adjacent equal modules are merged into single rects to
    keep the emitted markup small (this is repeated 500x in the document).
    """
    bits = Code128(data).build()[0]
    n = len(bits)
    total = n + 2 * quiet_modules
    mod = width_pt / total            # pt per module

    rects = []
    i = 0
    while i < n:
        if bits[i] == '1':
            j = i
            while j < n and bits[j] == '1':
                j += 1
            x = (quiet_modules + i) * mod
            w = (j - i) * mod
            rects.append(f'<rect x="{x:.3f}" y="0" width="{w:.3f}" height="{height_pt:.3f}"/>')
            i = j
        else:
            i += 1

    return (f'<svg class="bc" viewBox="0 0 {width_pt:.3f} {height_pt:.3f}" '
            f'preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">'
            f'<g fill="{color}">{"".join(rects)}</g></svg>')


def x_dimension_in(width_pt, data="000001", quiet_modules=10):
    """Narrow-bar width in inches - the key scannability metric."""
    n = len(Code128(data).build()[0])
    return (width_pt / (n + 2 * quiet_modules)) / 72.0


if __name__ == '__main__':
    for w in (78, 86, 92, 100):
        print(f"barcode width {w}pt -> X = {x_dimension_in(w)*1000:.1f} mil")
