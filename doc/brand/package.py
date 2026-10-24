"""Package the exported PNGs into modern PNG-backed ICO/ICNS files and a ZIP.

Standard-library only. Run after generate.swift, from any working directory.
"""
from pathlib import Path
import struct
import zipfile
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parent
app = root / 'app'

def png(size):
    data = (app / f'ramble-{size}.png').read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    assert struct.unpack('>II', data[16:24]) == (size, size)
    return data

sizes = [16, 24, 32, 48, 64, 128, 256]
payloads = [png(s) for s in sizes]
offset = 6 + 16 * len(sizes)
directory = bytearray(struct.pack('<HHH', 0, 1, len(sizes)))
for size, data in zip(sizes, payloads):
    directory += struct.pack('<BBBBHHII', size % 256, size % 256, 0, 0, 1, 32, len(data), offset)
    offset += len(data)
(app / 'ramble.ico').write_bytes(directory + b''.join(payloads))

# Standard PNG-based ICNS elements; avoids relying on iconutil's encoder.
types = [(b'icp4', 16), (b'icp5', 32), (b'icp6', 64), (b'ic07', 128),
         (b'ic08', 256), (b'ic09', 512), (b'ic10', 1024)]
chunks = b''.join(tag + struct.pack('>I', len(png(size)) + 8) + png(size) for tag, size in types)
(app / 'ramble.icns').write_bytes(b'icns' + struct.pack('>I', len(chunks) + 8) + chunks)

for path in (root / 'svg').glob('*.svg'):
    tree = ET.parse(path)
    assert not tree.findall('.//{http://www.w3.org/2000/svg}text'), path
    assert not tree.findall('.//{http://www.w3.org/2000/svg}image'), path

archive = root.parent / 'ramble-logo-kit.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
    for path in sorted(root.rglob('*')):
        if path.is_file() and '.DS_Store' not in path.parts:
            z.write(path, Path('ramble-logo-kit') / path.relative_to(root))
print(f'Validated PNG dimensions and self-contained outlined SVGs; packaged {archive}')
