Below is a practical, implementation‑oriented plan to build the **kicad‑to‑circuit‑json** solver. I’ve split it into (1) a punch‑list you can work through, (2) a proposed architecture (mirroring the working _circuit‑json‑to‑kicad_ pipeline you already have), and (3) concrete recommendations and gotchas.

---

## 1) Implementation checklist (from MVP → robust)

**A. Repository & scaffolding**

- [ ] Reuse the existing `KicadToCircuitJsonConverter` shell and turn it into a staged pipeline (symmetry with your CJ→KiCad design).
- [ ] Bring over the generic `ConverterStage<Input, Output>` base pattern from your CJ→KiCad repo (abstract class with `step()`, `runUntilFinished()`, `finished` flag, etc.) to replace the empty `ConverterStage` interface on the KiCad→CJ side. This keeps both directions consistent.

**B. Inputs & parsing**

- [ ] Accept a map of file paths → contents (already supported by `addFile()`), find exactly one `.kicad_sch` and one `.kicad_pcb` (or allow either one).
- [ ] Parse with `kicadts` (`parseKicadSch`, `parseKicadPcb`) and create a `cju([])` database in your converter context.

**C. Coordinate systems & transforms**

- [ ] Define **KiCad→Circuit JSON** transforms for schematic and PCB. Your CJ→KiCad schematic used `scale(15, -15)` plus centering; the inverse is `scale(1/15, -1/15)` plus inverse translations. PCB used `scale(1, -1)`; inverse is `scale(1, -1)` again with appropriate translation. Keep these matrices in context as `k2cMatSch`, `k2cMatPcb`.

**D. Schematic pipeline (KiCadSch → circuit-json)**

- [ ] **InitializeSchematicContext** (paper size, UUID, transform). (mirror of `InitializeSchematicStage`)
- [ ] **ExtractLibrarySymbols** → translate lib symbols and instance symbols to CJ `schematic_component` + `schematic_port` data. (mirror of `AddLibrarySymbolsStage` + `AddSchematicSymbolsStage`)
- [ ] **ExtractNetLabels** → map power/ground symbols and regular labels into CJ `schematic_net_label` with `anchor_position`, `anchor_side`, etc. (mirror of `AddSchematicNetLabelsStage`)
- [ ] **ExtractTraces** → convert KiCad wires & junctions to CJ `schematic_trace.edges` and `junctions`. (mirror of `AddSchematicTracesStage`)
- [ ] **FinalizeSchematic** → compute bounds/center for CJ using the inverse of your existing helper logic. (mirror of `getSchematicBoundsAndCenter`)

**E. PCB pipeline (KicadPcb → circuit-json)**

- [ ] **InitializePcbContext** (layers, general, setup ignored for CJ; keep transform). (mirror of `InitializePcbStage`)
- [ ] **ExtractNets** → translate KiCad nets into CJ naming (you used `Net-<trace_id>` going _to_ KiCad; invert that on the way back, preferring meaningful names when available). (mirror of `AddNetsStage`)
- [ ] **ExtractFootprints** → each KiCad `Footprint` becomes a `pcb_component` + associated pads/holes/text. You already have one‑way utilities for pads/text—use them as shape/field guides for the reverse direction. (mirror of `AddFootprintsStage` and `Create*FromCircuitJson` helpers)
- [ ] **ExtractTraces & Vias** → segments → `pcb_trace.route[]`; vias → `pcb_via` with proper net mapping. (mirror of `AddTracesStage`, `AddViasStage`)
- [ ] **ExtractGraphics & Board Outline** → convert `Edge.Cuts` and `gr_text`/`gr_line` into `pcb_board.outline` and `pcb_silkscreen_*`. (mirror of `AddGraphicsStage`)

**F. Integration & output**

- [ ] Compose a valid **CircuitJson** object from your `cju` db and return it.
- [ ] Provide a `getOutput()` and `getOutputString()` like the CJ→KiCad converters.

**G. Tests & visual diffs**

