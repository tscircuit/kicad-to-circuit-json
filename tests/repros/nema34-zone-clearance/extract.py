"""Reduce the pinned NEMA34 native PCB; usage: python3 extract.py SOURCE OUTPUT."""
import hashlib
from pathlib import Path
import re
import sys

source = Path(sys.argv[1]).read_bytes()
assert hashlib.sha256(source).hexdigest() == "2880cf5c42f62f26465c4ceb164357e5228ccf19ff86d115c116c3b1ec52891e"
blocks = re.split(r"(?=\n\t\()", source.decode())
selected = [blocks[0]]
for block in blocks[1:]:
    kind = block.split("(", 1)[1].split()[0]
    if kind in {"version", "generator", "generator_version", "general", "paper", "layers"} or (kind.startswith("gr_") and '(layer "Edge.Cuts")' in block):
        selected.append(block)
    elif kind == "zone" and "8b811c38-934e-46ff-8ad4-933b2ccfbbdb" in block:
        # Keep original outline/settings and the two smallest cached fill fragments.
        parts = re.split(r"(?=\n\t\t\(filled_polygon)", block)
        fills = [p.removesuffix("\n\t)") for p in parts[1:]]
        selected.append(parts[0] + "".join(sorted(fills, key=len)[:2]) + "\n\t)")
    elif kind == "zone" and "4228f9ed-8321-4f9c-8895-a9440581e7a8" in block:
        selected.append(block)
Path(sys.argv[2]).write_text("".join(selected) + "\n)\n")
