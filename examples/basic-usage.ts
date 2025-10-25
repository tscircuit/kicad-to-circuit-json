import { KicadToCircuitJsonConverter } from "../lib"

// Example: Convert a KiCad PCB file to Circuit JSON
const converter = new KicadToCircuitJsonConverter()

// Add your KiCad files
// converter.addFile("example.kicad_pcb", pcbFileContent)
// converter.addFile("example.kicad_sch", schFileContent)

// Run the conversion
converter.runUntilFinished()

// Get the Circuit JSON output
const circuitJson = converter.getOutput()
console.log("Circuit JSON:", JSON.stringify(circuitJson, null, 2))

// Get diagnostics
console.log("Warnings:", converter.getWarnings())
console.log("Stats:", converter.getStats())