- [ ] Use the existing snapshot harness: export KiCad to SVG/PNG with `kicad-cli` (your `take-kicad-snapshot.ts`) and export **your reconstructed CircuitJson** via `circuit-to-svg` (your `take-circuit-json-snapshot.ts`), then stack/compare PNGs with the tolerant matcher you already wrote.
- [ ] Build specimen tests: flat‑hierarchy schematic, simple 2‑layer PCB, text/labels, edge cuts, vias, SMD/TH pads, power symbols, etc.
- [ ] Use your PNG diff matcher (tolerance, CI knobs) for robust comparisons.

---

## 2) General architecture (symmetry with your CJ→KiCad pipeline)

You already have a clean, staged design for **CJ→KiCad** with:

- A **context** that stores the `cju` DB, KiCad AST objects, and transformation matrices.
- A **pipeline** of small, deterministic stages (`Initialize*`, `Add*Symbols`, `Add*Traces`, `Add*Graphics`, …).
- Deterministic **coordinate transforms**: Circuit JSON ↔ KiCad via `transformation-matrix`.

Replicate that architecture for **KiCad→CJ**:

### Core types & context

- **Context** (`ConverterContext`) should hold:

  - `db: cju([])` (write target),
  - parsed `kicadSch?`, `kicadPcb?`,
  - `k2cMatSch?`, `k2cMatPcb?`,
  - shared maps (e.g., `netNumToName`, `footprintUuid→pcb_component_id`),
    mirroring the fields used on the CJ→KiCad side (`c2kMatSch`, `c2kMatPcb`, net maps, etc.).

### Stages (schematic)

A good mirror for your schematic stages is:

1. **InitializeSchematicContextStage**

   - Build `k2cMatSch` (inverse of CJ→KiCad: `scale(1/15, -1/15)` and matching translations so the schematic content centers in CJ space).
   - Seed any `pinPositions`/`wireConnections` maps you want to accumulate.
     _(Reference how CJ→KiCad selected paper & centered content in `CircuitJsonToKicadSchConverter`.)_

2. **CollectLibrarySymbolsStage** (reverse of `AddLibrarySymbolsStage`)

   - From `lib_symbols` and placed symbol instances, create CJ `source_component` (with `ftype` heuristics) and `schematic_component`.
   - Ports: generate `schematic_port` by reading pins and projecting to CJ coordinates (`k2cMatSch`).

3. **CollectSchematicSymbolsStage** (reverse of `AddSchematicSymbolsStage`)

   - Place components (`schematic_component.center`), set `name` (Reference) & `value`.
   - Record chip geometry (approximate `size.width/height`) from symbol primitives if available, otherwise infer from pin extents.

4. **CollectNetLabelsStage** (reverse of `AddSchematicNetLabelsStage`)

   - Map power symbols (library `Custom:*` like `vcc_up`, `ground_down`) to CJ `schematic_net_label` with `symbol_name`, `text`, `anchor_position`, `anchor_side`.
   - Regular labels become `schematic_net_label` without `symbol_name`.

5. **CollectSchematicTracesStage** (reverse of `AddSchematicTracesStage`)

   - Convert wires to `schematic_trace.edges` using `k2cMatSch`.
   - Junctions → `schematic_trace.junctions`.

6. **FinalizeSchematicStage**

   - Compute CJ bounds/center (inverse of `getSchematicBoundsAndCenter`) for any downstream consumers.

### Stages (PCB)

Mirror your PCB stages:

1. **InitializePcbContextStage**

   - Build `k2cMatPcb` (inverse of your CJ→KiCad PCB transform: you used `translate(100,100)` and `scale(1,-1)`, so invert appropriately).

2. **CollectNetsStage** (reverse of `AddNetsStage`)

   - From KiCad `nets`, construct a mapping to CJ names. Prefer KiCad’s actual names; fall back to deterministic `Net-<n>` if empty. Store map for traces/vias.

