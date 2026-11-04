# Antmicro copper-circle regression

The fixture is the unmodified `antmicro-footprints:antmicro-logo_scaled_12mm`
footprint extracted from the [HDMI EDID Debug Board at commit
615be304c1d2a9ef7a1195692e9f67fb8a41cab3](https://github.com/antmicro/hdmi-edid-debug-board/blob/615be304c1d2a9ef7a1195692e9f67fb8a41cab3/hdmi-edid-debug-board.kicad_pcb).
Copyright (c) Antmicro. The original board is published under the [Apache License 2.0](https://github.com/antmicro/hdmi-edid-debug-board/blob/615be304c1d2a9ef7a1195692e9f67fb8a41cab3/LICENSE), copied in LICENSE.antmicro.
The extraction retains its original placement, UUIDs, graphics and properties.
Fixture SHA-256: `849217fe122c34973e70e0628175dd17f304c347745b6148cbbb70d25b307238`.

On F.Cu the logo contains nine filled polygons and eight unfilled circles,
all with 0.13 mm strokes. Six circle radii are 0.089 mm; two are 0.117 mm.
The importer emits the nine polygons and silently drops the eight circles.
The dual-camera-to-GMSL adapter fixture contains the same copper logo.

Run `bun test tests/repros/copper-circle-strokes`.
The snapshot records the current import against a native KiCad copper export.
The geometry regression deliberately expects the eight missing annuli and fails
until the stacked fix is applied. Its scope excludes the connecting line strokes,
which are tracked separately in #267.
