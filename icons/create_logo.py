import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

def generate_tunescript_logo(size=512):
    # Create image with RGBA
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Dimensions
    pad = int(size * 0.05)
    rect_box = [pad, pad, size - pad, size - pad]
    corner_radius = int(size * 0.22)
    
    # 1. Outer Glow Layer
    glow_img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow_img)
    glow_draw.rounded_rectangle(rect_box, radius=corner_radius, fill=(245, 197, 24, 60))
    glow_img = glow_img.filter(ImageFilter.GaussianBlur(size * 0.06))
    img.alpha_composite(glow_img)

    # 2. Main Dark Background Squircle
    # Create gradient background
    bg_img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    bg_draw = ImageDraw.Draw(bg_img)
    bg_draw.rounded_rectangle(rect_box, radius=corner_radius, fill=(15, 15, 26, 255))
    
    # Inner border outline
    bg_draw.rounded_rectangle(rect_box, radius=corner_radius, outline=(245, 197, 24, 90), width=int(size * 0.025))
    img.alpha_composite(bg_img)

    # 3. Main Graphic: Musical Note + Script Lines
    overlay = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay)

    # Coordinates relative to canvas
    center_x = size * 0.42
    center_y = size * 0.52

    # Draw 3 Glowing Script Lines on the right side
    lines_x_start = size * 0.54
    lines_x_end = size * 0.82
    line_y1 = size * 0.36
    line_y2 = size * 0.50
    line_y3 = size * 0.64
    stroke_w = int(size * 0.045)

    # Top script line (Cyan glow)
    odraw.line([(lines_x_start, line_y1), (lines_x_end, line_y1)], fill=(56, 189, 248, 240), width=stroke_w)
    # Middle script line (Vibrant Gold)
    odraw.line([(lines_x_start * 0.95, line_y2), (lines_x_end * 0.9, line_y2)], fill=(245, 197, 24, 255), width=stroke_w)
    # Bottom script line (Muted Blue/Grey)
    odraw.line([(lines_x_start, line_y3), (lines_x_end * 0.75, line_y3)], fill=(148, 163, 184, 200), width=stroke_w)

    # Draw Musical Note on Left (Eighth Note with Stem)
    head_cx = size * 0.34
    head_cy = size * 0.64
    head_rx = size * 0.09
    head_ry = size * 0.07

    # Note Head (rotated oval)
    odraw.ellipse([head_cx - head_rx, head_cy - head_ry, head_cx + head_rx, head_cy + head_ry], fill=(245, 197, 24, 255))
    
    # Note Stem
    stem_x = head_cx + head_rx * 0.6
    stem_top_y = size * 0.28
    stem_w = int(size * 0.045)
    odraw.line([(stem_x, head_cy), (stem_x, stem_top_y)], fill=(245, 197, 24, 255), width=stem_w)

    # Note Beam / Flag (curving gracefully to the right)
    flag_box = [stem_x, stem_top_y, stem_x + size * 0.22, stem_top_y + size * 0.16]
    odraw.line([(stem_x, stem_top_y), (stem_x + size * 0.18, stem_top_y + size * 0.05)], fill=(245, 197, 24, 255), width=int(stem_w * 1.3))

    img.alpha_composite(overlay)
    return img

def create_svg():
    svg_content = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <defs>
    <linearGradient id="bg-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1A1A2E"/>
      <stop offset="100%" stop-color="#0F0F1A"/>
    </linearGradient>
    <linearGradient id="gold-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FDE047"/>
      <stop offset="100%" stop-color="#EAB308"/>
    </linearGradient>
    <linearGradient id="cyan-grad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#38BDF8"/>
      <stop offset="100%" stop-color="#818CF8"/>
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="12" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>

  <!-- Squircle Background -->
  <rect x="32" y="32" width="448" height="448" rx="100" fill="url(#bg-grad)" stroke="#F5C518" stroke-opacity="0.35" stroke-width="6"/>

  <!-- Script Wave Lines -->
  <line x1="270" y1="185" x2="420" y2="185" stroke="url(#cyan-grad)" stroke-width="22" stroke-linecap="round" filter="url(#glow)"/>
  <line x1="255" y1="256" x2="395" y2="256" stroke="url(#gold-grad)" stroke-width="22" stroke-linecap="round" filter="url(#glow)"/>
  <line x1="270" y1="327" x2="360" y2="327" stroke="#94A3B8" stroke-width="22" stroke-linecap="round" opacity="0.85"/>

  <!-- Musical Note -->
  <g filter="url(#glow)">
    <ellipse cx="170" cy="330" rx="46" ry="36" transform="rotate(-20 170 330)" fill="url(#gold-grad)" />
    <rect x="195" y="145" width="22" height="185" rx="11" fill="url(#gold-grad)" />
    <path d="M 206 145 C 260 145, 290 170, 310 185 L 300 215 C 275 195, 250 175, 206 175 Z" fill="url(#gold-grad)" />
  </g>
</svg>'''
    return svg_content

def main():
    icons_dir = r"d:\CODING\Extensions\tunescript\icons"
    os.makedirs(icons_dir, exist_ok=True)

    # 1. Write SVG
    svg_path = os.path.join(icons_dir, "icon.svg")
    with open(svg_path, "w", encoding="utf-8") as f:
        f.write(create_svg())
    print(f"Generated: {svg_path}")

    # 2. Render PNG sizes (16, 32, 48, 128)
    base_img = generate_tunescript_logo(512)
    sizes = [16, 32, 48, 128]
    for s in sizes:
        resized = base_img.resize((s, s), Image.Resampling.LANCZOS)
        out_path = os.path.join(icons_dir, f"icon{s}.png")
        resized.save(out_path, "PNG")
        print(f"Generated: {out_path}")

if __name__ == "__main__":
    main()
