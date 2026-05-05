/**
 * Estimativa de Impostos — upload manual de PDF por empresa+mês.
 * Não há cálculo automático: o admin/contador envia o PDF gerado externamente
 * e o cliente visualiza/baixa no portal.
 *
 * PDFs ficam no Supabase Storage (bucket "estimativas"), pois o host pode ser
 * efêmero (Railway recria o disco em cada deploy).
 */

import { Request, Response, NextFunction } from 'express'
import pdfParse from 'pdf-parse'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { Role, Prisma } from '@prisma/client'
import { uploadPDF, downloadPDF } from '../utils/storage'
import { audit } from '../utils/audit'

function normalizeCnpj(cnpj: string): string {
  return cnpj.replace(/\D/g, '')
}

/**
 * Extrai CNPJ e mês de referência (YYYY-MM) do texto do PDF.
 * CNPJ: aceita "12.345.678/0001-99" ou 14 dígitos consecutivos.
 * Mês: prioriza a 1ª ocorrência "MM/YYYY" que aparece após o CNPJ — o layout
 *      das estimativas coloca a competência imediatamente após o CNPJ, e a
 *      data de apuração ("09/04/2026") aparece antes como DD/MM/YYYY.
 *      Se não achar após o CNPJ, faz fallback pelo padrão "Competência: MM/YYYY"
 *      ou pela 1ª MM/YYYY isolada (sem DD/ antes) do documento.
 */
function mmYYYYtoDate(mm: string, yy: string): Date {
  return new Date(Date.UTC(parseInt(yy, 10), parseInt(mm, 10) - 1, 1))
}

function parseBRL(s: string): number {
  const clean = s.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.')
  const n = parseFloat(clean)
  return isNaN(n) ? 0 : n
}

/**
 * Extrai o "TOTAL" principal de um PDF de estimativa de impostos.
 *
 * Layout de referência (modelo da Christiane — ONCOHIV / Guilherme Leta / S3):
 *   | TRIBUTO | VENCIMENTO  | R$ (TOTAL DA GUIA) | (Mês corrente)  |
 *   | ISS     | 06/04/2026  | 372,93             | 372,93           |
 *   | CSLL    | 30/04/2026  | 5.759,58           | 1.919,86         |  ← trimestral
 *   | IRPJ    | 30/04/2026  | 9.925,96           | 3.308,65         |  ← trimestral
 *   | ...
 *   | TOTAL   |             | 19.817,32          |                  |  ← linha consolidada
 *
 * O sistema deve sempre pegar a coluna "R$ (TOTAL DA GUIA)" — é o valor que
 * o cliente efetivamente paga. A coluna "Mês corrente" mostra apenas a parcela
 * atribuída àquele mês (em guias trimestrais é menor) e não deve ser usada.
 *
 * Estratégia de extração:
 *   1. Linha que começa com "TOTAL" (sem outros prefixos) seguida de um valor
 *      monetário — é a linha consolidada da tabela. Quando há mais de uma
 *      ocorrência, pega a do MAIOR valor (a parcial "TOTAL Mês" eventualmente
 *      aparece e é menor que o consolidado da guia).
 *   2. Marcadores explícitos: "TOTAL GERAL", "Total a pagar/recolher",
 *      "Total da guia" — usados em layouts que rotulam a coluna.
 *   3. Soma das linhas de tributo (ISS, PIS, COFINS, CSLL, IRPJ etc.) pela
 *      coluna "TOTAL DA GUIA" — fallback quando o PDF não tem linha "TOTAL"
 *      consolidada.
 *   4. Maior valor monetário do documento — último recurso.
 */
