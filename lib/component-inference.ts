export type SupportedSourceComponentFtype =
  | "simple_resistor"
  | "simple_capacitor"
  | "simple_inductor"
  | "simple_diode"
  | "simple_led"
  | "simple_transistor"
  | "simple_chip"
  | "simple_pin_header"

export function inferSourceComponentFtype(params: {
  name?: string
  reference?: string
  metadata?: string
}): SupportedSourceComponentFtype {
  const name = params.name || ""
  const reference = params.reference?.trim() || ""
  const metadata = params.metadata || ""
  const lowerName = name.toLowerCase()
  const prefix = reference.match(/^([A-Z]+)/i)?.[1]?.toUpperCase()

  if (isPinHeaderLike({ name, metadata })) {
    return "simple_pin_header"
  }

  if (
    lowerName === "r" ||
    lowerName.startsWith("r_") ||
    lowerName.includes(":r_") ||
    prefix === "R"
  ) {
    return "simple_resistor"
  }
  if (
    lowerName === "c" ||
    lowerName.startsWith("c_") ||
    lowerName.includes(":c_") ||
    prefix === "C"
  ) {
    return "simple_capacitor"
  }
  if (
    lowerName === "l" ||
    lowerName.startsWith("l_") ||
    lowerName.includes(":l_") ||
    prefix === "L"
  ) {
    return "simple_inductor"
  }
  if (lowerName.includes("led") || prefix === "LED") {
    return "simple_led"
  }
  if (
    lowerName.startsWith("d_") ||
    lowerName.includes(":d_") ||
    prefix === "D"
  ) {
    return "simple_diode"
  }
  if (
    lowerName.startsWith("q_") ||
    lowerName.includes(":q_") ||
    prefix === "Q"
  ) {
    return "simple_transistor"
  }

  return "simple_chip"
}

export function inferPinHeaderGender(params: {
  name?: string
  metadata?: string
}): "male" | "female" {
  const combined = `${params.name || ""} ${params.metadata || ""}`.toLowerCase()

  if (
    combined.includes("socket") ||
    combined.includes("female") ||
    combined.includes("pinsocket")
  ) {
    return "female"
  }

  return "male"
}

export function inferPinHeaderPinCountFromName(
  name: string | undefined,
): number | undefined {
  if (!name) return undefined

  const match = name.match(/(?:pin(?:header|socket)|conn)_(\d+)x(\d+)/i)
  if (!match) return undefined

  const rows = Number.parseInt(match[1]!, 10)
  const columns = Number.parseInt(match[2]!, 10)

  if (!Number.isFinite(rows) || !Number.isFinite(columns)) return undefined

  return rows * columns
}

export function countUniquePinIdentifiers(
  identifiers: Array<string | number | undefined | null>,
): number {
  return new Set(
    identifiers
      .map((identifier) => `${identifier ?? ""}`.trim())
      .filter(Boolean),
  ).size
}

function isPinHeaderLike(params: {
  name?: string
  metadata?: string
}): boolean {
  const name = params.name || ""
  const metadata = params.metadata || ""
  const combined = `${name} ${metadata}`.toLowerCase()

  return (
    /(?:^|:)pinheader_\d+x\d+/i.test(name) ||
    /(?:^|:)pinsocket_\d+x\d+/i.test(name) ||
    /^conn_\d+x\d+(?:_|$)/i.test(name) ||
    combined.includes("pin header") ||
    combined.includes("pinsocket") ||
    combined.includes("pin socket")
  )
}
