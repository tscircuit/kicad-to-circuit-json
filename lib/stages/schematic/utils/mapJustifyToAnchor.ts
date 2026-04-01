export function mapJustifyToAnchor(justify: any): string {
  if (!justify) return "center";
  
  let jText = "";
  if (Array.isArray(justify)) {
    jText = justify.map(j => (typeof j === 'string' ? j : (j.value ?? j._value ?? ""))).join(" ");
  }
  else if (justify.value) jText = justify.value;
  else if (typeof justify === "string") jText = justify;
  else if (justify._value) jText = justify._value;

  jText = jText.toLowerCase();

  const isLeft = jText.includes("left");
  const isRight = jText.includes("right");
  const isTop = jText.includes("top");
  const isBottom = jText.includes("bottom");

  if (isTop && isLeft) return "top_left";
  if (isTop && isRight) return "top_right";
  if (isBottom && isLeft) return "bottom_left";
  if (isBottom && isRight) return "bottom_right";

  if (isTop) return "center"; // center_top is sometimes not supported, fallback appropriately or use top_center if supported
  if (isLeft) return "center_left";
  if (isRight) return "center_right";
  if (isBottom) return "center";

  return "center";
}
