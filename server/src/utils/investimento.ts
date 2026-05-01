/**
 * Detecção de movimentações de investimento automático bancário.
 *
 * Aplicações e resgates automáticos são movimentações internas da conta corrente
 * (banco <-> aplicação) e NÃO constituem:
 *   - Receita operacional (quando entram via resgate)
 *   - Despesa operacional (quando saem via aplicação)
 *   - Distribuição de lucros/pró-labore (quando saem via aplicação)
 *
 * Esses padrões cobrem os principais bancos (Itaú, Bradesco, Santander, BB,
 * Caixa, Inter) — mantenha sincronizado com o portalController.
 */

const RENDIMENTO_PATTERNS: RegExp[] = [
  /rendimentos?\s*rend\s*pago/i,
  /rendimento.*aplic/i,
  /\brend\s*pago/i,
  /\brendimento\b/i,
]

const RESGATE_PATTERNS: RegExp[] = [
  /res\s*aplic\s*aut/i,
  /resg\s*aplic\s*aut/i,
  /resgate\s*de?\s*aplic/i,
]

const APLICACAO_PATTERNS: RegExp[] = [
  /aplic\s*aut/i,
  /apl\s*aplic/i,
  /aplicacao\s*autom/i,
  /invest\s*autom/i,
  /cdb\s*autom/i,
  /rdb\s*autom/i,
]

export function isRendimentoAplicacao(descricao: string | null | undefined): boolean {
  if (!descricao) return false
  return RENDIMENTO_PATTERNS.some(p => p.test(descricao))
}

export function isResgateAplicacao(descricao: string | null | undefined): boolean {
  if (!descricao) return false
  return RESGATE_PATTERNS.some(p => p.test(descricao))
}

export function isAplicacaoSaida(descricao: string | null | undefined): boolean {
  if (!descricao) return false
  return APLICACAO_PATTERNS.some(p => p.test(descricao))
}

export function isInvestimentoAutomatico(descricao: string | null | undefined): boolean {
  if (!descricao) return false
  return (
    isRendimentoAplicacao(descricao) ||
    isResgateAplicacao(descricao) ||
    isAplicacaoSaida(descricao)
  )
}

/**
 * Detecta entradas no banco que são repasses de adquirentes de cartão
 * (Cielo, Stone, Rede, PagSeguro, etc.). Essas entradas devem sair do
 * cálculo de receita real porque já estão contabilizadas em
 * TransacaoCartao.valor_bruto (vendas brutas no maquininha).
 */
const RECEBIMENTO_CARTAO_PATTERNS: RegExp[] = [
  /\bcielo\b/i,
  /\bstone\b/i,
  /\brede(?:card)?\b/i,
  /\bpagseguro\b/i,
  /\bgetnet\b/i,
  /\bsafrapay\b/i,
  /\bbin\b/i,
  /\badyen\b/i,
  /\bvero\b/i,
  /\bsicredi\s*pay\b/i,
  /\bmaquininha\b/i,
  /repasse.*cart/i,
  /liquid.*cart/i,
  /credenciador/i,
  /adquirente/i,
]

export function isRecebimentoCartao(descricao: string | null | undefined): boolean {
  if (!descricao) return false
  return RECEBIMENTO_CARTAO_PATTERNS.some(p => p.test(descricao))
}