function extrairTotalGeral(text: string): number {
  // Estratégia 1 — Linhas que começam com "TOTAL" (boundary de início de linha
  // ou após espaço/tab; NÃO deve casar com "SUBTOTAL"/"TOTAL DO TRIMESTRE" etc.)
  // Pega TODOS os candidatos e devolve o maior — em layouts trimestrais existe
  // "TOTAL DO MÊS" (menor) E "TOTAL DA GUIA"/"TOTAL GERAL" (maior).
  const reTotalLinha = /(?:^|\n)\s*total(?:\s+(?:geral|da\s+guia|a\s+(?:pagar|recolher)))?[^\d\n]{0,40}([\d.]+,\d{2})/gi
  let melhorTotal = 0
  for (const m of text.matchAll(reTotalLinha)) {
    const v = parseBRL(m[1])
    if (v > melhorTotal) melhorTotal = v
  }
  if (melhorTotal > 0) return melhorTotal

  // Estratégia 2 — Marcadores explícitos sem exigir início de linha
  const padroesExplicitos = [
    /total\s+geral[^\d]{0,20}([\d.]+,\d{2})/i,
    /total\s+da\s+guia[^\d]{0,20}([\d.]+,\d{2})/i,
    /total\s+a\s+(?:pagar|recolher)[^\d]{0,20}([\d.]+,\d{2})/i,
  ]
  for (const re of padroesExplicitos) {
    const m = text.match(re)
    if (m) return parseBRL(m[1])
  }

  // Estratégia 3 — Soma das linhas de tributo. Procura por nomes de tributos
  // brasileiros seguidos por uma data DD/MM/YYYY e dois valores monetários
  // (TOTAL DA GUIA + Mês corrente); pega o PRIMEIRO valor (TOTAL).
  const tributos = ['iss', 'pis', 'cofins', 'csll', 'irpj', 'inss', 'irrf', 'icms', 'das']
  let somaTributos = 0
  for (const t of tributos) {
    const re = new RegExp(
      `\\b${t}\\b[^\\n]*?\\d{2}\\/\\d{2}\\/\\d{4}[^\\n]*?([\\d.]+,\\d{2})`,
      'gi',
    )
    for (const m of text.matchAll(re)) {
      somaTributos += parseBRL(m[1])
    }
  }
  if (somaTributos > 0) return somaTributos

  // Estratégia 4 — Último recurso: maior valor monetário do documento.
  let maior = 0
  for (const m of text.matchAll(/(?<![\d,])([\d]{1,3}(?:\.\d{3})*,\d{2})(?!\d)/g)) {
    const v = parseBRL(m[1])
    if (v > maior) maior = v
  }
  return maior
}

/** Exposto para teste — não usar no fluxo de produção (use extrairCnpjEMes) */
export const _extrairTotalGeralForTest = extrairTotalGeral

interface EstimativaExtraida {
  cnpj: string | null
  mesRef: Date | null
  valorTotal: number
  /** Tributos individuais detectados na tabela do PDF (ISS, PIS, COFINS, etc.) */
  tributos: Array<{ tributo: string; vencimento: string | null; valor_total: number }>
}

function extrairTributos(text: string): EstimativaExtraida['tributos'] {
  // Procura por linhas no formato: TRIBUTO  DD/MM/YYYY  X.XXX,XX  (Y.YYY,YY)?
  const tributosConhecidos = ['ISS', 'PIS', 'COFINS', 'CSLL', 'IRPJ', 'INSS', 'IRRF', 'ICMS', 'DAS', 'ISSQN']
  const out: EstimativaExtraida['tributos'] = []
  for (const t of tributosConhecidos) {
    const re = new RegExp(
      `\\b${t}\\b[^\\n]*?(\\d{2}/\\d{2}/\\d{4})?[^\\n]*?([\\d.]+,\\d{2})`,
      'gi',
    )
    for (const m of text.matchAll(re)) {
      out.push({
        tributo: t,
        vencimento: m[1] ?? null,
        valor_total: parseBRL(m[2]),
      })
    }
  }
  return out
}

async function extrairEstimativa(buffer: Buffer): Promise<EstimativaExtraida> {
  const data = await pdfParse(buffer)
  const text = data.text ?? ''

  const reCnpjFull = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|(?<!\d)\d{14}(?!\d)/
  const matchCnpj = text.match(reCnpjFull)
  const cnpj = matchCnpj ? normalizeCnpj(matchCnpj[0]) : null

  // "MM/YYYY" isolada (não precedida de "DD/") — evita pegar fragmento de DD/MM/YYYY
  const reMesIsolada = /(?<!\d\/)(?<!\d)(0[1-9]|1[0-2])\/(\d{4})(?!\/)(?!\d)/g

  let mesRef: Date | null = null

  // Prioridade 1: primeira MM/YYYY após o CNPJ (layout padrão das estimativas)
  if (matchCnpj && matchCnpj.index !== undefined) {
    const depois = text.slice(matchCnpj.index + matchCnpj[0].length)
    const m = reMesIsolada.exec(depois)
    if (m) mesRef = mmYYYYtoDate(m[1], m[2])
  }

  // Prioridade 2: marcador explícito "Competência"/"Referência" seguido de MM/YYYY
  if (!mesRef) {
    const m = text.match(/(?:compet[êe]ncia|refer[êe]ncia|m[êe]s\s*ref)[^\d]{0,30}(0[1-9]|1[0-2])\/(\d{4})/i)
    if (m) mesRef = mmYYYYtoDate(m[1], m[2])
  }

  // Prioridade 3: primeira MM/YYYY isolada do documento
  if (!mesRef) {
    reMesIsolada.lastIndex = 0
    const m = reMesIsolada.exec(text)
    if (m) mesRef = mmYYYYtoDate(m[1], m[2])
  }

  const valorTotal = extrairTotalGeral(text)
  const tributos = extrairTributos(text)

  return { cnpj, mesRef, valorTotal, tributos }
}


