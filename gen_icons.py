from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.join(os.path.dirname(__file__), "icons")
os.makedirs(OUT, exist_ok=True)

BLUE = (11, 95, 255, 255)
WHITE = (255, 255, 255, 255)

def rounded_square(size, radius_ratio=0.22, bg=BLUE, pad=0):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(size * radius_ratio)
    d.rounded_rectangle([pad, pad, size - 1 - pad, size - 1 - pad], radius=r, fill=bg)
    return img, d

def find_font(size):
    candidates = [
        r"C:\Windows\Fonts\arialbd.ttf",
        r"C:\Windows\Fonts\segoeuib.ttf",
        r"C:\Windows\Fonts\arial.ttf",
    ]
    for c in candidates:
        if os.path.exists(c):
            return ImageFont.truetype(c, size)
    return ImageFont.load_default()

def draw_bars(d, size, color=WHITE):
    # 簡單的甘特圖長條示意圖案
    bar_h = size * 0.08
    gap = size * 0.055
    widths = [0.55, 0.75, 0.4]
    x0 = size * 0.20
    y = size * 0.22
    for i, w in enumerate(widths):
        y_i = y + i * (bar_h + gap)
        x1 = x0 + size * w
        d.rounded_rectangle([x0, y_i, x1, y_i + bar_h], radius=bar_h / 2, fill=color)

def make_icon(size, out_path, maskable=False):
    pad = int(size * 0.08) if maskable else 0
    img, d = rounded_square(size, radius_ratio=0.0 if maskable else 0.22, pad=0)
    draw_bars(d, size)
    # ATK 文字
    font = find_font(int(size * 0.16))
    text = "ATK"
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((size - tw) / 2 - bbox[0], size * 0.74 - bbox[1]), text, font=font, fill=WHITE)
    img.save(out_path)

make_icon(192, os.path.join(OUT, "icon-192.png"))
make_icon(512, os.path.join(OUT, "icon-512.png"))
make_icon(512, os.path.join(OUT, "icon-maskable-512.png"), maskable=True)
print("icons generated")
