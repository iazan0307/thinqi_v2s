/**
 * Motor multi-sinal de identificação de retiradas de sócios.
 *
 * Ordem de prioridade dos sinais (maior confiança primeiro):
 *
 *   Sinal 1 — CPF completo + bcrypt hash  (confiança: 100)
 *     → CPF de 11 dígitos encontrado no texto E bate com o hash armazenado
 *
 *   Sinal 2 — CPF completo + prefixo/sufixo  (confiança: 92)
 *     → CPF de 11 dígitos encontrado, 3 primeiros + 2 últimos dígitos conferem
 *       (usado quando bcrypt.compare é lento demais; resultado conservador)
 *
 *   Sinal 3 — Prefixo + sufixo na descrição  (confiança: 85)
 *     → Padrão regex legacy: 3 primeiros e 2 últimos dígitos na descrição
 *       (ex: Itaú SGML onde o CPF aparece parcialmente)
 *
 *   Sinal 4 — Somente prefixo na descrição  (confiança: 60)
 *     → Fallback; ambíguo, marca como "suspeito" mas não vincula com certeza
 *
 *   Sinal 5 — Nome do sócio no NAME/MEMO  (confiança: scoreNome)
 *     → Algoritmo de similaridade de nomes (banco Inter, outros sem CPF)
 *     → Mínimo 55 pts para ser considerado
 *
 * Threshold de vínculo: confiança >= 70  → vincula ao sócio
 * Threshold de suspeita: confiança >= 50 → salva cpf_detectado mas não vincula
 */

import bcrypt from 'bcryptjs'
import { prisma } from '../../utils/prisma'
import { detectCpfInText } from '../../utils/cpf'
import { LIMITE_DISTRIBUICAO_ISENTA } from '../../utils/distribuicao'
import { scoreNome } from '../../utils/nome'
import { isInvestimentoAutomatico } from '../../utils/investimento'
import { TransacaoParseada } from '../parser/ofx'

export interface MatchResult {
  transacao: TransacaoParseada
  socio_id: string | null
  cpf_detectado: string | null  // sempre mascarado (LGPD)
  confianca: number
  sinal: 'cpf_hash' | 'cpf_parcial' | 'prefixo_sufixo' | 'prefixo' | 'nome' | 'none'
}

interface SocioMatchData {
  id: string
  nome: string
  cpf_hash: string
  cpf_prefixo: string
  cpf_sufixo: string
  cpf_mascara: string
}

// ─── Sinais individuais ────────────────────────────────────────────────────────

/** Sinal 1: CPF completo via bcrypt.compare (mais seguro, LGPD) */
async function sinalCpfHash(
  cpf_raw: string,
  socios: SocioMatchData[],
): Promise<{ socio: SocioMatchData; confianca: number } | null> {
  for (const socio of socios) {
    const match = await bcrypt.compare(cpf_raw, socio.cpf_hash)
    if (match) return { socio, confianca: 100 }
  }
  return null
}

/** Sinal 2: CPF completo via prefixo+sufixo (rápido, sem I/O) */
function sinalCpfParcial(
  cpf_raw: string,
  socios: SocioMatchData[],
): { socio: SocioMatchData; confianca: number } | null {
  for (const socio of socios) {
    if (cpf_raw.startsWith(socio.cpf_prefixo) && cpf_raw.endsWith(socio.cpf_sufixo)) {
      return { socio, confianca: 92 }
    }
  }
  return null
}

/** Sinais 3+4: regex legacy de prefixo/sufixo no texto da transação */
function sinalPrefixoSufixo(
  descricao: string,
  socios: SocioMatchData[],
): { socio: SocioMatchData; confianca: number; sinal: 'prefixo_sufixo' | 'prefixo' } | null {
  let melhor: { socio: SocioMatchData; confianca: number; sinal: 'prefixo_sufixo' | 'prefixo' } | null = null

  for (const socio of socios) {
    const { encontrado, confianca } = detectCpfInText(descricao, socio.cpf_prefixo, socio.cpf_sufixo)
    if (!encontrado) continue

    const sinal = confianca >= 85 ? 'prefixo_sufixo' : 'prefixo'
    if (!melhor || confianca > melhor.confianca) {
      melhor = { socio, confianca, sinal }
    }
  }

  return melhor
}

/** Sinal 5: matching por nome */
function sinalNome(
  textos: string[],
  socios: SocioMatchData[],
): { socio: SocioMatchData; confianca: number } | null {
  const textoCompleto = textos.filter(Boolean).join(' ')
  let melhor: { socio: SocioMatchData; confianca: number } | null = null

  for (const socio of socios) {
    const score = scoreNome(socio.nome, textoCompleto)
    if (score >= 55 && (!melhor || score > melhor.confianca)) {
      melhor = { socio, confianca: score }
    }
  }

  return melhor
}