3. **CollectFootprintsStage** (reverse of `AddFootprintsStage`)

   - Each `Footprint` → CJ `pcb_component` with `center` and `rotation`.
   - `fp_text` → CJ `pcb_silkscreen_text` attached to the component; use inverse of your `createFpTextFromCircuitJson` logic to recover `anchor_position`, `layer`, `ccw_rotation`, etc.
   - `fp_pads`:

     - SMD pads → `pcb_smtpad` (`shape`, `width/height` or `radius`, `layer` top/bottom).
     - TH pads → `pcb_plated_hole` with `shape` (`circle`, `pill`, …) and outer diameters; map drill (`PadDrill`) to CJ `hole_*` fields (mirror of `CreateThruHolePadFromCircuitJson`).
     - NPTH pads → `pcb_hole` (mirror of `CreateNpthPadFromCircuitJson`).

4. **CollectTracesStage** (reverse of `AddTracesStage`)

   - KiCad `Segment` → CJ `pcb_trace` with a `route` array (transform each segment endpoint through `k2cMatPcb`; group adjacent segments by net/layer).

5. **CollectViasStage** (reverse of `AddViasStage`)

   - KiCad `Via` → CJ `pcb_via` (`x,y`, `outer_diameter`, `hole_diameter`, `net_name` from map).

6. **CollectGraphicsStage** (reverse of `AddGraphicsStage`)

   - `gr_text` not bound to footprints → `pcb_silkscreen_text` (standalone).
   - `gr_line` on `Edge.Cuts` → `pcb_board.outline` polyline.
   - `gr_line` on silk layers → `pcb_silkscreen_path`.

7. **FinalizePcbStage**

   - If outline absent, derive a rectangular board from `Edge.Cuts` extents.

---

## 3) Detailed recommendations & mappings

### A) Bring stage base class parity

On the KiCad→CJ side you currently have only an empty `ConverterStage` interface and a skeletal `KicadToCircuitJsonConverter` with a `pipeline?: ConverterStage[]`. Port the **abstract base class** used by CJ→KiCad (with `step()`, `runUntilFinished()`, `finished`, `MAX_ITERATIONS`) so both directions share the same ergonomics. It will make your converters composable and testable in the same way.

### B) Coordinate transforms (exact mirrors)

| Domain        | CJ→KiCad (existing)                                                         | KiCad→CJ (implement)                                                                                                                                          |
| ------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Schematic** | `c2kMatSch = translate(KICAD_CENTER) ∘ scale(15, -15) ∘ translate(-center)` | `k2cMatSch ≈ inverse(c2kMatSch)` → `translate(center) ∘ scale(1/15, -1/15) ∘ translate(-KICAD_CENTER)` (apply actual numeric paper center used by KiCad file) |
| **PCB**       | `c2kMatPcb = translate(100,100) ∘ scale(1, -1)`                             | `k2cMatPcb ≈ translate(-100,-100) ∘ scale(1, -1)` (or compute exact inverse from `c2kMatPcb`)                                                                 |

Use the same `transformation-matrix` library you already use on CJ→KiCad. Keep the _Y inversion_ consistent, because you relied on `scale(_, -_)` throughout.

### C) Layers

- **Silk**: `F.SilkS` ↔ `top`, `B.SilkS` ↔ `bottom`.
- **Copper**: `F.Cu` ↔ `top`, `B.Cu` ↔ `bottom`.
- Preserve unknown layers as raw strings in CJ (forward‑compat). You already map these the other direction; reuse the same tables reversed.

### D) Pads & holes (shape fidelity)

Use your “create‑\*FromCircuitJson” functions as a **spec** for what CJ expects:

- **SMD pad**: recover `shape` (`circle` vs `rect`), `radius` OR `width/height`, and **component‑relative** position (undo component rotation and center). That’s precisely the inverse of your SMD utility.
- **TH pad / plated hole**: reconstitute the correct variant (`circle`, `oval/pill`, `*_with_rect_pad`, `rotated_*`) and its rotation. Your forward mapping handles all of these—mirror it back.
- **NPTH**: map `PadDrill` (oval vs circle) and size back to CJ’s `pcb_hole`.

> Tip: For component‑local coordinates, you already rotate/translate **to** KiCad using per‑component rotation matrices. Build the inverse to express pads/holes/text back **relative to** the component center in CJ.

### E) Traces, vias, nets

