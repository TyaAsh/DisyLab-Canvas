/** Merge application defaults and model choices without duplicating Auto. */
export function uniqueImageRatios(ratios: readonly string[] | undefined, defaults: readonly string[], includeAuto = false) {
  return [...new Set([...(includeAuto ? ['auto'] : []), ...(ratios ?? defaults)])]
}
