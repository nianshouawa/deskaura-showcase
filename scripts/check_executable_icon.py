"""Read the Windows executable's native icon and compare it to the new ICO."""
import io
import json
from pathlib import Path
import struct

import pefile
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def main():
    exe = ROOT / "companion-frontend/src-tauri/target/release/deskaura.exe"
    pe = pefile.PE(str(exe))
    images = {}
    groups = []
    for kind in pe.DIRECTORY_ENTRY_RESOURCE.entries:
        if kind.id not in (3, 14):
            continue
        for entry in kind.directory.entries:
            data = entry.directory.entries[0].data.struct
            content = pe.get_data(data.OffsetToData, data.Size)
            if kind.id == 3:
                images[entry.id] = content
            else:
                groups.append(content)
    pe.close()
    expected = Image.open(ROOT / "companion-frontend/src-tauri/icons/icon.ico")
    verified = False
    for group in groups:
        reserved, kind, count = struct.unpack_from("<HHH", group)
        header = struct.pack("<HHH", reserved, kind, count)
        entries, content = [], []
        offset = 6 + 16 * count
        for i in range(count):
            width, height, colors, zero, planes, bits, size, ident = struct.unpack_from("<BBBBHHIH", group, 6 + 14 * i)
            payload = images[ident]
            entries.append(struct.pack("<BBBBHHII", width, height, colors, zero, planes, bits, len(payload), offset))
            content.append(payload)
            offset += len(payload)
        icon = Image.open(io.BytesIO(header + b"".join(entries) + b"".join(content)))
        shared = sorted(icon.ico.sizes() & expected.ico.sizes())
        if not shared:
            continue
        native = ROOT / "build/ui-and-standby-v15/executable-icon.png"
        icon.ico.getimage(shared[-1]).save(native)
        if all(icon.ico.getimage(size).convert("RGBA").tobytes() ==
               expected.ico.getimage(size).convert("RGBA").tobytes() for size in shared):
            size = shared[-1]
            target = ROOT / "build/ui-and-standby-v15/executable-icon.png"
            icon.ico.getimage(size).save(target)
            print(json.dumps({"native_icon_matches": True, "sizes": shared, "preview": str(target)}))
            verified = True
            break
    if not verified:
        raise RuntimeError("Built Windows resource icon does not match the selected portrait")


if __name__ == "__main__":
    main()
