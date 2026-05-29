export function normalizeRotationDegrees(
  rotationDegrees: number | undefined,
): number {
  if (!rotationDegrees) return 0

  const normalized = rotationDegrees % 360
  return normalized < 0 ? normalized + 360 : normalized
}

export function getPortHints(pad: any): string[] | undefined {
  const padNumber = pad.number?.toString()
  return padNumber ? [padNumber] : undefined
}

export function getPortHintsProps(
  pad: any,
): { port_hints: string[] } | Record<string, never> {
  const portHints = getPortHints(pad)
  return portHints ? { port_hints: portHints } : {}
}

export function getRoundRectCornerRadius(
  pad: any,
  size: { x: number; y: number },
): number | undefined {
  const roundrectRatio = pad._sxRoundrectRatio?.value ?? pad.roundrect_rratio
  if (roundrectRatio === undefined) return undefined

  const minDimension = Math.min(size.x, size.y)
  return (minDimension * roundrectRatio) / 2
}
