// Regras centralizadas de distribuição de lucros.
// Termos (isenta/tributada) e limite estão aqui para facilitar alteração posterior.

export const LIMITE_DISTRIBUICAO_ISENTA = 50000

export const STATUS_DISTRIBUICAO = {
  ISENTA:    'Distribuição Isenta',
  TRIBUTADA: 'Distribuição Tributada',
} as const

/**
 * Imposto de renda sobre distribuição tributada.
 * Gross-up: valor líquido retirado → valor bruto equivalente → 10% de IR.
 *
 * Retorna 0 se retirada ≤ LIMITE_DISTRIBUICAO_ISENTA.
 */
export function calcularIrDevido(valorRetirada: number): number {
  if (valorRetirada <= LIMITE_DISTRIBUICAO_ISENTA) return 0
  const bruto = valorRetirada / 0.9
  return bruto * 0.10
}
