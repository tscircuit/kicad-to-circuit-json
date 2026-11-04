# KiCad copper ruler fixture

`Gauge_50mm_Type2_CopperTop.kicad_mod` is copied unchanged from the KiCad
footprint library at commit `7ebfa6b23cc292a56f751b7b5f4a0e12eeef69dd`:

https://github.com/KiCad/kicad-footprints/blob/7ebfa6b23cc292a56f751b7b5f4a0e12eeef69dd/Calibration_Scale.pretty/Gauge_50mm_Type2_CopperTop.kicad_mod

SHA-256: `05cc439b1389ffb2874ea342238d5337552d9ba39e7067200edaa605dd433492`.

The KiCad library authors license this file under CC-BY-SA 4.0 with the KiCad
design exception. The upstream license notice is reproduced in
`KICAD-LIBRARY-LICENSE.md`.

The test places this real 50 mm copper ruler on a rectangular board and compares
KiCad's native copper plot with the imported PCB. Its 41 copper line strokes,
including their original 0.381 mm widths, are retained verbatim in the fixture.
The board wrapper normalizes the legacy root token with the converter's existing
upgrade helper and adds a stable placement UUID. The source geometry is unchanged.
