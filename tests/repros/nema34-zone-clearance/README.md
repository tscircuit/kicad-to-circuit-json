# NEMA34 zone-clearance import repro

The source board's `GND_PLANE` specifies **0.30 mm**, and the selected `EFUSE_IN` power zone specifies **0.16 mm**. Before this fix, importing either zone omitted its local clearance from every generated `pcb_copper_pour`.

| Source zone                               | Layer  | Native clearance | Imported before | Imported after  |
| ----------------------------------------- | ------ | ---------------- | --------------- | --------------- |
| `GND_PLANE` (two retained fill fragments) | In1.Cu | 0.30 mm          | absent          | 0.30 mm on both |
| EFUSE_IN                                  | B.Cu   | 0.16 mm          | absent          | 0.16 mm         |

## Real-board provenance

- Board: [techmannih/pd1180-epr at 952de54ca0b5dbe042d9ccc9a1a9ecf3e8f67779](https://github.com/techmannih/pd1180-epr/tree/952de54ca0b5dbe042d9ccc9a1a9ecf3e8f67779).
- [Native project ZIP](https://raw.githubusercontent.com/techmannih/pd1180-epr/952de54ca0b5dbe042d9ccc9a1a9ecf3e8f67779/release/pd1180-epr-r0.3-kicad.zip), containing `pd1180-epr-r0.3.kicad_pcb`.
- Original PCB SHA-256: `2880cf5c42f62f26465c4ceb164357e5228ccf19ff86d115c116c3b1ec52891e`.
- GND zone UUID: `8b811c38-934e-46ff-8ad4-933b2ccfbbdb`.
- EFUSE_IN zone UUID: `4228f9ed-8321-4f9c-8895-a9440581e7a8`.

`extract.py` checks the source hash and keeps the original board header/layers/outline, these two zones' outlines/settings, and the GND zone's two smallest cached fill fragments. It removes unrelated components, routes, zones and the other GND fill fragments. No clearance or retained polygon coordinate is invented or modified. This is a conversion repro, not a manufacturable reduced board.

```sh
python3 tests/repros/nema34-zone-clearance/extract.py \
  /path/to/pd1180-epr-r0.3.kicad_pcb \
  tests/repros/nema34-zone-clearance/nema34-reduced.kicad_pcb
bun test tests/repros/nema34-zone-clearance/zone-clearance.test.ts
```

The tests exercise the full converter, multiple filled fragments, outline fallback, explicit zero and absence. On unchanged main, the first assertion fails with `[undefined, undefined, undefined]` instead of `[0.16, 0.3, 0.3]`.

A separate local check of the full original PCB produced 101 pour records: 87 at 0.16 mm, 9 at 0.30 mm (8 inner1 GND + 1 inner2 GND), and 5 at 0.20 mm. The new schema retained all those clearance values when parsing the records.

Schema companion: [circuit-json#931](https://github.com/tscircuit/circuit-json/pull/931). Exporter companion: [circuit-json-to-kicad#757](https://github.com/tscircuit/circuit-json-to-kicad/pull/757). The exporter also needs to consume this field; this importer change alone does not fix downloads made from already-published JSON lacking clearance.

This field is the zone's local clearance setting, not the global copper-to-board-edge rule or the GND polygon's 0.50 mm edge inset. Preserving it does not certify all physical gaps, zone topology, connectivity or whole-board DRC.
