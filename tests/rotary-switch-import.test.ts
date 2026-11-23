import { expect, test } from "bun:test"
import { KicadToCircuitJsonConverter } from "../lib"

function buildRotaryLibrarySymbolSexpr({
  libraryId,
  poles,
  positions,
  includeMountPin = false,
}: {
  libraryId: string
  poles: number
  positions: number
  includeMountPin?: boolean
}): string {
  const symbolName = libraryId.split(":").pop()!
  const pins: string[] = []

  for (let pole = 1; pole <= poles; pole++) {
    for (let pos = 1; pos <= positions; pos++) {
      const pinNum = (pole - 1) * positions + pos
      const y = (positions - pos) * 2.54 - (pole - 1) * 12.7
      pins.push(
        `        (pin passive line (at 7.62 ${y.toFixed(2)} 180) (length 2.54) (name "${pos}" (effects (font (size 1.27 1.27)))) (number "${pinNum}" (effects (font (size 1.27 1.27)))))`,
      )
    }
    const commonPin = poles * positions + pole
    const commonY = -((pole - 1) * 12.7)
    pins.push(
      `        (pin passive line (at -7.62 ${commonY.toFixed(2)} 0) (length 2.54) (name "C${pole}" (effects (font (size 1.27 1.27)))) (number "${commonPin}" (effects (font (size 1.27 1.27)))))`,
    )
  }

  if (includeMountPin) {
    pins.push(
      `        (pin passive line (at 0 -10.16 90) (length 2.54) (name "MP" (effects (font (size 1.27 1.27)))) (number "MP" (effects (font (size 1.27 1.27)))))`,
    )
  }

  return `    (symbol "${libraryId}"
      (pin_names (offset 1.016) (hide yes))
      (exclude_from_sim no)
      (in_bom yes)
      (on_board yes)
      (property "Reference" "SW" (at 0 5.08 0) (effects (font (size 1.27 1.27))))
      (property "Value" "${symbolName}" (at 0 -5.08 0) (effects (font (size 1.27 1.27))))
      (property "Footprint" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
      (property "Description" "Rotary switch ${poles}x${positions}" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
      (symbol "${symbolName}_1_1"
${pins.join("\n")}
      )
    )`
}

test("kicad-to-circuit-json: imports Switch:SW_Rotary_NxM schematic symbols as simple_rotary_switch with poles, positions, and MP pin", () => {
  const kicadSch = `(kicad_sch
  (version 20231120)
  (generator "eeschema")
  (uuid "11111111-1111-1111-1111-111111111111")
  (paper "A4")
  (lib_symbols
${buildRotaryLibrarySymbolSexpr({
  libraryId: "Switch:SW_Rotary_4x3",
  poles: 4,
  positions: 3,
})}
${buildRotaryLibrarySymbolSexpr({
  libraryId: "Switch:SW_Rotary_1x4_MP",
  poles: 1,
  positions: 4,
  includeMountPin: true,
})}
  )
  (symbol
    (lib_id "Switch:SW_Rotary_4x3")
    (at 60 60 0)
    (unit 1)
    (exclude_from_sim no)
    (in_bom yes)
    (on_board yes)
    (uuid "22222222-2222-2222-2222-222222222222")
    (property "Reference" "SW1" (at 60 52 0) (effects (font (size 1.27 1.27))))
    (property "Value" "Alpha_SR2611_4x3" (at 60 68 0) (effects (font (size 1.27 1.27))))
  )
  (symbol
    (lib_id "Switch:SW_Rotary_1x4_MP")
    (at 120 60 0)
    (unit 1)
    (exclude_from_sim no)
    (in_bom yes)
    (on_board yes)
    (uuid "33333333-3333-3333-3333-333333333333")
    (property "Reference" "SW2" (at 120 52 0) (effects (font (size 1.27 1.27))))
    (property "Value" "SW_Rotary_1x4_MP" (at 120 68 0) (effects (font (size 1.27 1.27))))
  )
)`

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("rotary.kicad_sch", kicadSch)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  const sourceComponents = circuitJson.filter(
    (el): el is Extract<typeof el, { type: "source_component" }> =>
      el.type === "source_component",
  )
  const sourcePorts = circuitJson.filter(
    (el): el is Extract<typeof el, { type: "source_port" }> =>
      el.type === "source_port",
  )

  const sw4x3 = sourceComponents.find(
    (c) => c.name === "Switch:SW_Rotary_4x3",
  ) as Record<string, unknown> | undefined
  expect(sw4x3).toBeDefined()
  expect(sw4x3).toMatchObject({
    ftype: "simple_rotary_switch",
    poles: 4,
    positions: 3,
    manufacturer_part_number: "Alpha_SR2611_4x3",
  })

  const sw4x3Ports = sourcePorts.filter(
    (p) => p.source_component_id === sw4x3!.source_component_id,
  )
  expect(
    sw4x3Ports.map((p) => p.pin_number).sort((a, b) => (a ?? 0) - (b ?? 0)),
  ).toEqual(Array.from({ length: 16 }, (_, idx) => idx + 1))

  const sw1x4Mp = sourceComponents.find(
    (c) => c.name === "Switch:SW_Rotary_1x4_MP",
  ) as Record<string, unknown> | undefined
  expect(sw1x4Mp).toBeDefined()
  expect(sw1x4Mp).toMatchObject({
    ftype: "simple_rotary_switch",
    poles: 1,
    positions: 4,
  })

  const sw1x4Ports = sourcePorts.filter(
    (p) => p.source_component_id === sw1x4Mp!.source_component_id,
  )
  expect(sw1x4Ports).toHaveLength(6)
  expect(sw1x4Ports.find((p) => p.port_hints?.includes("MP"))).toBeDefined()
})

