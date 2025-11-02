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
  const direction = rotationToDirection(rotation)

  // Resistors
  if (
    lower.includes(":r_") ||
    (lower.includes(":r") && reference.startsWith("R"))
  ) {
    return `boxresistor_${direction}`
  }

  // Capacitors
  if (
    lower.includes(":c_") ||
    (lower.includes(":c") && reference.startsWith("C"))
  ) {
    if (lower.includes("polarized") || lower.includes("_pol")) {
      return `capacitor_${direction}`
    }
    return `capacitor_${direction}`
  }

  // Inductors
  if (
    lower.includes(":l_") ||
    (lower.includes(":l") && reference.startsWith("L"))
  ) {
    return `inductor_${direction}`
  }

  // Diodes
  if (
    lower.includes(":d_") ||
    lower.includes("diode") ||
    reference.startsWith("D")
  ) {
    if (lower.includes("led")) {
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
  if (lower.includes(":q_") || reference.startsWith("Q")) {
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