function parseMesRef(mes: string): Date {
  const [year, month] = mes.split('-').map(Number)
  if (!year || !month || month < 1 || month > 12) {
    throw new AppError(422, 'Formato de mês inválido. Use YYYY-MM')
  }
  return new Date(Date.UTC(year, month - 1, 1))
}

function buildStorageKey(empresa_id: string, mesRef: Date): string {
  // Timestamp na key torna cada upload único: evita colisão de cache no CDN
  // do Supabase quando o admin substitui o PDF de um mesmo mês.
  const mes = mesRef.toISOString().slice(0, 7) // YYYY-MM
  return `${empresa_id}/${mes}/${Date.now()}.pdf`
}

/** POST /api/estimativa-imposto/upload */
export async function uploadEstimativa(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const file = req.file
    const { empresa_id, mes_ref } = req.body as { empresa_id?: string; mes_ref?: string }

    if (!file) throw new AppError(400, 'Arquivo PDF obrigatório')
    if (!empresa_id) throw new AppError(400, 'empresa_id obrigatório')
    if (!mes_ref) throw new AppError(400, 'mes_ref obrigatório (formato YYYY-MM)')
    if (!file.buffer) throw new AppError(500, 'Upload precisa estar em memória (memoryStorage)')

    const empresa = await prisma.empresa.findUnique({ where: { id: empresa_id } })
    if (!empresa) throw new AppError(404, 'Empresa não encontrada')

    const mesRef = parseMesRef(mes_ref)
    const key = buildStorageKey(empresa_id, mesRef)

    // Extrai dados completos do PDF — não bloqueia o fluxo se a extração
    // falhar (alguns layouts não trazem o total no formato esperado).
    let valorTotal = 0
    let extractedData: Prisma.InputJsonValue | undefined
    try {
      const r = await extrairEstimativa(file.buffer)
      valorTotal = r.valorTotal
      extractedData = {
        cnpj_detectado: r.cnpj,
        mes_ref_detectado: r.mesRef ? r.mesRef.toISOString().slice(0, 7) : null,
        valor_total: r.valorTotal,
        tributos: r.tributos,
      } as Prisma.InputJsonValue
    } catch { /* ignora — valor permanece 0 */ }

    await uploadPDF(key, file.buffer)

    // Histórico: cada upload é uma nova versão. A listagem usa `uploaded_at desc`
    // para mostrar a versão mais recente; as anteriores ficam acessíveis pelo
    // próprio histórico no portal.
    const estimativa = await prisma.estimativaImpostoPDF.create({
      data: {
        empresa_id,
        mes_ref: mesRef,
        pdf_path: key,
        nome_original: file.originalname,
        tamanho_bytes: file.size,
        valor_total: valorTotal,
        extracted_data: extractedData,
        uploaded_by: req.user!.id,
      },
    })

    await audit({
      acao: 'CREATE_ESTIMATIVA',
      entidade: 'EstimativaImpostoPDF',
      entidade_id: estimativa.id,
      empresa_id,
      detalhes: {
        nome_original: file.originalname,
        mes_ref: mes_ref,
        valor_total: valorTotal,
      },
      req,
    })

    res.status(201).json({
      id: estimativa.id,
      empresa_id,
      mes_ref: mes_ref,
      nome_original: file.originalname,
      tamanho_bytes: file.size,
      valor_total: Number(estimativa.valor_total),
    })
  } catch (err) {
    next(err)
  }
}

/**
 * Persiste 1 PDF de estimativa: resolve empresa+mês (hints ou auto-detectado),
 * substitui PDF anterior do mesmo (empresa, mês), faz upload ao Storage.
 */
