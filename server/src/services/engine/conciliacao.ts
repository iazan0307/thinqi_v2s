/**
 * Motor de Conciliação Fiscal (Sprint 2 — atualizado Maio/2026).
 *
 * Algoritmo:
 *   Entradas reais = Entradas Banco
 *                    − Aporte Sócios
 *                    − Recebimentos CC/CD (já vão no valor_bruto do cartão)
 *                    − Rendimento Aplicação
 *                    − Resgate Aplicação
 *                    + Vendas CC/CD (valor_bruto das transações de cartão)
 *
 *   Inconsistência = Entradas reais − Faturamento (só conta quando POSITIVA;
 *                                                  faturamento > entradas é normal)
 *   Percentual     = (inconsistência / Entradas reais) × 100
 *   Status         : < 2% → OK, 2–5% → AVISO, > 5% → ALERTA
 */

import { prisma } from '../../utils/prisma'
import { StatusRelatorio } from '@prisma/client'
import {
  isRendimentoAplicacao,
  isResgateAplicacao,
  isRecebimentoCartao,
} from '../../utils/investimento'

export interface ResultadoConciliacao {
  empresa_id: string
  mes_ref: Date
  // Breakdown na ordem da visualização (faturamento primeiro, depois entradas)
  total_faturado: number       // Faturamento declarado (NFs)
  total_entradas_banco: number // Entradas brutas do banco no período
  total_aporte_socios: number  // Aportes de sócios identificados (subtraídos)
  total_recebimentos_cartao: number // Repasses de adquirentes em conta (subtraídos)
  total_rendimento_aplicacao: number // Rendimento de aplicação (subtraído)
  total_resgate_aplicacao: number    // Resgate de aplicação (subtraído)
  total_vendas_cartao: number  // Vendas brutas de cartão (somadas)
  total_entradas_real: number  // Resultado da fórmula acima
  // Compat com interfaces antigas (frontend ainda lê esses nomes)
  total_banco: number          // = total_entradas_banco
  total_socios_banco: number   // = total_aporte_socios
  total_cartao: number         // = total_vendas_cartao
  total_entradas: number       // = total_entradas_real
  diferenca: number            // = total_entradas_real - total_faturado (só positivo)
  percentual_inconsistencia: number
  status: StatusRelatorio
}

function calcStatus(pct: number): StatusRelatorio {
  if (pct < 2) return StatusRelatorio.OK
  if (pct <= 5) return StatusRelatorio.AVISO
  return StatusRelatorio.ALERTA
}

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

  // 1. Entradas bancárias do período (todas, sem filtrar — somamos pelo bruto e
  // subtraímos cada categoria depois para garantir transparência no demonstrativo)
  const entradas = await prisma.transacaoBancaria.findMany({
    where: {
      empresa_id: empresaId,
      tipo: 'ENTRADA',
      data: { gte: inicio, lte: fim },
    },
    select: { valor: true, socio_id: true, descricao: true },
  })

  let totalBancoBruto = 0
  let totalAporteSocios = 0
  let totalRecebimentosCartao = 0
  let totalRendimentoAplicacao = 0
  let totalResgateAplicacao = 0

  for (const t of entradas) {
    const valor = Number(t.valor)
    totalBancoBruto += valor
    if (t.socio_id !== null) {
      totalAporteSocios += valor
      continue
    }
    if (isRendimentoAplicacao(t.descricao)) {
      totalRendimentoAplicacao += valor
      continue
    }
    if (isResgateAplicacao(t.descricao)) {
      totalResgateAplicacao += valor
      continue
    }
    if (isRecebimentoCartao(t.descricao)) {
      totalRecebimentosCartao += valor
      continue
    }
  }

  // 2. Vendas de cartão (valor_bruto, não líquido) — representa o faturamento
  // real do maquininha antes da taxa do credenciador. Substitui o repasse
  // líquido que cai no banco (já filtrado acima).
  const cartoes = await prisma.transacaoCartao.findMany({
    where: {
      empresa_id: empresaId,
      data: { gte: inicio, lte: fim },
    },
    select: { valor_bruto: true },
  })
  const totalVendasCartao = cartoes.reduce((sum, t) => sum + Number(t.valor_bruto), 0)

  // 3. Faturamento declarado do mês
  const faturamento = await prisma.faturamento.findFirst({
    where: {
      empresa_id: empresaId,
      mes_ref: { gte: inicio, lte: fim },
    },
    select: { valor_total_nf: true },
  })
  const totalFaturado = Number(faturamento?.valor_total_nf ?? 0)

  // 4. Fórmula consolidada
  const totalEntradasReal =
    totalBancoBruto
    - totalAporteSocios
    - totalRecebimentosCartao
    - totalRendimentoAplicacao
    - totalResgateAplicacao
    + totalVendasCartao

  // Faturamento > entradas NÃO é inconsistência — apenas inversão (NFs ainda a
  // receber). Só sinalizamos quando entradas reais excedem o faturamento.
  const diferencaBruta = totalEntradasReal - totalFaturado
  const diferenca = diferencaBruta > 0 ? diferencaBruta : 0
  const percentual = totalEntradasReal > 0 ? (diferenca / totalEntradasReal) * 100 : 0
  const status = calcStatus(percentual)

  return {
    empresa_id: empresaId,
    mes_ref: inicio,
    total_faturado: totalFaturado,
    total_entradas_banco: totalBancoBruto,
    total_aporte_socios: totalAporteSocios,
    total_recebimentos_cartao: totalRecebimentosCartao,
    total_rendimento_aplicacao: totalRendimentoAplicacao,
    total_resgate_aplicacao: totalResgateAplicacao,
    total_vendas_cartao: totalVendasCartao,
    total_entradas_real: totalEntradasReal,
    // Aliases legados
    total_banco: totalBancoBruto,
    total_socios_banco: totalAporteSocios,
    total_cartao: totalVendasCartao,
    total_entradas: totalEntradasReal,
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
      total_entradas: resultado.total_entradas_real,
      total_faturado: resultado.total_faturado,
      total_cartao: resultado.total_vendas_cartao,
      diferenca: resultado.diferenca,
      percentual_inconsistencia: resultado.percentual_inconsistencia,
      status: resultado.status,
      ...(pdfPath ? { pdf_path: pdfPath } : {}),
    },
    create: {
      empresa_id: resultado.empresa_id,
      mes_ref: resultado.mes_ref,
      total_entradas: resultado.total_entradas_real,
      total_faturado: resultado.total_faturado,
      total_cartao: resultado.total_vendas_cartao,
      diferenca: resultado.diferenca,
      percentual_inconsistencia: resultado.percentual_inconsistencia,
      status: resultado.status,
      ...(pdfPath ? { pdf_path: pdfPath } : {}),
    },
  })

  return relatorio.id
}
