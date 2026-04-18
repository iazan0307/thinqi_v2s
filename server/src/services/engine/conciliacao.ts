/**
 * Motor de Conciliação Fiscal (Sprint 2).
 *
 * Algoritmo:
 * 1. Entradas bancárias reais = total entradas MENOS aportes de sócios identificados
 * 2. Liquidações de cartão = soma do valor_liquido do mês
 * 3. Total Entradas = banco_real + cartao
 * 4. Inconsistência = total_entradas - faturamento
 * 5. Percentual = (inconsistência / total_entradas) × 100
 * 6. Status: < 2% → OK, 2-5% → AVISO, > 5% → ALERTA
 */

import { prisma } from '../../utils/prisma'
import { StatusRelatorio } from '@prisma/client'
import { isInvestimentoAutomatico } from '../../utils/investimento'

export interface ResultadoConciliacao {
  empresa_id: string
  mes_ref: Date
  total_banco: number          // Entradas bancárias brutas no período
  total_socios_banco: number   // Quanto foi excluído por ser de sócio
  total_entradas_banco: number // total_banco - total_socios_banco
  total_cartao: number         // Liquidações de cartão (valor_liquido)
  total_entradas: number       // total_entradas_banco + total_cartao
  total_faturado: number       // Faturamento declarado (NFs)
  diferenca: number            // total_entradas - total_faturado
  percentual_inconsistencia: number
  status: StatusRelatorio
}

function calcStatus(pct: number): StatusRelatorio {
  if (pct < 2) return StatusRelatorio.OK
  if (pct <= 5) return StatusRelatorio.AVISO
  return StatusRelatorio.ALERTA
}

/** Retorna a data de início e fim do mês a partir de um Date */
function mesBounds(mes: Date): { inicio: Date; fim: Date } {
  const y = mes.getUTCFullYear()
  const m = mes.getUTCMonth()
  return {
    inicio: new Date(Date.UTC(y, m, 1)),
    fim: new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999)),
  }
}

export async function calcularConciliacao(
  empresaId: string,
  mesRef: Date,
): Promise<ResultadoConciliacao> {
  const { inicio, fim } = mesBounds(mesRef)

  // 1. Entradas bancárias do período
  const entradas = await prisma.transacaoBancaria.findMany({
    where: {
      empresa_id: empresaId,
      tipo: 'ENTRADA',
      data: { gte: inicio, lte: fim },
    },
    select: { valor: true, socio_id: true, descricao: true },
  })

  // Resgate de aplicação automática não é receita operacional — exclui do cálculo
  // para não inflar o total de entradas e gerar alerta de inconsistência falso.
  const entradasOperacionais = entradas.filter(
    t => !isInvestimentoAutomatico(t.descricao),
  )

  const totalBanco = entradasOperacionais.reduce((sum, t) => sum + Number(t.valor), 0)
  const totalSociosBanco = entradasOperacionais
    .filter(t => t.socio_id !== null)
    .reduce((sum, t) => sum + Number(t.valor), 0)
  const totalEntradasBanco = totalBanco - totalSociosBanco

  // 2. Liquidações de cartão do período
  const cartoes = await prisma.transacaoCartao.findMany({
    where: {
      empresa_id: empresaId,
      data: { gte: inicio, lte: fim },
    },
    select: { valor_liquido: true },
  })
  const totalCartao = cartoes.reduce((sum, t) => sum + Number(t.valor_liquido), 0)

  // 3. Faturamento declarado do mês
  const faturamento = await prisma.faturamento.findFirst({
    where: {
      empresa_id: empresaId,
      mes_ref: { gte: inicio, lte: fim },
    },
    select: { valor_total_nf: true },
  })
  const totalFaturado = Number(faturamento?.valor_total_nf ?? 0)

  // 4. Cálculo
  const totalEntradas = totalEntradasBanco + totalCartao
  const diferenca = totalEntradas - totalFaturado
  const percentual = totalEntradas > 0 ? (diferenca / totalEntradas) * 100 : 0
  const status = calcStatus(Math.abs(percentual))

  return {
    empresa_id: empresaId,
    mes_ref: inicio,
    total_banco: totalBanco,
    total_socios_banco: totalSociosBanco,
    total_entradas_banco: totalEntradasBanco,
    total_cartao: totalCartao,
    total_entradas: totalEntradas,
    total_faturado: totalFaturado,
    diferenca,
    percentual_inconsistencia: Math.round(percentual * 100) / 100,
    status,
  }
}

/** Salva ou atualiza um RelatorioDesconforto no banco */
export async function salvarRelatorio(
  resultado: ResultadoConciliacao,
  pdfPath?: string,
): Promise<string> {
  const relatorio = await prisma.relatorioDesconforto.upsert({
    where: {
      empresa_id_mes_ref: {
        empresa_id: resultado.empresa_id,
        mes_ref: resultado.mes_ref,
      },
    },
    update: {
      total_entradas: resultado.total_entradas,
      total_faturado: resultado.total_faturado,
      total_cartao: resultado.total_cartao,
      diferenca: resultado.diferenca,
      percentual_inconsistencia: resultado.percentual_inconsistencia,
      status: resultado.status,
      ...(pdfPath ? { pdf_path: pdfPath } : {}),
    },
    create: {
      empresa_id: resultado.empresa_id,
      mes_ref: resultado.mes_ref,
      total_entradas: resultado.total_entradas,
      total_faturado: resultado.total_faturado,
      total_cartao: resultado.total_cartao,
      diferenca: resultado.diferenca,
      percentual_inconsistencia: resultado.percentual_inconsistencia,
      status: resultado.status,
      ...(pdfPath ? { pdf_path: pdfPath } : {}),
    },
  })

  return relatorio.id
}
