// Regras centralizadas de distribuição de lucros.
// Termos e limite espelham server/src/utils/distribuicao.ts — manter em sincronia.

export const LIMITE_DISTRIBUICAO_ISENTA = 50000

export const STATUS_DISTRIBUICAO = {
  ISENTA:    'Distribuição Isenta',
  TRIBUTADA: 'Distribuição Tributada',
} as const

export function calcularIrDevido(valorRetirada: number): number {
  if (valorRetirada <= LIMITE_DISTRIBUICAO_ISENTA) return 0
  const bruto = valorRetirada / 0.9
  return bruto * 0.10
}
