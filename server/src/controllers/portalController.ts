/**
 * Portal do Cliente — endpoints que retornam dados financeiros
 * da empresa vinculada ao usuário logado.
 * ADMIN/CONTADOR podem consultar qualquer empresa via query ?empresa_id=
 */

import { Request, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { Role, PerfilCliente } from '@prisma/client'
import { LIMITE_DISTRIBUICAO_ISENTA, calcularIrDevido } from '../utils/distribuicao'
import { isInvestimentoAutomatico } from '../utils/investimento'

// Estimativa de alíquota efetiva por regime (simplificado)
const ALIQUOTA_ESTIMADA: Record<string, number> = {
  SIMPLES_NACIONAL: 0.06,
  LUCRO_PRESUMIDO: 0.15,
  LUCRO_REAL: 0.25,
}

function mesBounds(mes: string) {
  const [year, month] = mes.split('-').map(Number)
  if (!year || !month || month < 1 || month > 12) return null
  return {
    inicio: new Date(Date.UTC(year, month - 1, 1)),
    fim: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
  }
}

/** Resolve o empresa_id levando em conta o role do usuário */
function resolveEmpresaId(req: Request): string {
  const { user } = req
  if (!user) throw new AppError(401, 'Não autenticado')

  if (user.role === Role.CLIENTE) {
    if (!user.empresa_id) throw new AppError(403, 'Usuário não vinculado a uma empresa')
    return user.empresa_id
  }

  // ADMIN/CONTADOR pode passar ?empresa_id=
  const id = req.query['empresa_id'] as string | undefined
  if (!id) throw new AppError(400, 'empresa_id obrigatório para admin/contador')
  return id
}

/**
 * Perfil ADMINISTRATIVO: usuário CLIENTE com acesso restrito, não visualiza
 * retiradas, distribuição de lucros nem pró-labore.
 */
async function isAdministrativoRestrito(req: Request): Promise<boolean> {
  const { user } = req
  if (!user || user.role !== Role.CLIENTE) return false
  const perfil = await prisma.usuario.findUnique({
    where: { id: user.id },
    select: { perfil_cliente: true },
  })
  return perfil?.perfil_cliente === PerfilCliente.ADMINISTRATIVO
}

// ─── GET /api/portal/dashboard/:mes ──────────────────────────────────────────

export async function getDashboard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const empresaId = resolveEmpresaId(req)
    const bounds = mesBounds(req.params['mes'] ?? '')
    if (!bounds) throw new AppError(422, 'Formato de mês inválido. Use YYYY-MM')

    const restrito = await isAdministrativoRestrito(req)

    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { id: true, razao_social: true, cnpj: true, regime_tributario: true, saldo_inicial: true },
    })
    if (!empresa) throw new AppError(404, 'Empresa não encontrada')

    // Transações bancárias do mês
    const transacoes = await prisma.transacaoBancaria.findMany({
      where: { empresa_id: empresaId, data: { gte: bounds.inicio, lte: bounds.fim } },
      orderBy: { data: 'desc' },
      select: { data: true, descricao: true, valor: true, tipo: true, socio_id: true },
    })

    // Bug 1: entradas de sócios (aportes) são excluídas, assim como no engine de conciliação
    const totalEntradas = transacoes
      .filter(t => t.tipo === 'ENTRADA' && !t.socio_id && !isInvestimentoAutomatico(t.descricao))
      .reduce((s, t) => s + Number(t.valor), 0)

    const totalDespesas = transacoes
      .filter(t => t.tipo === 'SAIDA' && !t.socio_id && !isInvestimentoAutomatico(t.descricao))
      .reduce((s, t) => s + Number(t.valor), 0)

    // Retiradas de sócios são separadas dos pagamentos/despesas operacionais
    const totalRetiradas = transacoes
      .filter(t => t.tipo === 'SAIDA' && t.socio_id && !isInvestimentoAutomatico(t.descricao))
      .reduce((s, t) => s + Number(t.valor), 0)

    // Liquidações de cartão do mês
    const cartoes = await prisma.transacaoCartao.findMany({
      where: { empresa_id: empresaId, data: { gte: bounds.inicio, lte: bounds.fim } },
      select: { valor_liquido: true },
    })
    const totalCartao = cartoes.reduce((s, t) => s + Number(t.valor_liquido), 0)

    // Faturamento
    const faturamento = await prisma.faturamento.findFirst({
      where: { empresa_id: empresaId, mes_ref: { gte: bounds.inicio, lte: bounds.fim } },
      select: { valor_total_nf: true, qtd_notas: true },
    })
    const totalFaturado = Number(faturamento?.valor_total_nf ?? 0)

    // Impostos estimados (% do faturamento pelo regime)
    const aliquota = ALIQUOTA_ESTIMADA[empresa.regime_tributario] ?? 0.06
    const impostosEstimados = totalFaturado * aliquota

    // Caixa livre = saldo inicial + entradas (banco válidas + cartão) − despesas − retiradas de sócios − impostos estimados
    const saldoInicial = Number(empresa.saldo_inicial ?? 0)
    const totalEntradasReal = totalEntradas + totalCartao
    const caixaLivre = saldoInicial + totalEntradasReal - totalDespesas - totalRetiradas - impostosEstimados

    // Período liberado = há qualquer dado importado para o mês (OFX, cartão ou IAZAN)
    // Bug 2/3: busca o relatório persistido; expõe diferenca para o frontend não recalcular
    const relatorio = await prisma.relatorioDesconforto.findFirst({
      where: { empresa_id: empresaId, mes_ref: { gte: bounds.inicio, lte: bounds.fim } },
      select: { status: true, percentual_inconsistencia: true, diferenca: true, liberado: true },
    })

    // Bug 3: periodo_liberado é controlado pelo contador via PUT /api/admin/liberacao/:empresa/:mes
    const periodoLiberado = relatorio?.liberado ?? false

    // Últimas 10 transações (excluindo investimentos automáticos)
    const ultimasTransacoes = transacoes
      .filter(t => !isInvestimentoAutomatico(t.descricao))
      .slice(0, 10)
      .map(t => ({
        data: t.data,
        descricao: t.descricao,
        valor: Number(t.valor),
        tipo: t.tipo,
      }))

    res.json({
      empresa: { ...empresa, saldo_inicial: saldoInicial },
      mes_ref: req.params['mes'],
      saldo_inicial: saldoInicial,
      total_entradas: totalEntradas,
      total_entradas_cartao: totalCartao,
      total_entradas_real: totalEntradasReal,
      total_despesas: totalDespesas,
      total_retiradas_socios: restrito ? 0 : totalRetiradas,
      total_faturado: totalFaturado,
      impostos_estimados: Math.round(impostosEstimados * 100) / 100,
      caixa_livre: Math.round(caixaLivre * 100) / 100,
      periodo_liberado: periodoLiberado,
      // Bug 2: expõe diferenca e percentual do relatório auditado, não recalcula no frontend
      conciliacao: relatorio
        ? {
            status: relatorio.status,
            percentual_inconsistencia: Number(relatorio.percentual_inconsistencia),
            diferenca: Number(relatorio.diferenca),
          }
        : null,
      ultimas_transacoes: ultimasTransacoes,
    })
  } catch (err) {
    next(err)
  }
}

