import {
  type AnyCircuitElementInput,
  capacitance,
  inductance,
  resistance,
} from "circuit-json"
import type { SchematicSymbol } from "kicadts"
import { inferSourceComponentFtype } from "../symbol-library/infer-source-component-ftype"

type ComponentData<T> = T extends { type: "source_component" }
  ? Omit<T, "type" | "source_component_id">
  : never

type SourceComponentResult = {
  data: ComponentData<AnyCircuitElementInput>
  warning?: string
}

const passiveSchemas = {
  simple_resistor: resistance,
  simple_capacitor: capacitance,
  simple_inductor: inductance,
}

function collectPinNumbers(symbol: SchematicSymbol): string[] {
  return [
    ...symbol.pins.map((pin) => pin.numberString?.trim() ?? ""),
    ...symbol.subSymbols.flatMap(collectPinNumbers),
  ].filter(Boolean)
}

/** Build source data once, keeping display metadata separate from electrical fields. */
export function createSchematicSourceComponentData(
  symbol: SchematicSymbol,
  librarySymbol?: SchematicSymbol,
): SourceComponentResult {
  const properties = Object.fromEntries(
    symbol.properties.map((property) => [property.key, property.value]),
  )
  const reference = properties.Reference || "U?"
  const name = symbol.libraryId || reference
  const value = properties.Value
  const manufacturerPartNumber =
    properties.MPN ||
    properties["Manufacturer Part Number"] ||
    properties["P/N"]
  const base = {
    name,
    ...(value ? { display_value: value } : {}),
    ...(manufacturerPartNumber
      ? { manufacturer_part_number: manufacturerPartNumber }
      : {}),
  }
  const metadata = [
    name,
    ...[...symbol.properties, ...(librarySymbol?.properties ?? [])]
      .filter((property) =>
        ["Value", "Description", "ki_keywords", "Footprint"].includes(
          property.key,
        ),
      )
      .map((property) => property.value),
  ].join(" ")
  const ftype = inferSourceComponentFtype({ name, reference, metadata })
  const incomplete = (reason: string): SourceComponentResult => ({
    data: { ...base, ftype: "simple_chip" },
    warning: `Symbol ${reference} (${name}): ${reason}; imported as a generic source component.`,
  })

  const electricalValue = (value ?? "").replaceAll(",", ".")
  if (ftype in passiveSchemas) {
    const schema = passiveSchemas[ftype as keyof typeof passiveSchemas]
    try {
      if (
        !electricalValue.trim() ||
        !Number.isFinite(schema.parse(electricalValue))
      ) {
        return incomplete("missing or invalid electrical Value")
      }
    } catch {
      return incomplete("missing or invalid electrical Value")
    }
  }

  switch (ftype) {
    case "simple_resistor":
      return { data: { ...base, ftype, resistance: electricalValue } }
    case "simple_capacitor":
      return { data: { ...base, ftype, capacitance: electricalValue } }
    case "simple_inductor":
      return { data: { ...base, ftype, inductance: electricalValue } }
    case "simple_transistor": {
      const npn = /(?:^|[^a-z])npn(?=[^a-z]|$)/i.test(metadata)
      const pnp = /(?:^|[^a-z])pnp(?=[^a-z]|$)/i.test(metadata)
      if (npn === pnp) return incomplete("unknown or ambiguous BJT polarity")
      return { data: { ...base, ftype, transistor_type: pnp ? "pnp" : "npn" } }
    }
    case "simple_pin_header": {
      const dimensions = name.match(/(?:pinheader|pinsocket|conn)_(\d+)x(\d+)/i)
      const pinCount =
        (librarySymbol && new Set(collectPinNumbers(librarySymbol)).size) ||
        (dimensions ? Number(dimensions[1]) * Number(dimensions[2]) : 0)
      if (!pinCount) return incomplete("unknown pin header pin count")
      return {
        data: {
          ...base,
          ftype,
          pin_count: pinCount,
          gender: /socket|female/i.test(metadata) ? "female" : "male",
        },
      }
    }
    default:
      return { data: { ...base, ftype } }
  }
}
