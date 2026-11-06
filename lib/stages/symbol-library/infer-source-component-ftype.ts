export type SupportedSourceComponentFtype =
  | "simple_resistor"
  | "simple_capacitor"
  | "simple_inductor"
  | "simple_diode"
  | "simple_led"
  | "simple_test_point"
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
  if (isTestPointLike({ name, reference, metadata })) {
    return "simple_test_point"
  }

  if (isSwitchLike({ name, reference, metadata })) {
    return "simple_switch"
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

function isSwitchLike(params: {
  name?: string
  reference?: string
  metadata?: string
}): boolean {
  const name = params.name || ""
  const reference = params.reference?.trim() || ""
  const metadata = params.metadata || ""
  const combined = `${name} ${metadata}`.toLowerCase()
  const prefix = reference.match(/^([A-Z]+)/i)?.[1]?.toUpperCase()

  if (prefix === "SW" || prefix === "S") return true

  return [
    /(?:^|[\s:_-])sw(?:$|[\s:_-])/,
    /\b(?:slide|toggle)[-\s]switch(?:es)?\b/,
    /\bpush(?:-| )?button switch\b/,
    /\bswitch,\s*(?:generic|single pole|double pole|dual pole)\b/,
    /\bswitch\s+(?:dpdt|spdt|spst|dpst)\b/,
  ].some((pattern) => pattern.test(combined))
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

function isTestPointLike(params: {
  name?: string
  reference?: string
  metadata?: string
}): boolean {
  const name = params.name || ""
  const reference = params.reference?.trim() || ""
  const metadata = params.metadata || ""
  const combined = `${name} ${metadata}`.toLowerCase()
  const prefix = reference.match(/^([A-Z]+)/i)?.[1]?.toUpperCase()

  return (
    prefix === "TP" ||
    /(?:^|:)testpoint(?:_|$)/i.test(name) ||
    combined.includes("test point") ||
    combined.includes("testpoint")
  )
}
