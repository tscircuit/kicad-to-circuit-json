# kicad-to-circuit-json

Convert KiCad schematic and PCB files to Circuit JSON format.

## Installation

```bash
npm install kicad-to-circuit-json
# or
bun install kicad-to-circuit-json
```

## Usage

```typescript
import { KicadToCircuitJsonConverter } from "kicad-to-circuit-json"
import fs from "fs"

// Create a converter instance
const converter = new KicadToCircuitJsonConverter()

// Add KiCad files
const pcbContent = fs.readFileSync("path/to/file.kicad_pcb", "utf-8")
const schContent = fs.readFileSync("path/to/file.kicad_sch", "utf-8")

converter.addFile("example.kicad_pcb", pcbContent)
converter.addFile("example.kicad_sch", schContent)

// Run the conversion
converter.runUntilFinished()

// Get the Circuit JSON output
const circuitJson = converter.getOutput()
console.log(JSON.stringify(circuitJson, null, 2))

// Get diagnostics
console.log("Warnings:", converter.getWarnings())
console.log("Stats:", converter.getStats())
```

## Architecture

The converter uses a staged pipeline architecture that mirrors the circuit-json-to-kicad converter:

### Schematic Pipeline

1. **InitializeSchematicContextStage** - Sets up coordinate transformations (KiCad → Circuit JSON)
2. **CollectLibrarySymbolsStage** - Extracts symbols and creates `source_component` + `schematic_component` entries
3. **CollectSchematicTracesStage** - Converts wires and junctions to `schematic_trace` elements

### PCB Pipeline

1. **InitializePcbContextStage** - Sets up PCB coordinate transformations
2. **CollectNetsStage** - Builds net number to name mappings
3. **CollectFootprintsStage** - Converts footprints to `pcb_component` with pads/holes
4. **CollectTracesStage** - Converts segments to `pcb_trace` elements
5. **CollectViasStage** - Converts vias to `pcb_via` elements
6. **CollectGraphicsStage** - Extracts board outline and silkscreen graphics

## Coordinate Transformations

The converter handles coordinate system differences between KiCad and Circuit JSON:

- **Schematic**: `scale(1/15, -1/15)` with translation (inverse of CJ→KiCad transform)
- **PCB**: `scale(1, -1)` with translation

## Supported Features

### Schematic
- ✅ Symbols/Components
- ✅ Symbol ports/pins
- ✅ Wires/traces
- ✅ Junctions
- ✅ Component properties (Reference, Value)
- ⚠️ Net labels (partial)
- ⚠️ Power symbols (partial)

### PCB
- ✅ Footprints/Components
- ✅ SMD pads
- ✅ Through-hole pads (plated holes)
- ✅ NPTH holes
- ✅ Traces/Segments
- ✅ Vias
- ✅ Board outline (Edge.Cuts)
- ✅ Silkscreen graphics
- ✅ Net mappings

## MVP Limitations

This is an MVP implementation. Some limitations include:

- Component sizes are estimated (not derived from actual symbol geometry)
- Port positions are simplified (not fully transformed relative to component)
- Trace routing is basic (segments grouped by net/layer)
- Some pad shapes may not map perfectly
- Power symbols and net labels need enhancement
- Multi-sheet schematics not fully tested

## Development

```bash
# Install dependencies
bun install

# Build
bun run build

# Type check
bunx tsc --noEmit

# Test
bun test
```

## Related Projects

- [circuit-json-to-kicad](https://github.com/tscircuit/circuit-json-to-kicad) - Convert Circuit JSON to KiCad (reverse direction)
- [circuit-to-svg](https://github.com/tscircuit/circuit-to-svg) - Render Circuit JSON as SVG

## License

MIT