export async function persistirEstimativa(params: {
  file: Express.Multer.File
  empresa_id_hint?: string
  mes_ref_hint?: string
  uploaded_by: string
}): Promise<{
  id: string
  empresa_id: string
  empresa_razao: string
  mes_ref: string
  nome_original: string
  tamanho_bytes: number
  valor_total: number
}> {
  const { file, empresa_id_hint, mes_ref_hint, uploaded_by } = params
  if (!file.buffer) throw new AppError(500, 'Upload precisa estar em memória (memoryStorage)')

  let empresa_id = empresa_id_hint
  let mesRef: Date | null = mes_ref_hint ? parseMesRef(mes_ref_hint) : null

  // Sempre extrai dados completos do PDF (mesmo quando hints estão presentes).
  const detect = await extrairEstimativa(file.buffer)
  const valorTotal = detect.valorTotal
  const extractedData: Prisma.InputJsonValue = {
    cnpj_detectado: detect.cnpj,
    mes_ref_detectado: detect.mesRef ? detect.mesRef.toISOString().slice(0, 7) : null,
    valor_total: detect.valorTotal,
    tributos: detect.tributos,
  } as Prisma.InputJsonValue

  if (!empresa_id) {
    if (!detect.cnpj) throw new AppError(422, 'Não foi possível identificar o CNPJ no PDF — selecione uma empresa.')
    const empresa = await prisma.empresa.findUnique({ where: { cnpj: detect.cnpj } })
    if (!empresa) {
      throw new AppError(
        404,
        `CNPJ ${detect.cnpj} do PDF não está cadastrado — cadastre a empresa antes de subir o arquivo.`,
      )
    }
    empresa_id = empresa.id
  }
  if (!mesRef) {
    if (!detect.mesRef) throw new AppError(422, 'Não foi possível identificar o mês de referência no PDF.')
    mesRef = detect.mesRef
  }

  const empresa = await prisma.empresa.findUnique({ where: { id: empresa_id } })
  if (!empresa) throw new AppError(404, 'Empresa não encontrada')

  const key = buildStorageKey(empresa_id, mesRef)
  await uploadPDF(key, file.buffer)

  const estimativa = await prisma.estimativaImpostoPDF.create({
    data: {
      empresa_id,
      mes_ref: mesRef,
      pdf_path: key,
      nome_original: file.originalname,
      tamanho_bytes: file.size,
      valor_total: valorTotal,
      extracted_data: extractedData,
      uploaded_by,
    },
  })

  await audit({
    acao: 'CREATE_ESTIMATIVA',
    entidade: 'EstimativaImpostoPDF',
    entidade_id: estimativa.id,
    empresa_id,
    detalhes: {
      nome_original: file.originalname,
      mes_ref: mesRef.toISOString().slice(0, 7),
      valor_total: valorTotal,
      via: 'lote',
    },
  })

  return {
    id: estimativa.id,
    empresa_id,
    empresa_razao: empresa.razao_social,
    mes_ref: mesRef.toISOString().slice(0, 7),
    nome_original: file.originalname,
    tamanho_bytes: file.size,
    valor_total: Number(estimativa.valor_total),
  }
}

/** POST /api/estimativa-imposto/upload/lote — auto-roteia cada PDF via CNPJ + mês extraídos */
export async function uploadEstimativaLote(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const files = (req.files as Express.Multer.File[] | undefined) ?? []
    if (files.length === 0) throw new AppError(400, 'Nenhum arquivo enviado')

    const { empresa_id } = req.body as { empresa_id?: string }

    const resultados = await Promise.all(
      files.map(async file => {
        try {
          const r = await persistirEstimativa({
            file,
            empresa_id_hint: empresa_id || undefined,
            uploaded_by: req.user!.id,
          })
          return {
            nome_original: file.originalname,
            status:        'sucesso' as const,
            id:            r.id,
            empresa_id:    r.empresa_id,
            empresa_razao: r.empresa_razao,
            mes_ref:       r.mes_ref,
            tamanho_bytes: r.tamanho_bytes,
            erro:          null,
          }
        } catch (e) {
          return {
            nome_original: file.originalname,
            status:        'erro' as const,
            id:            null,
            empresa_id:    null,
            empresa_razao: null,
            mes_ref:       null,
            tamanho_bytes: file.size,
            erro:          e instanceof Error ? e.message : 'Erro desconhecido',
          }
        }
      }),
    )

    const sucesso = resultados.filter(r => r.status === 'sucesso').length
    res.status(201).json({
      total:      resultados.length,
      sucesso,
      falha:      resultados.length - sucesso,
      resultados,
    })
  } catch (err) {
    next(err)
  }
}

