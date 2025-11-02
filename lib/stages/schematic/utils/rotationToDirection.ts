export function rotationToDirection(
  rotation: number,
): "left" | "right" | "up" | "down" {
  // Normalize rotation to 0-360 range
  const normalized = ((rotation % 360) + 360) % 360

  // Map rotation to direction suffix
  if (normalized >= 315 || normalized < 45) return "up"
  if (normalized >= 45 && normalized < 135) return "right"
  if (normalized >= 135 && normalized < 225) return "down"
  return "left"
}
