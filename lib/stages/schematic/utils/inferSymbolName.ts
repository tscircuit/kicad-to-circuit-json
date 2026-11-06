import { rotationToDirection } from "./rotationToDirection"

export function inferSymbolName({
  libId,
  reference,
  rotation,
}: {
  libId: string
  reference: string
  rotation: number
}): string | undefined {
  // Map KiCad library IDs to schematic-symbols symbol names
  const lower = libId.toLowerCase()
  const symbolPart = lower.includes(":")
    ? lower.slice(lower.indexOf(":") + 1)
    : lower
  const refUpper = (reference ?? "").trim().toUpperCase()
  const direction = rotationToDirection(rotation)

  // Resistors
  if (
    lower.includes(":r_") ||
    (lower.includes(":r") &&
      refUpper.startsWith("R") &&
      !symbolPart.startsWith("relay") &&
      !symbolPart.startsWith("resonator") &&
      !symbolPart.startsWith("reg"))
  ) {
    return `boxresistor_${direction}`
  }

  // Capacitors
  if (
    lower.includes(":c_") ||
    lower.includes(":cp") ||
    (lower.includes(":c") &&
      refUpper.startsWith("C") &&
      !symbolPart.startsWith("conn") &&
      !symbolPart.startsWith("crystal"))
  ) {
    if (lower.includes("polarized") || lower.includes("_pol")) {
      return `capacitor_${direction}`
    }
    return `capacitor_${direction}`
  }

  // Inductors
  if (
    lower.includes(":l_") ||
    (lower.includes(":l") &&
      refUpper.startsWith("L") &&
      !refUpper.startsWith("LED") &&
      !lower.includes("led"))
  ) {
    return `inductor_${direction}`
  }

  // Diodes
  if (
    lower.includes(":d_") ||
    lower.includes("diode") ||
    lower.includes("led") ||
    refUpper.startsWith("D") ||
    refUpper.startsWith("LED")
  ) {
    if (lower.includes("led") || refUpper.startsWith("LED")) {
      return `led_${direction}`
    }
    if (lower.includes("schottky")) {
      return `schottky_diode_${direction}`
    }
    if (lower.includes("zener")) {
      return `zener_diode_${direction}`
    }
    return `diode_${direction}`
  }

  // Transistors
  if (lower.includes(":q_") || refUpper.startsWith("Q")) {
    if (lower.includes("npn")) {
      return `npn_bipolar_transistor_${direction}`
    }
    if (lower.includes("pnp")) {
      return `pnp_bipolar_transistor_${direction}`
    }
    if (lower.includes("_n_") || lower.includes("nmos")) {
      return `n_channel_mosfet_transistor_${direction}`
    }
    if (lower.includes("_p_") || lower.includes("pmos")) {
      return `p_channel_mosfet_transistor_${direction}`
    }
    return `npn_bipolar_transistor_${direction}`
  }

  // Power symbols - these should NOT have symbol_name
  // as they should be rendered as net_labels instead
  if (lower.includes("gnd") || lower.includes("ground")) {
    return undefined // Will be handled separately as net_label
  }
  if (
    lower.includes("vcc") ||
    lower.includes("vdd") ||
    lower.includes("power")
  ) {
    return undefined // Will be handled separately as net_label
  }
}
