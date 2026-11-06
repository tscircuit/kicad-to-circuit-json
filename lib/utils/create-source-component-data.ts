import type { AnyCircuitElementInput } from "circuit-json"

export type ImportedComponentFtype =
  | "simple_resistor"
  | "simple_capacitor"
  | "simple_inductor"
  | "simple_diode"
  | "simple_led"
  | "simple_test_point"
  | "simple_transistor"
  | "simple_chip"
  | "simple_pin_header"
  | "simple_switch"
  | "simple_fiducial"

type ComponentData<T> = T extends { type: "source_component" }
  ? Omit<T, "type" | "source_component_id">
  : never

/** Supply the required electrical fields consistently for every import path. */
export function createSourceComponentData({
  name,
  ftype,
  value,
  manufacturerPartNumber,
  pinCount,
  gender,
  transistorType,
}: {
  name: string
  ftype: ImportedComponentFtype
  value?: string
  manufacturerPartNumber?: string
  pinCount?: number
  gender?: "male" | "female"
  transistorType?: "npn" | "pnp"
}): ComponentData<AnyCircuitElementInput> {
  const base = {
    name,
    ...(value ? { display_value: value } : {}),
    ...(manufacturerPartNumber
      ? { manufacturer_part_number: manufacturerPartNumber }
      : {}),
  }
  const passiveValue = value?.replaceAll(",", ".") || 0
  switch (ftype) {
    case "simple_resistor":
      return { ...base, ftype, resistance: passiveValue }
    case "simple_capacitor":
      return { ...base, ftype, capacitance: passiveValue }
    case "simple_inductor":
      return { ...base, ftype, inductance: passiveValue }
    case "simple_transistor":
      return {
        ...base,
        ftype,
        transistor_type:
          transistorType ??
          (/pnp/i.test(`${name} ${value ?? ""}`) ? "pnp" : "npn"),
      }
    case "simple_pin_header": {
      const dimensions = name.match(/(?:pinheader|pinsocket|conn)_(\d+)x(\d+)/i)
      return {
        ...base,
        ftype,
        pin_count:
          pinCount ||
          (dimensions ? Number(dimensions[1]) * Number(dimensions[2]) : 1),
        gender: gender ?? (/socket|female/i.test(name) ? "female" : "male"),
      }
    }
    default:
      return { ...base, ftype }
  }
}
