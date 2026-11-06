import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { any_source_component } from "circuit-json"
import { type KicadSch, parseKicadSch, SchematicSymbol } from "kicadts"
import { KicadToCircuitJsonConverter } from "../../../lib"

const schematic = readFileSync(
  new URL("./components.kicad_sch", import.meta.url),
  "utf8",
)

function convert(modify?: (schematic: KicadSch) => void) {
  const input = parseKicadSch(schematic)
  modify?.(input)
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("components.kicad_sch", input.getString())
  converter.runUntilFinished()
  const circuitJson = converter.getOutput()
  const components = circuitJson.filter(
    (element) => element.type === "source_component",
  )
  const getComponent = (name: string) => {
    const component = components.find((element) => element.name === name)
    if (!component) throw new Error(`Missing source component ${name}`)
    return component
  }
  return { converter, components, getComponent }
}

const cases = [
  ["Device:R", { ftype: "simple_resistor", resistance: 10_000 }],
  ["Device:C", { ftype: "simple_capacitor", capacitance: 1e-6 }],
  ["Device:L", { ftype: "simple_inductor", inductance: 2e-3 }],
  ["Device:Q_NPN", { ftype: "simple_transistor", transistor_type: "npn" }],
  ["Device:Q_PNP", { ftype: "simple_transistor", transistor_type: "pnp" }],
  [
    "Connector_Generic:Conn_01x04",
    { ftype: "simple_pin_header", pin_count: 4, gender: "male" },
  ],
  [
    "Connector:Conn_01x04_Socket",
    { ftype: "simple_pin_header", pin_count: 4, gender: "female" },
  ],
] as const

// The fix PR turns these expected failures into normal regression tests.
for (const [name, expected] of cases) {
  test.failing(`imports schema-valid ${name} data`, () => {
    const component = convert().getComponent(name)
    expect(component).toMatchObject({ ftype: expected.ftype })
    expect(any_source_component.parse(component)).toMatchObject(expected)
    const instance = parseKicadSch(schematic).symbols.find(
      (symbol) => symbol.libraryId === name,
    )!
    const properties = Object.fromEntries(
      instance.properties.map((property) => [property.key, property.value]),
    )
    expect(component.display_value).toBe(properties.Value)
    expect(component.manufacturer_part_number).toBe(properties.MPN)
  })
}

for (const [name, value, expected] of [
  ["Device:C", "4,7uF", { capacitance: 4.7e-6 }],
  ["Device:L", "2,2mH", { inductance: 2.2e-3 }],
] as const) {
  test.failing(`normalizes decimal commas for ${name}`, () => {
    const component = convert((input) => {
      input.symbols
        .find((symbol) => symbol.libraryId === name)!
        .properties.find((property) => property.key === "Value")!.value = value
    }).getComponent(name)
    expect(any_source_component.parse(component)).toMatchObject(expected)
    expect(component.display_value).toBe(value)
  })
}

test.failing("does not treat Value as MPN for any component type", () => {
  const { components } = convert((input) => {
    for (const symbol of input.symbols) {
      symbol.properties = symbol.properties.filter(
        (property) => property.key !== "MPN",
      )
    }
  })
  for (const component of components) {
    expect(component.manufacturer_part_number).toBeUndefined()
    expect(component.display_value).toBeDefined()
  }
})

test.failing("counts unique header pins across units and body styles", () => {
  const component = convert((input) => {
    const header = input.libSymbols!.symbols.find(
      (symbol) => symbol.libraryId === "Connector_Generic:Conn_01x04",
    )!
    const extraPins = parseKicadSch(`(kicad_sch (version 20250114)
      (lib_symbols (symbol "Extra" (symbol "Extra_2_1"
        (pin passive line (at 0 0 0) (length 1.27) (name "Pin_1") (number "1"))
        (pin passive line (at 0 0 0) (length 1.27) (name "Pin_5") (number "5"))))))`)
      .libSymbols!.symbols[0]!.subSymbols[0]!.pins
    header.subSymbols.push(
      new SchematicSymbol({ libraryId: "Conn_01x04_2_1", pins: extraPins }),
    )
  }).getComponent("Connector_Generic:Conn_01x04")
  expect(component).toMatchObject({ ftype: "simple_pin_header", pin_count: 5 })
})