/** GET /api/estimativa-imposto?empresa_id=&mes_ref= → metadados */
export async function getEstimativa(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { user } = req
    if (!user) throw new AppError(401, 'Não autenticado')

    const mesStr = String(req.query['mes_ref'] ?? '')
    if (!mesStr) throw new AppError(400, 'mes_ref obrigatório')
    const mesRef = parseMesRef(mesStr)

    let empresaId: string
    if (user.role === Role.CLIENTE) {
      if (!user.empresa_id) throw new AppError(403, 'Usuário não vinculado a uma empresa')
      empresaId = user.empresa_id
    } else {
      const q = req.query['empresa_id'] as string | undefined
      if (!q) throw new AppError(400, 'empresa_id obrigatório para admin/contador')
      empresaId = q
    }

    // Sem unique([empresa_id, mes_ref]) — escolhemos a versão mais recente
    // como a "vigente". Soft delete: ignoramos registros com deleted_at.
    const estimativa = await prisma.estimativaImpostoPDF.findFirst({
      where: { empresa_id: empresaId, mes_ref: mesRef, deleted_at: null },
      orderBy: { uploaded_at: 'desc' },
      select: {
        id: true,
        mes_ref: true,
        nome_original: true,
        tamanho_bytes: true,
        uploaded_at: true,
        valor_total: true,
      },
    })

    if (!estimativa) {
      res.status(404).json({ mensagem: 'Nenhuma estimativa cadastrada para este mês' })
      return
    }

    res.json({
      ...estimativa,
      valor_total: Number(estimativa.valor_total),
    })
  } catch (err) {
    next(err)
  }
}

type PeriodFilter = 'all' | 'last_month' | 'last_3_months' | 'last_6_months' | 'last_year'

/**
 * Resolve filtro de data baseado em `period` (query string).
 * `last_month` = uploads dos últimos 30 dias (uploaded_at);
 * outros = filtra por mes_ref retroativo a partir do mês corrente.
 */
function buildPeriodFilter(period: PeriodFilter | undefined): { uploaded_at?: { gte: Date }; mes_ref?: { gte: Date } } {
  if (!period || period === 'all') return {}
  const hoje = new Date()
  switch (period) {
    case 'last_month': {
      const d = new Date(hoje); d.setUTCDate(d.getUTCDate() - 30)
      return { uploaded_at: { gte: d } }
    }
    case 'last_3_months': {
      const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 2, 1))
      return { mes_ref: { gte: d } }
    }
    case 'last_6_months': {
      const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 5, 1))
      return { mes_ref: { gte: d } }
    }
    case 'last_year': {
      const d = new Date(Date.UTC(hoje.getUTCFullYear() - 1, hoje.getUTCMonth(), 1))
      return { mes_ref: { gte: d } }
    }
    default:
      return {}
  }
}

/** GET /api/estimativa-imposto/historico → lista versões com filtros granulares.
 *
 * Query params:
 *   ?period=last_month | last_3_months | last_6_months | last_year | all  (sobrescreve)
 *   ?incluir_substituidas=true   (admin: inclui versões antigas do mesmo mês)
 *
 * Para usuários CLIENTE, sem `period`, aplica a janela configurada em
 * `Empresa.estimativa_historico_meses` (1/6/null=todos). Soft delete sempre filtrado.
 *
 * Cada item vem com `vigente: boolean` indicando se é a versão mais recente
 * do seu mês de referência (entre os não-deletados).
 */