- **Segments**: stitch collinear, contiguous segments into a single CJ `route` polyline per `pcb_trace` if you want a cleaner model; otherwise 1‑segment‑per‑edge also works for MVP. Net comes from your `net` mapping.
- **Vias**: `ViaNet(number)` → `net_name` via reverse lookup. Sizes map 1:1.
- **Net names**: Your forward pass created `Net-<trace_id>` defaults; on reverse, prefer KiCad’s explicit names (GND, VCC, etc.). Ensure net 0 handling (“no net”) is treated as unconnected or “GND” only when KiCad indicates so (your forward stage always inserted “GND”; consider being stricter on reverse to avoid inventing ground).

### F) Schematic symbols & ports

- **Instances**: From each `SchematicSymbol` instance, create a `schematic_component` at `k2cMatSch(at.x, at.y)`. Determine chip vs passive from library id (`Device:U_*` vs `Device:R_*`, `Device:C_*`, etc.)—that’s how your forward path derived library ids and reference prefixes.
- **Pins**: Convert KiCad pin geometry to `schematic_port` positions relative to the component center. Your forward logic snaps pins to box edges and orients them; reverse by measuring pin endpoints vs symbol box. If symbol primitives aren’t available, infer box from min/max pin extents.
- **Text**: The forward path positioned `Reference` and `Value` based on template fields (and sometimes hid `Value` for chips). On reverse, read those properties to populate `name`/`value` in CJ (hide flags don’t exist in CJ; just capture the text content).

### G) Graphics & board outline

- **Board**: Convert `Edge.Cuts` closed loops into a CJ `pcb_board.outline` (array of points). If multiple loops exist, treat the largest as the main outline (MVP).
- **Silk text/paths**: `gr_text`/`gr_line` on silk layers → `pcb_silkscreen_text` / `pcb_silkscreen_path` with stroke widths and `anchor_alignment` when detectable (you already encode `anchor_alignment` on the forward path; mirror reasonable defaults).

### H) Testing strategy (you already have the tools)

- **Visual parity**:

  1. KiCad input → (your solver) → Circuit JSON → PNG (`circuit-to-svg`).
  2. KiCad input → `kicad-cli ... export svg` → PNG.
  3. Stack/compare with your tolerant matcher + optional diff images.
     You already have `take-kicad-snapshot.ts`, `take-circuit-json-snapshot.ts`, `stackPngsVertically.ts`, and the cross‑platform `toMatchPngSnapshot` matcher. Use those directly.

- **Fixtures to cover**:

  - Single‑sheet schematic (R‑C‑U) with net labels (VCC/GND, arrows on left/right).
  - PCB with one SMD footprint, one TH connector, vias, silk text top/bottom, edge cuts rectangle and non‑rectangular outline.
  - Rotated components, rotated oval pads, NPTH mounting holes.
  - Multi‑segment tracks on both layers.

### I) Error handling & diagnostics

- Emit **warnings** (collect them in context) for: unknown pad shapes, missing footprints, library id not recognized, segments without nets, symbols without pins.
- Include a **stats** object (counts of components, pads, vias, traces, labels) to help tests assert completeness.

### J) Performance

- Both directions are linear in entities; keep transformations streaming within each stage. Avoid repeated matrix inversions—precompute `k2cMat*`.

---

## 4) Minimal code shape (illustrative pseudo‑TypeScript)