// ─── GET /api/portal/historico ────────────────────────────────────────────────

export async function getHistorico(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const empresaId = resolveEmpresaId(req)
    const meses = Math.min(24, Math.max(1, Number(req.query['meses'] ?? 12)))
    const restrito = await isAdministrativoRestrito(req)

    // Busca todos os 12 meses de transações
    const fim = new Date()
    const inicio = new Date(Date.UTC(fim.getUTCFullYear(), fim.getUTCMonth() - (meses - 1), 1))

    const transacoes = await prisma.transacaoBancaria.findMany({
      where: { empresa_id: empresaId, data: { gte: inicio } },
      select: { data: true, valor: true, tipo: true, descricao: true, socio_id: true },
    })

    const cartoes = await prisma.transacaoCartao.findMany({
      where: { empresa_id: empresaId, data: { gte: inicio } },
      select: { data: true, valor_liquido: true },
    })

    // Agrupa por mês
    const map = new Map<string, { entradas: number; despesas: number; cartao: number; retiradas: number }>()

    for (let i = 0; i < meses; i++) {
      const d = new Date(Date.UTC(fim.getUTCFullYear(), fim.getUTCMonth() - i, 1))
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
      map.set(key, { entradas: 0, despesas: 0, cartao: 0, retiradas: 0 })
    }

    for (const t of transacoes) {
      // Exclui aplicações/resgates automáticos de investimento (ex: Itaú "Aplic Aut Mais")
      if (isInvestimentoAutomatico(t.descricao)) continue

      const d = new Date(t.data)
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
      const entry = map.get(key)
      if (!entry) continue

      if (t.socio_id) {
        if (t.tipo === 'SAIDA') entry.retiradas += Number(t.valor)
        continue
      }
      if (t.tipo === 'ENTRADA') entry.entradas += Number(t.valor)
      else entry.despesas += Number(t.valor)
    }

    for (const t of cartoes) {
      const d = new Date(t.data)
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
      const entry = map.get(key)
      if (entry) entry.cartao += Number(t.valor_liquido)
    }

    const data = Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, v]) => ({
        mes,
        mes_label: new Date(`${mes}-01`).toLocaleDateString('pt-BR', {
          month: 'short',
          year: '2-digit',
          timeZone: 'UTC',
        }),
        receitas: Math.round((v.entradas + v.cartao) * 100) / 100,
        despesas: Math.round(v.despesas * 100) / 100,
        retiradas: restrito ? 0 : Math.round(v.retiradas * 100) / 100,
      }))

    res.json({ data })
  } catch (err) {
    next(err)
  }
}

// ─── GET /api/portal/alertas ──────────────────────────────────────────────────

