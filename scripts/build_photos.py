"""
Makes web-ready copies of the club photos for the rotating banner.

    python scripts/build_photos.py

Reads every image in visuals/ and writes a resized JPEG to visuals/web/ with
all metadata removed (phone photos carry GPS coordinates, which would be
public on GitHub Pages). Orientation from the camera is applied first so
nothing comes out sideways. Originals are never modified.

After adding a photo, run this script and add an entry for it to the PHOTOS
list at the top of js/banner.js.
"""
from pathlib import Path
from PIL import Image, ImageOps

SRC = Path("visuals")
OUT = SRC / "web"
MAX_SIDE = 1400   # px on the longest side; plenty for a ~340px-tall banner on retina
QUALITY = 80
EXTS = {".jpg", ".jpeg", ".png", ".webp"}

def main():
    OUT.mkdir(exist_ok=True)
    total_in = total_out = 0
    for src in sorted(SRC.iterdir()):
        if not src.is_file() or src.suffix.lower() not in EXTS:
            continue
        im = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
        im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
        dest = OUT / (src.stem.lower() + ".jpg")
        # a fresh save with no exif= argument writes no metadata at all
        im.save(dest, "JPEG", quality=QUALITY, optimize=True, progressive=True)
        total_in += src.stat().st_size
        total_out += dest.stat().st_size
        print(f"  {src.name} -> {dest.as_posix()}  {im.width}x{im.height}  {dest.stat().st_size // 1024} KB")
    print(f"Done: {total_in / 1e6:.1f} MB -> {total_out / 1e6:.1f} MB")

if __name__ == "__main__":
    main()