export async function listHistoricoEstimativas(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { user } = req
    if (!user) throw new AppError(401, 'Não autenticado')

    let empresaId: string
    let isCliente = false
    if (user.role === Role.CLIENTE) {
      if (!user.empresa_id) throw new AppError(403, 'Usuário não vinculado a uma empresa')
      empresaId = user.empresa_id
      isCliente = true
    } else {
      const q = req.query['empresa_id'] as string | undefined
      if (!q) throw new AppError(400, 'empresa_id obrigatório para admin/contador')
      empresaId = q
    }

    const periodQ = req.query['period'] as PeriodFilter | undefined

    let where: Prisma.EstimativaImpostoPDFWhereInput = {
      empresa_id: empresaId,
      deleted_at: null,
    }

    if (periodQ) {
      // Filtro explícito do usuário (dropdown de período)
      Object.assign(where, buildPeriodFilter(periodQ))
    } else if (isCliente) {
      // Sem filtro explícito + cliente: respeita a janela configurada na empresa
      const empresa = await prisma.empresa.findUnique({
        where: { id: empresaId },
        select: { estimativa_historico_meses: true },
      })
      const janela = empresa?.estimativa_historico_meses ?? null
      if (janela && janela > 1) {
        const inicio = new Date()
        inicio.setUTCDate(1)
        inicio.setUTCMonth(inicio.getUTCMonth() - (janela - 1))
        where = { ...where, mes_ref: { gte: inicio } }
      }
      // janela === 1 trata-se abaixo (limita a 1 item)
    }

    let take: number | undefined
    if (isCliente && !periodQ) {
      const empresa = await prisma.empresa.findUnique({
        where: { id: empresaId },
        select: { estimativa_historico_meses: true },
      })
      if (empresa?.estimativa_historico_meses === 1) take = 1
    }

    const items = await prisma.estimativaImpostoPDF.findMany({
      where,
      orderBy: [{ mes_ref: 'desc' }, { uploaded_at: 'desc' }],
      ...(take ? { take } : {}),
      select: {
        id: true,
        mes_ref: true,
        nome_original: true,
        tamanho_bytes: true,
        uploaded_at: true,
        valor_total: true,
      },
    })

    // Marca vigente: o primeiro registro (mais recente) de cada mes_ref distinto.
    // Como já vem ordenado por mes_ref desc, uploaded_at desc, basta marcar o
    // primeiro de cada mês.
    const mesesVistos = new Set<string>()
    const data = items.map(i => {
      const mesKey = i.mes_ref.toISOString().slice(0, 7)
      const vigente = !mesesVistos.has(mesKey)
      mesesVistos.add(mesKey)
      return { ...i, valor_total: Number(i.valor_total), vigente }
    })

    res.json({ data })
  } catch (err) {
    next(err)
  }
}

/** GET /api/estimativa-imposto/:id/pdf → download */
export async function downloadEstimativa(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { user } = req
    if (!user) throw new AppError(401, 'Não autenticado')

    const estimativa = await prisma.estimativaImpostoPDF.findUnique({
      where: { id: req.params['id'] },
      include: { empresa: { select: { razao_social: true, cnpj: true } } },
    })
    if (!estimativa) throw new AppError(404, 'Estimativa não encontrada')
    if (estimativa.deleted_at) throw new AppError(410, 'Estimativa removida')

    if (user.role === Role.CLIENTE && user.empresa_id !== estimativa.empresa_id) {
      throw new AppError(403, 'Acesso negado')
    }

    const buffer = await downloadPDF(estimativa.pdf_path)
    if (!buffer) throw new AppError(410, 'Arquivo não encontrado no Storage')

    const mes = new Date(estimativa.mes_ref).toISOString().slice(0, 7)
    const cnpj = estimativa.empresa.cnpj.replace(/\D/g, '') || 'sem_cnpj'
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="estimativa_${cnpj}_${mes}.pdf"`)
    res.send(buffer)
  } catch (err) {
    next(err)
  }
}

/** DELETE /api/estimativa-imposto/:id — SOFT DELETE.
 *
 * O registro fica marcado com `deleted_at`/`deleted_by` mas NÃO é removido,
 * e o PDF no Storage permanece (decisão da Christiane: manter histórico
 * contábil por tempo indefinido). Listagens filtram registros com
 * `deleted_at != null`.
 */
export async function deleteEstimativa(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { user } = req
    if (!user) throw new AppError(401, 'Não autenticado')

    const estimativa = await prisma.estimativaImpostoPDF.findUnique({
      where: { id: req.params['id'] },
    })
    if (!estimativa) throw new AppError(404, 'Estimativa não encontrada')
    if (estimativa.deleted_at) {
      // Idempotente — já estava deletada
      res.json({ deletado: true, ja_deletado: true })
      return
    }

    await prisma.estimativaImpostoPDF.update({
      where: { id: estimativa.id },
      data: {
        deleted_at: new Date(),
        deleted_by: user.id,
      },
    })

    await audit({
      acao: 'DELETE_ESTIMATIVA',
      entidade: 'EstimativaImpostoPDF',
      entidade_id: estimativa.id,
      empresa_id: estimativa.empresa_id,
      detalhes: {
        nome_original: estimativa.nome_original,
        mes_ref: estimativa.mes_ref.toISOString().slice(0, 7),
        valor_total: Number(estimativa.valor_total),
      },
      req,
    })

    res.json({ deletado: true, soft: true })
  } catch (err) {
    next(err)
  }
}
