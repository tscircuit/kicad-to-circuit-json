# dataset-srj18 PCB gap audit

Scope:

- Dataset scanned: `../dataset-srj18/kicad_pcb/*.kicad_pcb`
- Boards scanned: 16
- Converter checked: local `kicad-to-circuit-json` source in this repo
- Dataset repo:
  [tscircuit/dataset-srj18](https://github.com/tscircuit/dataset-srj18)

Quick status:

- All 16 boards convert without runtime errors or warnings.
- Current output already covers core PCB structure well:
  `pcb_board`, `pcb_component`, `pcb_port`, `pcb_smtpad`, `pcb_plated_hole`,
  `pcb_hole`, `pcb_trace`, `pcb_via`, `pcb_copper_pour`,
  `pcb_silkscreen_*`, `pcb_fabrication_note_*`, `pcb_courtyard_*`,
  `pcb_copper_text`, `source_component`, `source_port`, `source_net`,
  `source_trace`.

Aggregate output across the 16 boards:

- `pcb_component`: 1607
- `pcb_port`: 6215
- `pcb_smtpad`: 5757
- `pcb_plated_hole`: 491
- `pcb_hole`: 62
- `pcb_trace`: 4345
- `pcb_via`: 3201
- `pcb_copper_pour`: 494
- `source_component`: 1607
- `source_port`: 6116
- `source_net`: 1839
- `source_trace`: 2745

## Missing

### 1. `pcb_keepout` is missing

Dataset evidence:

- `zone.keepout` appears in 4 boards:
  `sample009-gmsl-serializer`, `sample013-ov5640-dual-camera-board`,
  `sample015-sdi-fiber-adapter`, `sample016-usb-c-power-adapter`

What is missing:

- No `pcb_keepout` elements are emitted.
- Keepout permissions are dropped:
  `tracks`, `vias`, `pads`, `copperpour`, `footprints`

Why:

- [CollectZonesStage.ts](/home/manish/repo/ts/kicad-to-circuit-json/lib/stages/pcb/CollectZonesStage.ts:24)
  treats filled zones only as `pcb_copper_pour`.

Dataset references:

- [sample009-gmsl-serializer keepout permissions block](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample009-gmsl-serializer.kicad_pcb#L339954-L339966)
- [sample013-ov5640-dual-camera-board keepout zone](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample013-ov5640-dual-camera-board.kicad_pcb#L10703-L10727)
- [sample015-sdi-fiber-adapter multi-layer keepout](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample015-sdi-fiber-adapter.kicad_pcb#L567680-L567705)
- [sample016-usb-c-power-adapter keepout with `pads not_allowed`](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample016-usb-c-power-adapter.kicad_pcb#L419688-L419700)

### 2. `pcb_note_*` / drawing-layer primitives are missing

Dataset evidence:

- Top-level user/comment/drawing graphics exist in many boards:
  `gr_line` on `User.2`, `Cmts.User`, `Dwgs.User`, `Eco1.User`
- Top-level note text exists in 14 boards on:
  `Cmts.User`, `Dwgs.User`, `User.2`, `Eco1.User`
- `dimension` objects exist in 8 boards

What is missing:

- `pcb_note_line`
- `pcb_note_rect`
- `pcb_note_path`
- `pcb_note_text`
- `pcb_note_dimension`
- `pcb_text`

Why:

- [CollectGraphicsStage.ts](/home/manish/repo/ts/kicad-to-circuit-json/lib/stages/pcb/CollectGraphicsStage.ts:81)
  only maps top-level graphics for `Edge.Cuts`, silk, fab, courtyard, and copper text.

Dataset references:

- [sample013-ov5640-dual-camera-board `dimension` on `Dwgs.User`](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample013-ov5640-dual-camera-board.kicad_pcb#L9453-L9469)
- [sample013-ov5640-dual-camera-board `gr_line` on `Dwgs.User` and `User.2`](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample013-ov5640-dual-camera-board.kicad_pcb#L8869-L8876)
- [sample008-ftdi-toolkit top-level `gr_text` on `F.Mask`](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample008-ftdi-toolkit.kicad_pcb#L95444-L95447)

### 3. `pcb_net` is still missing

Dataset evidence:

- All 16 boards have KiCad nets.
- Conversion emits `1839` `source_net` records, but `0` `pcb_net` records.

Why:

- [CollectNetsStage.ts](/home/manish/repo/ts/kicad-to-circuit-json/lib/stages/pcb/CollectNetsStage.ts:20)
  only builds an internal `netNumToName` map and does not emit `pcb_net`.

Dataset references:

- [sample001-arduino-leonardo net table](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample001-arduino-leonardo.kicad_pcb#L88-L93)
- [sample007-dual-gmsl-serializer-adapter net table](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample007-dual-gmsl-serializer-adapter.kicad_pcb#L148-L153)

### 4. `pcb_group` is missing

Dataset evidence:

- Raw KiCad `(group ...)` entries are present in 13 boards.

What is missing:

- No PCB grouping information is emitted.

Dataset references:

- [sample001-arduino-leonardo group entries](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample001-arduino-leonardo.kicad_pcb#L27534-L27538)
- [sample007-dual-gmsl-serializer-adapter named group](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample007-dual-gmsl-serializer-adapter.kicad_pcb#L297116-L297120)

### 5. Dedicated solder-paste output is missing for dataset paste geometry

Dataset evidence:

- 11 boards contain footprint graphics on `F.Paste` / `B.Paste`
- Pad-level paste overrides appear in 5 boards:
  `solder_paste_margin`, `solder_paste_margin_ratio`

What is missing:

- No dedicated paste-layer output is emitted.
- `pcb_solder_paste` is not emitted.

Dataset references:

- [sample007-dual-gmsl-serializer-adapter custom pad on `B.Paste`](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample007-dual-gmsl-serializer-adapter.kicad_pcb#L41018-L41028)
- [sample012-oculink-pcie-adapter `solder_paste_margin`](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample012-oculink-pcie-adapter.kicad_pcb#L154555-L154555)
- [sample009-gmsl-serializer `solder_paste_margin_ratio`](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample009-gmsl-serializer.kicad_pcb#L162357-L162357)

## Partial / Lossy

### 1. Custom pad geometry is only partially implemented

Dataset evidence:

- 63 custom SMD pads across 6 boards
- Custom pad primitives seen in dataset:
  `gr_arc` x416, `gr_line` x80, `gr_poly` x9
- `trapezoid` pads appear in 2 boards

Current behavior:

- [process-pads.ts](/home/manish/repo/ts/kicad-to-circuit-json/lib/stages/pcb/CollectFootprintsStage/process-pads.ts:252)
  handles custom pad primitives only for `gr_poly` and `gr_circle`
- `gr_arc` and `gr_line` custom primitives are ignored
- Unknown shapes fall through to a plain rectangle at
  [process-pads.ts](/home/manish/repo/ts/kicad-to-circuit-json/lib/stages/pcb/CollectFootprintsStage/process-pads.ts:496)

Impact:

- Custom connector pads, rounded tabs, and shaped copper lands are flattened or wrong.
- `trapezoid` pads are currently downgraded to `rect`.

Affected boards:

- `sample007-dual-gmsl-serializer-adapter`
- `sample009-gmsl-serializer`
- `sample010-hdmi-edid-debug-board`
- `sample012-oculink-pcie-adapter`
- `sample014-ov9281-camera-board`
- `sample016-usb-c-power-adapter`

Dataset references:

- [sample007-dual-gmsl-serializer-adapter custom pad with `gr_arc` primitives](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample007-dual-gmsl-serializer-adapter.kicad_pcb#L41018-L41040)
- [sample012-oculink-pcie-adapter custom pad with `zone_connect`](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample012-oculink-pcie-adapter.kicad_pcb#L26563-L26570)
- [sample012-oculink-pcie-adapter trapezoid pads](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample012-oculink-pcie-adapter.kicad_pcb#L188847-L188862)

### 2. Zone conversion is very lossy

Dataset evidence:

- 248 zones across the 16 boards
- Zone properties present in dataset:
  `priority`, `connect_pads`, `clearance`, `min_thickness`,
  `filled_areas_thickness`, `thermal_gap`, `thermal_bridge_width`,
  `thermal_bridge_angle`, `hatch`, `island_removal_mode`,
  `island_area_min`, `smoothing`, `radius`

Current behavior:

- [CollectZonesStage.ts](/home/manish/repo/ts/kicad-to-circuit-json/lib/stages/pcb/CollectZonesStage.ts:71)
  emits only:
  `layer`, `net_name`, `points`, `shape: "polygon"`

Lost properties:

- Keepout semantics
- Thermal settings
- Pad-connect style
- Hatch and smoothing
- Priority
- Island removal rules
- Fill/min-thickness settings

Dataset references:

- [sample009-gmsl-serializer zone with `priority`, `smoothing`, `radius`](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample009-gmsl-serializer.kicad_pcb#L335162-L335180)
- [sample015-sdi-fiber-adapter zone with `island_removal_mode` and `island_area_min`](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample015-sdi-fiber-adapter.kicad_pcb#L567024-L567041)
- [sample012-oculink-pcie-adapter zone with `priority` and filled copper settings](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample012-oculink-pcie-adapter.kicad_pcb#L544141-L544156)

### 3. Non-copper zones are mis-modeled or skipped

Dataset evidence:

- Non-copper zones appear in 3 boards:
  mask, paste, silkscreen, and `Edge.Cuts`-mixed zone layer sets

Current behavior:

- [CollectZonesStage.ts](/home/manish/repo/ts/kicad-to-circuit-json/lib/stages/pcb/CollectZonesStage.ts:132)
  routes `zone.layer` through `mapKicadLayerToLayerRef`, which defaults to top/bottom layer refs.

Impact:

- Mask/paste/silkscreen zones are not represented as their real layer type.
- Some non-copper zones can be coerced into fake copper pours.

Dataset references:

- [sample006-ddr5-testbed `F.Mask` zone](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample006-ddr5-testbed.kicad_pcb#L237653-L237675)
- [sample015-sdi-fiber-adapter `*.Mask` + `F.Paste` multi-layer zone](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample015-sdi-fiber-adapter.kicad_pcb#L567712-L567745)

### 4. Top-level graphics support is patchy

Dataset evidence:

- `gr_circle` on non-`Edge.Cuts` appears in 2 boards
- `gr_rect` on silkscreen/comment layers appears in 8 boards
- `gr_poly` on silkscreen appears in 5 boards
- `gr_text` on note/copper/mask layers appears in 14 boards

Current behavior:

- [CollectGraphicsStage.ts](/home/manish/repo/ts/kicad-to-circuit-json/lib/stages/pcb/CollectGraphicsStage.ts:145)
  accepts `gr_circle` only on `Edge.Cuts`
- [CollectGraphicsStage.ts](/home/manish/repo/ts/kicad-to-circuit-json/lib/stages/pcb/CollectGraphicsStage.ts:740)
  maps `gr_rect` only to filled copper pads, fabrication notes, or courtyard rects
- [CollectGraphicsStage.ts](/home/manish/repo/ts/kicad-to-circuit-json/lib/stages/pcb/CollectGraphicsStage.ts:934)
  maps `gr_poly` only to filled copper pads or courtyard outlines
- [CollectGraphicsStage.ts](/home/manish/repo/ts/kicad-to-circuit-json/lib/stages/pcb/CollectGraphicsStage.ts:828)
  maps text only when render layer resolves to silkscreen, fabrication, or copper

Impact:

- Silkscreen circles/rectangles/polygons outside the supported cases disappear.
- User/comment/drawing annotations disappear.
- Copper text works, but mask/user note text does not.

Dataset references:

- [sample004-arduino-nano top-level `gr_poly`](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample004-arduino-nano.kicad_pcb#L8932-L8938)
- [sample004-arduino-nano top-level `gr_rect`](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample004-arduino-nano.kicad_pcb#L9007-L9018)
- [sample013-ov5640-dual-camera-board top-level `gr_text` on `F.Cu` and `F.Mask`](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample013-ov5640-dual-camera-board.kicad_pcb#L9222-L9231)

### 5. Footprint graphics outside silk/fab/courtyard are dropped

Dataset evidence:

- Footprint user/comment graphics appear in all 16 boards
- Footprint copper/mask/paste graphics appear in 11 boards
- `fp_curve` appears in 1 board (`sample015-sdi-fiber-adapter`)

Current behavior:

- [process-graphics.ts](/home/manish/repo/ts/kicad-to-circuit-json/lib/stages/pcb/CollectFootprintsStage/process-graphics.ts:81)
  processes only `fp_line`, `fp_rect`, `fp_circle`, `fp_arc`, `fp_poly`
- Each primitive is gated by `isPcbAnnotationRenderLayer(...)`, so only
  silkscreen, fabrication, and courtyard survive
- `fp_curve` is not processed at all

Impact:

- User/comment helper geometry is lost.
- Footprint copper logos, mask windows, and paste-only geometry are lost.

Dataset references:

- [sample015-sdi-fiber-adapter `fp_curve` on `User.9`](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample015-sdi-fiber-adapter.kicad_pcb#L122825-L122844)
- [sample012-oculink-pcie-adapter footprint `fp_circle` on `F.Mask`](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample012-oculink-pcie-adapter.kicad_pcb#L467-L477)
- [sample012-oculink-pcie-adapter footprint `fp_rect` / `fp_line` on `User.5` / `User.9`](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample012-oculink-pcie-adapter.kicad_pcb#L827-L847)

### 6. Footprint attrs and most footprint properties are ignored

Dataset evidence:

- `dnp=true` appears in 12 boards
- `board_only=true` appears in 6 boards
- `exclude_from_bom` / `exclude_from_pos_files` appear in all 16 boards
- Common footprint properties in dataset:
  `Manufacturer`, `MPN`, `Tolerance`, `Voltage`, `Current`, `Color`,
  `Size`, `PARTREV`, `MAXIMUM_PACKAGE_HEIGHT`, simulation fields

Current behavior:

- [process-footprint.ts](/home/manish/repo/ts/kicad-to-circuit-json/lib/stages/pcb/CollectFootprintsStage/process-footprint.ts:43)
  only keeps a narrow subset on `source_component`:
  `name`, `ftype`, `transistor_type`, `supplier_part_numbers.jlcpcb`,
  and one of `resistance` / `capacitance` / `inductance`

Impact:

- BOM-related and assembly-related intent is lost.
- DNP/board-only state is not preserved.
- Manufacturer/MPN metadata is mostly dropped.

Dataset references:

- [sample006-ddr5-testbed `attr ... dnp`](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample006-ddr5-testbed.kicad_pcb#L34574-L34574)
- [sample012-oculink-pcie-adapter `attr board_only exclude_from_bom`](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample012-oculink-pcie-adapter.kicad_pcb#L32735-L32735)
- [sample012-oculink-pcie-adapter `Manufacturer` / `MPN` properties](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample012-oculink-pcie-adapter.kicad_pcb#L411-L424)

### 7. Component-type inference is too coarse for the dataset

Dataset evidence:

- `446` components end up as `simple_chip`
- At least `239` connector/test-point/crystal/fuse/ferrite-bead-like footprints
  are inferred as `simple_chip`
- Examples:
  `J*`, `TP*`, `Y*`, `F*`, `FB*`

Current behavior:

- [infer-component-type.ts](/home/manish/repo/ts/kicad-to-circuit-json/lib/stages/pcb/CollectFootprintsStage/infer-component-type.ts:23)
  only recognizes a small reference-prefix set
- `J` / `P` are explicitly forced to `simple_chip` at
  [infer-component-type.ts](/home/manish/repo/ts/kicad-to-circuit-json/lib/stages/pcb/CollectFootprintsStage/infer-component-type.ts:45)

Impact:

- Connectors, crystals/resonators, fuses, ferrite beads, and test points are not typed precisely.

Dataset references:

- [sample001-arduino-leonardo USB connector `J1`](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample001-arduino-leonardo.kicad_pcb#L595-L625)
- [sample001-arduino-leonardo test point `TP1`](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample001-arduino-leonardo.kicad_pcb#L14444-L14475)
- [sample005-arduino-uno resonator `Y1`](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample005-arduino-uno.kicad_pcb#L1095-L1124)
- [sample005-arduino-uno USB connector `J8`](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample005-arduino-uno.kicad_pcb#L4979-L5009)
- [sample005-arduino-uno fuse `F2`](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample005-arduino-uno.kicad_pcb#L11380-L11408)

### 8. Via metadata is flattened away

Dataset evidence:

- All 3201 vias carry KiCad `free` and `locked` flags

Current behavior:

- The converter emits plain `pcb_via` geometry only.

Impact:

- Via editability/placement intent is lost.

Dataset references:

- [sample012-oculink-pcie-adapter locked via](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample012-oculink-pcie-adapter.kicad_pcb#L128156-L128156)
- [sample012-oculink-pcie-adapter free via](https://github.com/tscircuit/dataset-srj18/blob/main/kicad_pcb/sample012-oculink-pcie-adapter.kicad_pcb#L528428-L528428)

## Loosely implemented

### 1. Curves and circles are approximated into point routes

Current behavior:

- Top-level edge arcs/curves and footprint arcs/circles are polygonized into route points.

Impact:

- Visually acceptable for rendering, but not exact analytic geometry.

### 2. Board outline extraction assumes one main contour

Current behavior:

- [CollectGraphicsStage.ts](/home/manish/repo/ts/kicad-to-circuit-json/lib/stages/pcb/CollectGraphicsStage.ts:220)
  picks the largest contour as `pcb_board.outline` and converts other closed contours to cutouts/holes.

Impact:

- Good for normal single-board files.
- Not rich enough for panel/multi-board semantics.

## Highest-value next steps

1. Add real `pcb_keepout` emission from zone keepout data.
2. Upgrade custom pad support to handle `gr_arc`, `gr_line`, and `trapezoid`.
3. Add note-layer output for `gr_text`, `gr_line`, `gr_rect`, and `dimension`.
4. Preserve zone properties instead of collapsing everything to bare `pcb_copper_pour`.
5. Support footprint copper/mask/paste graphics and `fp_curve`.
6. Improve `source_component.ftype` inference for connectors, test points, crystals, fuses, and ferrite beads.

## Deep rerun on current repo state (2026-06-23)

This section is a fresh rerun against the current local codebase, not just the
earlier draft notes above.

Notable delta from the older audit:

- PCB `ftype` inference now emits `simple_switch` for `SW*` references at
  [infer-component-type.ts](/home/manish/repo/ts/kicad-to-circuit-json/lib/stages/pcb/CollectFootprintsStage/infer-component-type.ts:32),
  but the dataset still shows broader missing `ftype` coverage beyond that one case.

Current dataset-wide emitted PCB/source `ftype` totals:

- `simple_chip`: 446
- `simple_capacitor`: 489
- `simple_resistor`: 469
- `simple_diode`: 51
- `simple_led`: 58
- `simple_inductor`: 30
- `simple_transistor`: 32
- `simple_fiducial`: 31
- `simple_switch`: 1

Still completely absent in dataset output:

- `pcb_keepout`
- `pcb_net`
- `pcb_group`
- `pcb_solder_paste`
- `pcb_note_text`
- `pcb_note_path`
- `pcb_note_rect`
- `pcb_note_line`
- `pcb_note_dimension`
- `pcb_text`

High-signal aggregate evidence from the 16 boards:

- `keepout`: 19 occurrences across 4 boards
- `group`: 38 occurrences across 13 boards
- `dimension`: 34 occurrences across 8 boards
- Custom pads: 63 across 6 boards
- Trapezoid pads: 12 across 1 board
- Unsupported custom-pad primitives still present in dataset:
  `gr_arc` x416, `gr_line` x80, `gr_poly` x9
- Top-level note/user/mask-style graphics still needing dedicated output:
  `gr_text` x229, unsupported line/arc x406, rect x118, poly x20, circle x24
- Footprint graphics currently dropped outside the supported annotation subset:
  user/comment-style x330096, copper/mask/paste x723
- `fp_curve`: 6 occurrences on 1 board
- `via free`: 595 vias across 9 boards
- Footprint attrs currently dropped:
  `dnp` on 152 footprints, `board_only` on 15 footprints,
  `exclude_from_bom` on 304 footprints, `exclude_from_pos_files` on 221 footprints
- Pad/zone properties present in dataset but not preserved as first-class output:
  `solder_paste_margin` x132, `solder_paste_margin_ratio` x15,
  `solder_mask_margin` x253, `clearance` x343, `zone_connect` x14,
  `priority` x182, `thermal_gap` x248, `thermal_bridge_width` x248,
  `thermal_bridge_angle` x98, `min_thickness` x248,
  `filled_areas_thickness` x244, `island_removal_mode` x27,
  `island_area_min` x27, `smoothing` x16, `radius` x16

### Board Matrix

The table below is the compact board-by-board audit view. `expected extra ftypes`
means the dataset clearly contains parts that should map to more specific source
component families than the current PCB path emits.

| Board | keepout | non-Cu zones | custom pads | `fp_curve` | free vias | DNP footprints | `simple_chip` count | expected extra ftypes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Arduino Leonardo | 0 | 0 | 0 | 0 | 0 | 3 | 26 | `connector`, `crystal`, `fuse`, `pin_header`, `switch`, `test_point` |
| Arduino Mega 2560 | 0 | 0 | 0 | 0 | 0 | 2 | 32 | `connector`, `crystal`, `fuse`, `mosfet`, `pin_header`, `resonator`, `switch` |
| Arduino Micro | 0 | 0 | 0 | 0 | 0 | 0 | 16 | `connector`, `crystal`, `fuse`, `pin_header`, `switch`, `test_point` |
| Arduino Nano | 0 | 0 | 0 | 0 | 0 | 0 | 13 | `connector`, `fuse`, `pin_header`, `resonator`, `switch`, `test_point` |
| Arduino Uno | 0 | 0 | 0 | 0 | 0 | 2 | 28 | `connector`, `crystal`, `fuse`, `pin_header`, `resonator`, `switch` |
| DDR5_TESTBED | 0 | 3 | 0 | 0 | 0 | 1 | 14 | `connector`, `fuse`, `test_point` |
| DUAL_GMSL_SERIALIZER_ADAPTER | 0 | 0 | 24 | 0 | 26 | 28 | 48 | `connector`, `test_point` |
| FTDI_TOOLKIT | 0 | 0 | 0 | 0 | 5 | 0 | 41 | `connector`, `crystal`, `fuse`, `mosfet`, `pin_header` |
| GMSL_SERIALIZER | 12 | 0 | 2 | 0 | 86 | 6 | 23 | `connector`, `mosfet`, `resonator`, `test_point` |
| HDMI_EDID_DEBUG_BOARD | 0 | 0 | 16 | 0 | 0 | 4 | 32 | `connector`, `crystal`, `fuse`, `mosfet`, `pin_header`, `test_point` |
| JOB_OCULINK_EXPANSION | 0 | 0 | 0 | 0 | 33 | 18 | 29 | `connector`, `test_point` |
| OCULINK_PCIE_ADAPTER | 0 | 0 | 4 | 0 | 135 | 20 | 33 | `connector`, `fuse`, `mosfet`, `test_point` |
| OV5640_DUAL_CAMERA_BOARD | 4 | 0 | 0 | 0 | 58 | 0 | 23 | `connector`, `crystal`, `fuse`, `test_point` |
| OV9281_CAMERA_BOARD | 0 | 0 | 16 | 0 | 42 | 15 | 18 | `connector`, `crystal`, `fuse`, `mosfet` |
| SDI_FIBER_ADAPTER | 2 | 4 | 0 | 6 | 88 | 43 | 39 | `connector`, `fuse`, `pin_header`, `test_point` |
| USB_C_POWER_ADAPTER | 1 | 1 | 1 | 0 | 122 | 10 | 31 | `connector`, `fuse`, `test_point` |

### Missing Or Partial PCB `ftype` Coverage In This Dataset

These are the source-component families that the dataset clearly needs on the
PCB path right now:

- `simple_connector`: present on all 16 boards
- `simple_fuse`: present on 13 boards
- `simple_test_point`: present on 12 boards
- `simple_pin_header`: present on 8 boards
- `simple_crystal`: present on 8 boards
- `simple_mosfet`: present on 6 boards
- `simple_resonator`: present on 4 boards
- `simple_switch`: only partly handled; `SW*` now works, but switch-like parts are still not comprehensively inferred across the dataset
- `simple_push_button`: still not emitted on the PCB path as a distinct family in this dataset

### Additional Property Gaps Confirmed

These are not just missing element types. They are real dataset properties that
exist in the KiCad files today, but are still being dropped or flattened:

- Pad-level properties:
  `solder_paste_margin`, `solder_paste_margin_ratio`, `solder_mask_margin`,
  `clearance`, `zone_connect`
- Zone-level properties:
  `priority`, `connect_pads`, `min_thickness`, `filled_areas_thickness`,
  `thermal_gap`, `thermal_bridge_width`, `thermal_bridge_angle`, `hatch`,
  `island_removal_mode`, `island_area_min`, `smoothing`, `radius`
- Footprint attrs:
  `dnp`, `board_only`, `exclude_from_bom`, `exclude_from_pos_files`
- Via metadata:
  `free` is present in the dataset, but current `pcb_via` output keeps only geometry/layer span