// ─── Motor principal ──────────────────────────────────────────────────────────

export async function matchTransacoes(
  transacoes: TransacaoParseada[],
  empresaId: string,
): Promise<MatchResult[]> {
  const socios = await prisma.socio.findMany({
    where: { empresa_id: empresaId, ativo: true },
    select: {
      id:           true,
      nome:         true,
      cpf_hash:     true,
      cpf_prefixo:  true,
      cpf_sufixo:   true,
      cpf_mascara:  true,
    },
  }) as SocioMatchData[]

  const resultados: MatchResult[] = []

  for (const t of transacoes) {
    // Apenas saídas podem ser retiradas de sócios
    if (t.tipo !== 'SAIDA') {
      resultados.push({ transacao: t, socio_id: null, cpf_detectado: null, confianca: 0, sinal: 'none' })
      continue
    }

    // Aplicações automáticas e resgates de investimento nunca são retiradas de sócios —
    // são movimentações internas banco↔aplicação que não tocam distribuição/pró-labore.
    // (Requisito da reunião abril/2026: "resgate de aplicação" ≠ distribuição)
    if (isInvestimentoAutomatico(t.descricao)) {
      resultados.push({ transacao: t, socio_id: null, cpf_detectado: null, confianca: 0, sinal: 'none' })
      continue
    }

    let match: { socio: SocioMatchData; confianca: number } | null = null
    let sinal: MatchResult['sinal'] = 'none'

    // ── Sinal 1: CPF completo via bcrypt (mais lento, usado primeiro pois é definitivo)
    if (t.cpf_raw) {
      const r = await sinalCpfHash(t.cpf_raw, socios)
      if (r) { match = r; sinal = 'cpf_hash' }
    }

    // ── Sinal 2: CPF completo via prefixo/sufixo (rápido)
    if (!match && t.cpf_raw) {
      const r = sinalCpfParcial(t.cpf_raw, socios)
      if (r) { match = r; sinal = 'cpf_parcial' }
    }

    // ── Sinais 3+4: regex de prefixo/sufixo na descrição
    if (!match) {
      const r = sinalPrefixoSufixo(t.descricao, socios)
      if (r) { match = r; sinal = r.sinal }
    }

    // ── Sinal 5: nome (somente se não achou por CPF)
    if (!match) {
      const textos = [t.nome_contraparte, t.descricao].filter((x): x is string => !!x)
      const r = sinalNome(textos, socios)
      if (r) { match = r; sinal = 'nome' }
    }

    if (!match) {
      resultados.push({ transacao: t, socio_id: null, cpf_detectado: null, confianca: 0, sinal: 'none' })
      continue
    }

    const { socio, confianca } = match

    resultados.push({
      transacao:     t,
      socio_id:      confianca >= 70 ? socio.id : null,   // vincula se confiança suficiente
      cpf_detectado: socio.cpf_mascara,                    // sempre mascarado (LGPD)
      confianca,
      sinal,
    })
  }

  return resultados
}

// ─── Consolidação mensal ──────────────────────────────────────────────────────

export async function consolidarRetiradas(empresaId: string): Promise<void> {
  const transacoes = await prisma.transacaoBancaria.findMany({
    where: {
      empresa_id: empresaId,
      tipo:       'SAIDA',
      socio_id:   { not: null },
      confianca:  { gte: 70 },
    },
  })

  const grupos = new Map<
    string,
    { socio_id: string; mes_ref: Date; total: number; qtd: number }
  >()

  for (const t of transacoes) {
    if (!t.socio_id) continue

    const d      = t.data
    const mesRef = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
    const key    = `${t.socio_id}::${mesRef.toISOString()}`

    const g = grupos.get(key) ?? {
      socio_id: t.socio_id,
      mes_ref:  mesRef,
      total:    0,
      qtd:      0,
    }
    g.total += Number(t.valor)
    g.qtd   += 1
    grupos.set(key, g)
  }

  for (const g of grupos.values()) {
    const tributada = g.total > LIMITE_DISTRIBUICAO_ISENTA
    await prisma.retiradaSocio.upsert({
      where: {
        empresa_id_socio_id_mes_ref: {
          empresa_id: empresaId,
          socio_id:   g.socio_id,
          mes_ref:    g.mes_ref,
        },
      },
      update: {
        valor_total:        g.total,
        qtd_transferencias: g.qtd,
        alerta_limite:      tributada,
      },
      create: {
        empresa_id:         empresaId,
        socio_id:           g.socio_id,
        mes_ref:            g.mes_ref,
        valor_total:        g.total,
        qtd_transferencias: g.qtd,
        alerta_limite:      tributada,
      },
    })
  }
}