test("kicad-to-circuit-json: infers rotary_switch_NxM symbol_name across all orientations when lib_symbols omits embedded definition", () => {
  const expectedByAngle = [
    [0, "rotary_switch_2x6_right"],
    [90, "rotary_switch_2x6_up"],
    [180, "rotary_switch_2x6_left"],
    [270, "rotary_switch_2x6_down"],
  ] as const

  for (const [angle, expectedSymbol] of expectedByAngle) {
    const kicadSch = `(kicad_sch
  (version 20231120)
  (generator "eeschema")
  (uuid "44444444-4444-4444-4444-444444444444")
  (paper "A4")
  (lib_symbols)
  (symbol
    (lib_id "Switch:SW_Rotary_2x6")
    (at 80 80 ${angle})
    (unit 1)
    (uuid "55555555-5555-5555-5555-555555555555")
    (property "Reference" "SW1" (at 80 72 0) (effects (font (size 1.27 1.27))))
    (property "Value" "SW_Rotary_2x6" (at 80 88 0) (effects (font (size 1.27 1.27))))
  )
)`

    const converter = new KicadToCircuitJsonConverter()
    converter.addFile("rotary-unembedded.kicad_sch", kicadSch)
    converter.runUntilFinished()

    const circuitJson = converter.getOutput()
    const sourceComp = circuitJson.find(
      (el) => el.type === "source_component",
    ) as Record<string, unknown> | undefined
    const schComp = circuitJson.find((el) => el.type === "schematic_component")

    expect(sourceComp).toMatchObject({
      ftype: "simple_rotary_switch",
      poles: 2,
      positions: 6,
    })
    expect(schComp?.symbol_name).toBe(expectedSymbol)
  }
})

