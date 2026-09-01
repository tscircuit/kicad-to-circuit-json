# Open-source KiCad references

Run `bun run download-references` to download the real KiCad schematic used by
the source-component regression test. The source file is fetched from an
immutable GitHub revision, verified by SHA-256, ignored by Git, and not
distributed under this repository's MIT license.

| Local file | Upstream file | Revision | License | Bytes | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| `hsp-usb-led.kicad_sch` | [`nushackers/hsp-pcb-intro/src/usb_led.kicad_sch`](https://github.com/nushackers/hsp-pcb-intro/blob/ad3fbd582e3915b585c453ea202f591720a1f427/src/usb_led.kicad_sch) | `ad3fbd582e3915b585c453ea202f591720a1f427` | CERN-OHL-P-2.0 | 35,102 | `425a817f1c236363eefd6ff8cb23365d2641a43d5f1e057191497046dcf20d75` |
