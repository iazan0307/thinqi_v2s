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

const INVESTIMENTO_PATTERNS: RegExp[] = [
  /aplic\s*aut/i,           // Itaú: "APLIC AUT MAIS"
  /res\s*aplic\s*aut/i,     // Itaú: "RES APLIC AUT MAIS"
  /resg\s*aplic\s*aut/i,    // Variante: "RESG APLIC AUT"
  /rendimentos\s*rend\s*pago/i, // Itaú: "RENDIMENTOS REND PAGO"
  /apl\s*aplic/i,           // Bradesco: "APL APLICACAO"
  /resgate\s*de?\s*aplic/i, // Genérico: "RESGATE DE APLICACAO", "RESGATE APLICACAO"
  /aplicacao\s*autom/i,     // Genérico: "APLICACAO AUTOMATICA"
  /invest\s*autom/i,        // Variante: "INVEST AUTOMATICO"
  /cdb\s*autom/i,           // Inter/Santander: "CDB AUTOMATICO"
  /rdb\s*autom/i,           // Variante: "RDB AUTOMATICO"
]

export function isInvestimentoAutomatico(descricao: string | null | undefined): boolean {
  if (!descricao) return false
  return INVESTIMENTO_PATTERNS.some(p => p.test(descricao))
}
