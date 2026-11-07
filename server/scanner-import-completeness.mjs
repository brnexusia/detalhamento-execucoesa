/**
 * Enforce completion only for adapters that report verified pagination state.
 * Legacy generic and non-site collectors remain compatible.
 */
export function requireCompleteCatalog(result) {
  if (result?.complete !== false) return
  const explanation = Array.isArray(result.warnings)
    ? result.warnings.map(x => String(x).slice(0, 180)).join('; ') : ''
  throw new Error('A captura do catálogo foi parcial e não foi enviada à revisão.' +
    (explanation ? ' ' + explanation : ' Verifique a paginação e tente novamente.'))
}