test("kicad-to-circuit-json: imports rotary switches in .kicad_sym symbol libraries and .kicad_pcb footprints without misclassifying rotary encoders", () => {
  const kicadSym = `(kicad_symbol_lib
  (version 20231120)
  (generator "kicad_symbol_editor")
${buildRotaryLibrarySymbolSexpr({
  libraryId: "SW_Rotary_3x4",
  poles: 3,
  positions: 4,
}).replace(/^ {4}/gm, "  ")}
  (symbol "Rotary_Encoder_Switch"
    (property "Reference" "SW" (at 0 5.08 0) (effects (font (size 1.27 1.27))))
    (property "Value" "Rotary_Encoder_Switch" (at 0 -5.08 0) (effects (font (size 1.27 1.27))))
    (property "Description" "Rotary encoder, dual channel, with push button switch" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
    (symbol "Rotary_Encoder_Switch_1_1"
      (pin passive line (at -5.08 2.54 0) (length 2.54) (name "A" (effects (font (size 1.27 1.27)))) (number "A" (effects (font (size 1.27 1.27)))))
      (pin passive line (at -5.08 0 0) (length 2.54) (name "C" (effects (font (size 1.27 1.27)))) (number "C" (effects (font (size 1.27 1.27)))))
      (pin passive line (at -5.08 -2.54 0) (length 2.54) (name "B" (effects (font (size 1.27 1.27)))) (number "B" (effects (font (size 1.27 1.27)))))
    )
  )
)`

  const symConverter = new KicadToCircuitJsonConverter()
  symConverter.addFile("switches.kicad_sym", kicadSym)
  symConverter.runUntilFinished()
  const symJson = symConverter.getOutput()
  const symComponents = symJson.filter(
    (el): el is Extract<typeof el, { type: "source_component" }> =>
      el.type === "source_component",
  )

  const symRotary = symComponents.find((c) => c.name === "SW_Rotary_3x4") as
    | Record<string, unknown>
    | undefined
  expect(symRotary).toMatchObject({
    ftype: "simple_rotary_switch",
    poles: 3,
    positions: 4,
  })

  const symEncoder = symComponents.find(
    (c) => c.name === "Rotary_Encoder_Switch",
  )
  expect(symEncoder?.ftype).not.toBe("simple_rotary_switch")

  const padsSexpr = Array.from({ length: 16 }, (_, idx) => {
    const padNum = idx + 1
    return `    (pad "${padNum}" thru_hole circle (at ${(idx * 2.54).toFixed(2)} 0) (size 1.8 1.8) (drill 1.0) (layers "*.Cu" "*.Mask"))`
  }).join("\n")

  const kicadPcb = `(kicad_pcb
  (version 20240108)
  (generator "pcbnew")
  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal)
    (44 "Edge.Cuts" user)
  )
  (footprint "Button_Switch_THT:SW_ROTARY_Alpha_SR2611F"
    (layer "F.Cu")
    (uuid "66666666-6666-6666-6666-666666666666")
    (at 50 50)
    (descr "Rotary switch, 4 poles, 3 positions")
    (property "Reference" "SW1" (at 0 -5 0) (layer "F.SilkS") (uuid "66666666-6666-6666-6666-666666666667"))
    (property "Value" "SW_Rotary_4x3" (at 0 5 0) (layer "F.Fab") (uuid "66666666-6666-6666-6666-666666666668"))
${padsSexpr}
  )
  (footprint "kbd_local:keyswitch_choc12_hotswap_1u_rotary_encoder_ec12"
    (layer "B.Cu")
    (uuid "77777777-7777-7777-7777-777777777777")
    (at 100 50)
    (property "Reference" "SW2" (at 0 -5 0) (layer "B.SilkS") (uuid "77777777-7777-7777-7777-777777777778"))
    (property "Value" "RotaryEncoder_Switch" (at 0 5 0) (layer "B.Fab") (uuid "77777777-7777-7777-7777-777777777779"))
    (property "ki_description" "Rotary encoder, dual channel, incremental quadrate outputs, with switch")
    (property "ki_keywords" "rotary switch encoder switch push button")
    (pad "A" thru_hole circle (at -2.5 0) (size 1.5 1.5) (drill 0.9) (layers "*.Cu" "*.Mask"))
    (pad "C" thru_hole circle (at 0 0) (size 1.5 1.5) (drill 0.9) (layers "*.Cu" "*.Mask"))
    (pad "B" thru_hole circle (at 2.5 0) (size 1.5 1.5) (drill 0.9) (layers "*.Cu" "*.Mask"))
  )
  (footprint "Button_Switch_SMD:SW_DIP_SPSTx04_Slide_6.7x11.72mm_W8.61mm_P2.54mm_LowProfile"
    (layer "F.Cu")
    (uuid "88888888-8888-8888-8888-888888888888")
    (at 140 50)
    (descr "4x DIP switch, Single Pole Single Throw (SPST) switch, 2.54mm pitch")
    (property "Reference" "SW3" (at 0 -5 0) (layer "F.SilkS") (uuid "88888888-8888-8888-8888-888888888889"))
    (property "Value" "SW_DIP_x04" (at 0 5 0) (layer "F.Fab") (uuid "88888888-8888-8888-8888-888888888890"))
    (pad "1" smd rect (at -3.81 -4.3) (size 1.12 2.44) (layers "F.Cu" "F.Paste" "F.Mask"))
    (pad "8" smd rect (at -3.81 4.3) (size 1.12 2.44) (layers "F.Cu" "F.Paste" "F.Mask"))
  )
)`

  const pcbConverter = new KicadToCircuitJsonConverter()
  pcbConverter.addFile("rotary.kicad_pcb", kicadPcb)
  pcbConverter.runUntilFinished()
  const pcbJson = pcbConverter.getOutput()
  const pcbComponents = pcbJson.filter(
    (el): el is Extract<typeof el, { type: "source_component" }> =>
      el.type === "source_component",
  )

  const pcbRotary = pcbComponents.find((c) => c.name === "SW1") as
    | Record<string, unknown>
    | undefined
  expect(pcbRotary).toMatchObject({
    ftype: "simple_rotary_switch",
    poles: 4,
    positions: 3,
  })

  const pcbEncoder = pcbComponents.find((c) => c.name === "SW2")
  expect(pcbEncoder?.ftype).toBe("simple_switch")

  const pcbDip = pcbComponents.find((c) => c.name === "SW3")
  expect(pcbDip?.ftype).toBe("simple_switch")
})