export async function getAlertas(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const empresaId = resolveEmpresaId(req)
    const restrito = await isAdministrativoRestrito(req)

    // Retiradas com alerta nos últimos 3 meses
    const tresAtras = new Date(Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth() - 2,
      1,
    ))

    // Perfil ADMINISTRATIVO não visualiza alertas de retiradas de sócios
    const retiradas = restrito
      ? []
      : await prisma.retiradaSocio.findMany({
          where: { empresa_id: empresaId, alerta_limite: true, mes_ref: { gte: tresAtras } },
          include: { socio: { select: { nome: true, cpf_mascara: true } } },
          orderBy: { mes_ref: 'desc' },
        })

    // Bug 5: limita alertas de conciliação aos últimos 6 meses (evita alertas antigos aparecerem)
    const seisAtras = new Date(Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth() - 5,
      1,
    ))

    const relatorio = await prisma.relatorioDesconforto.findFirst({
      where: {
        empresa_id: empresaId,
        status: { in: ['ALERTA', 'AVISO'] },
        mes_ref: { gte: seisAtras },
      },
      orderBy: { mes_ref: 'desc' },
      select: {
        mes_ref: true,
        percentual_inconsistencia: true,
        diferenca: true,
        status: true,
      },
    })

    res.json({
      retiradas_alerta: retiradas.map(r => ({
        id: r.id,
        mes_ref: r.mes_ref,
        valor_total: Number(r.valor_total),
        limite_isencao: LIMITE_DISTRIBUICAO_ISENTA,
        ir_devido: calcularIrDevido(Number(r.valor_total)),
        socio_nome: r.socio.nome,
        socio_cpf_mascara: r.socio.cpf_mascara,
      })),
      conciliacao_alerta: relatorio
        ? {
            mes_ref: relatorio.mes_ref,
            percentual: Number(relatorio.percentual_inconsistencia),
            diferenca: Number(relatorio.diferenca),
            status: relatorio.status,
          }
        : null,
    })
  } catch (err) {
    next(err)
  }
}

// ─── GET /api/portal/perfil ───────────────────────────────────────────────────

export async function getPerfil(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        nome: true,
        email: true,
        role: true,
        empresa: {
          select: { id: true, razao_social: true, cnpj: true, regime_tributario: true },
        },
      },
    })

    if (!usuario) throw new AppError(404, 'Usuário não encontrado')
    res.json(usuario)
  } catch (err) {
    next(err)
  }
}

// ─── GET /api/portal/ultimo-mes ───────────────────────────────────────────────
// Retorna o último mês que possui qualquer dado importado para a empresa

export async function getUltimoMes(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const empresaId = resolveEmpresaId(req)

    // Busca a transação bancária mais recente
    const ultimaTransacao = await prisma.transacaoBancaria.findFirst({
      where: { empresa_id: empresaId },
      orderBy: { data: 'desc' },
      select: { data: true },
    })

    // Busca o faturamento mais recente
    const ultimoFaturamento = await prisma.faturamento.findFirst({
      where: { empresa_id: empresaId },
      orderBy: { mes_ref: 'desc' },
      select: { mes_ref: true },
    })

    // Busca a transação de cartão mais recente
    const ultimoCartao = await prisma.transacaoCartao.findFirst({
      where: { empresa_id: empresaId },
      orderBy: { data: 'desc' },
      select: { data: true },
    })

    // Pega a data mais recente entre as três fontes
    const datas = [
      ultimaTransacao?.data,
      ultimoFaturamento?.mes_ref,
      ultimoCartao?.data,
    ].filter(Boolean) as Date[]

    if (datas.length === 0) {
      res.json({ mes: null })
      return
    }

    const maisRecente = new Date(Math.max(...datas.map(d => d.getTime())))
    const mes = `${maisRecente.getUTCFullYear()}-${String(maisRecente.getUTCMonth() + 1).padStart(2, '0')}`

    res.json({ mes })
  } catch (err) {
    next(err)
  }
}

// ─── PUT /api/portal/perfil/senha ─────────────────────────────────────────────

export async function alterarSenha(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { senha_atual, nova_senha } = req.body as {
      senha_atual?: string
      nova_senha?: string
    }

    if (!senha_atual || !nova_senha) {
      throw new AppError(400, 'senha_atual e nova_senha são obrigatórios')
    }

    if (nova_senha.length < 6) throw new AppError(422, 'Nova senha deve ter ao menos 6 caracteres')

    const usuario = await prisma.usuario.findUnique({ where: { id: req.user!.id } })
    if (!usuario) throw new AppError(404, 'Usuário não encontrado')

    const ok = await bcrypt.compare(senha_atual, usuario.senha_hash)
    if (!ok) throw new AppError(401, 'Senha atual incorreta')

    const novoHash = await bcrypt.hash(nova_senha, 10)
    await prisma.usuario.update({
      where: { id: req.user!.id },
      data: { senha_hash: novoHash },
    })

    res.json({ mensagem: 'Senha alterada com sucesso' })
  } catch (err) {
    next(err)
  }
}
