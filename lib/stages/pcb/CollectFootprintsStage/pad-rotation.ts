export function normalizeRotationDegrees(
  rotationDegrees: number | undefined,
): number {
  if (!rotationDegrees) return 0

  const normalizedRotation = rotationDegrees % 360
  return normalizedRotation < 0 ? normalizedRotation + 360 : normalizedRotation
}

export function getRightAngleTurns(rotationDegrees: number): number | null {
  const quarterTurns = rotationDegrees / 90

  if (Math.abs(quarterTurns - Math.round(quarterTurns)) > 1e-9) {
    return null
  }

  return Math.round(quarterTurns)
}