for (const name of ["Device:R", "Device:C", "Device:L"]) {
  test.failing(`does not invent an electrical value for ${name}`, () => {
    const { converter, getComponent } = convert((input) => {
      const instance = input.symbols.find(
        (symbol) => symbol.libraryId === name,
      )!
      instance.properties = instance.properties.filter(
        (property) => property.key !== "Value",
      )
    })
    const component = getComponent(name)
    expect(component.ftype).toBe("simple_chip")
    expect(any_source_component.safeParse(component).success).toBe(true)
    expect(
      converter.getWarnings().some((warning) => warning.includes("Value")),
    ).toBe(true)
  })

  test.failing(`keeps an unparseable ${name} Value without inventing a quantity`, () => {
    const { converter, getComponent } = convert((input) => {
      input.symbols
        .find((symbol) => symbol.libraryId === name)!
        .properties.find((property) => property.key === "Value")!.value =
        "not specified"
    })
    const component = getComponent(name)
    expect(component).toMatchObject({
      ftype: "simple_chip",
      display_value: "not specified",
    })
    expect(any_source_component.safeParse(component).success).toBe(true)
    expect(converter.getWarnings().length).toBeGreaterThan(0)
  })
}

test.failing("does not guess NPN for an unidentified transistor", () => {
  const { converter, getComponent } = convert((input) => {
    const instance = input.symbols.find(
      (symbol) => symbol.libraryId === "Device:Q_NPN",
    )!
    instance.libraryId = "Custom:Q_Unknown"
  })
  const component = getComponent("Custom:Q_Unknown")
  expect(component.ftype).toBe("simple_chip")
  expect(
    converter.getWarnings().some((warning) => warning.includes("polarity")),
  ).toBe(true)
})

test.failing("reads BJT polarity from library metadata for a named part", () => {
  const component = convert((input) => {
    const name = "Transistor_BJT:BC557"
    input.symbols.find(
      (symbol) => symbol.libraryId === "Device:Q_PNP",
    )!.libraryId = name
    const library = input.libSymbols!.symbols.find(
      (symbol) => symbol.libraryId === "Device:Q_PNP",
    )!
    library.libraryId = name
    library.properties.find((property) => property.key === "Value")!.value =
      "BC557"
  }).getComponent("Transistor_BJT:BC557")
  expect(component).toMatchObject({
    ftype: "simple_transistor",
    transistor_type: "pnp",
  })
})

test.failing("uses header dimensions when the library definition is unavailable", () => {
  const component = convert((input) => {
    input.libSymbols!.symbols = input.libSymbols!.symbols.filter(
      (symbol) => symbol.libraryId !== "Connector_Generic:Conn_01x04",
    )
  }).getComponent("Connector_Generic:Conn_01x04")
  expect(component).toMatchObject({ ftype: "simple_pin_header", pin_count: 4 })
})

test.failing("does not guess a pin count for an unidentified header", () => {
  const { converter, getComponent } = convert((input) => {
    const instance = input.symbols.find(
      (symbol) => symbol.libraryId === "Connector_Generic:Conn_01x04",
    )!
    instance.libraryId = "Custom:Header"
    instance.properties.find((property) => property.key === "Value")!.value =
      "Pin header"
  })
  expect(getComponent("Custom:Header").ftype).toBe("simple_chip")
  expect(
    converter.getWarnings().some((warning) => warning.includes("pin count")),
  ).toBe(true)
})

for (const [name, reference, ftype] of [
  ["Device:D", "D1", "simple_diode"],
  ["Device:LED", "LED1", "simple_led"],
  ["Custom:IC", "U1", "simple_chip"],
  ["Connector:TestPoint", "TP1", "simple_test_point"],
] as const) {
  test.failing(`preserves common metadata for ${ftype}`, () => {
    const component = convert((input) => {
      const instance = input.symbols.find(
        (symbol) => symbol.libraryId === "Device:C",
      )!
      instance.libraryId = name
      instance.properties.find(
        (property) => property.key === "Reference",
      )!.value = reference
      instance.properties.find((property) => property.key === "Value")!.value =
        "Part Value"
    }).getComponent(name)
    expect(any_source_component.parse(component)).toMatchObject({
      ftype,
      display_value: "Part Value",
      manufacturer_part_number: "GRM188R61C105KA12D",
    })
  })
}
