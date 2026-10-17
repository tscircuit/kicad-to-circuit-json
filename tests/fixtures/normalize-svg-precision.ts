// Sub-micro-pixel trig differences vary between platforms. Trimming display
// precision also keeps large embedded SVGs below the XML parser's lookup limit.
export function normalizeSvgPrecision(svg: string): string {
  return svg.replace(/-?\d+\.\d{7,}/gu, (number) => Number(number).toFixed(6))
}