```ts
// lib/KicadToCircuitJsonConverter.ts
import { cju } from "@tscircuit/circuit-json-util"
import { parseKicadPcb, parseKicadSch } from "kicadts"
import { compose, scale, translate, inverse } from "transformation-matrix"

export class KicadToCircuitJsonConverter {
  fsMap: Record<string, string> = {}
  ctx!: {
    db: ReturnType<typeof cju>
    kicadPcb?: ReturnType<typeof parseKicadPcb>
    kicadSch?: ReturnType<typeof parseKicadSch>
    k2cMatSch?: any
    k2cMatPcb?: any
    // ...net maps, id maps, warnings, stats
  }
  pipeline: ConverterStage<any, any>[] = []
  currentStageIndex = 0

  addFile(path: string, content: string) {
    this.fsMap[path] = content
  }

  initializePipeline() {
    const pcbFile = this._findFileWithExtension(".kicad_pcb")
    const schFile = this._findFileWithExtension(".kicad_sch")

    this.ctx = {
      db: cju([]),
      kicadPcb: pcbFile ? parseKicadPcb(this.fsMap[pcbFile]!) : undefined,
      kicadSch: schFile ? parseKicadSch(this.fsMap[schFile]!) : undefined,
      // set k2cMat* after inspecting paper/centers if needed
    }

    this.pipeline = [
      new InitializeSchematicContextStage(this.ctx),
      new CollectLibrarySymbolsStage(this.ctx),
      new CollectSchematicSymbolsStage(this.ctx),
      new CollectNetLabelsStage(this.ctx),
      new CollectSchematicTracesStage(this.ctx),
      new InitializePcbContextStage(this.ctx),
      new CollectNetsStage(this.ctx),
      new CollectFootprintsStage(this.ctx),
      new CollectTracesStage(this.ctx),
      new CollectViasStage(this.ctx),
      new CollectGraphicsStage(this.ctx),
      new FinalizeOutputStage(this.ctx),
    ]
  }

  runUntilFinished() {
    /* identical to CJ→KiCad loop */
  }
  getOutput() {
    return this.ctx.db.toJSON()
  }
  getOutputString() {
    return JSON.stringify(this.getOutput(), null, 2)
  }
}
```

This mirrors the structure you use on the other direction; you can even **share the stage base class**.

---

## 5) Common pitfalls (and how to avoid them)

- **Y‑axis inversion drift**: If an element looks vertically mirrored when you render CJ→SVG, your inverse transform is off. Validate with 1–2 known anchor points per stage.
- **Angles**: KiCad angles are degrees CCW. CJ uses `ccw_rotation`. When converting **component‑relative** items (pads, silkscreen text), undo the component rotation first, then write CJ coords.
- **Net 0/GND confusion**: Don’t invent ground; read KiCad’s net table. Your forward “always add GND” convenience shouldn’t be mirrored blindly in reverse.
- **Pads without X/Y**: Your forward utilities explicitly “throw on polygon pads”. For reverse, start with circular/rectangular/oval and **warn** for polygons until you add support.
- **Symbol geometry**: If library geometry is missing, derive a minimal size box from pin extents so pin snapping is stable.

---

## 6) How your existing repos inform the implementation

- The **KiCad→CJ repo** already parses KiCad with `kicadts` and sets up a converter context; it only needs the staged pipeline and inverse transforms added.
- The **CJ→KiCad repo** is a complete reference for:

  - what your context should carry,
  - how to map symbols, text, pads, vias, traces, nets, outlines, and
  - how to do all coordinate math consistently.
    Use it as a “ground truth spec” for the reverse direction.

---

### Quick mapping crib sheet

**KiCad → Circuit JSON (schematic)**

- `SchematicSymbol@at` → `schematic_component.center` (through `k2cMatSch`).
- `SymbolProperty{Reference}` → `source_component.name` or `schematic_component.name`.
- `pins[]` → `schematic_port[]` with positions relative to component.
- Power symbols (`Custom:*`) → `schematic_net_label{symbol_name}`.
- `Wire`, `Junction` → `schematic_trace.edges`, `junctions`.

**KiCad → Circuit JSON (pcb)**

- `Footprint@at` → `pcb_component.center/rotation`.
- `FpText` (attached) → `pcb_silkscreen_text` with `anchor_position`, `layer`, `ccw_rotation`.
- `FootprintPad` (SMD) → `pcb_smtpad` (shape + size). TH/NPTH pads → `pcb_plated_hole` / `pcb_hole`.
- `Segment` → `pcb_trace.route[]` (grouped per net/layer). `Via` → `pcb_via`.
- `GrText/GrLine` (`F.SilkS/B.SilkS`) → `pcb_silkscreen_*`; `Edge.Cuts` lines → `pcb_board.outline`.

---

If you’d like, I can sketch one of the extraction stages (e.g., **CollectFootprintsStage**) in actual TypeScript next—using the same matrix utilities and field names you already rely on.
