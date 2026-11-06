export function normalizeRotationDegrees(
  rotationDegrees: number | undefined,
): number {
  if (!rotationDegrees || !Number.isFinite(rotationDegrees)) return 0

  const normalizedRotation = rotationDegrees % 360
  const result =
    normalizedRotation < 0 ? normalizedRotation + 360 : normalizedRotation
  return result === 0 ? 0 : result
}

export function getRightAngleTurns(rotationDegrees: number): number | null {
  if (!Number.isFinite(rotationDegrees)) return null
  const quarterTurns = rotationDegrees / 90

  if (Math.abs(quarterTurns - Math.round(quarterTurns)) > 1e-9) {
    return null
  }

  const rounded = Math.round(quarterTurns)
  return rounded === 0 ? 0 : rounded
}
