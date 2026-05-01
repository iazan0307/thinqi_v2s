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
import { Role } from '@prisma/client'
import { uploadPDF, downloadPDF, deletePDF } from '../utils/storage'

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
 * Extrai o "TOTAL" principal (total geral mensal) de um PDF de estimativa
 * de impostos. Layouts variam, mas seguem o padrão: rótulo "TOTAL" isolado
 * seguido pelo maior valor da página. Ignora totais por sócio e trimestrais.
 */
function extrairTotalGeral(text: string): number {
  // Estratégia 1: "TOTAL GERAL: R$ X.XXX,XX" ou "Total a pagar: R$ X.XXX,XX"
  const padroesPrioritarios = [
    /total\s*geral[^\d]{0,20}([\d.]+,\d{2})/i,
    /total\s*a\s*(?:pagar|recolher)[^\d]{0,20}([\d.]+,\d{2})/i,
    /total\s*do\s*m[êe]s[^\d]{0,20}([\d.]+,\d{2})/i,
    /total\s*mensal[^\d]{0,20}([\d.]+,\d{2})/i,
  ]
  for (const re of padroesPrioritarios) {
    const m = text.match(re)
    if (m) return parseBRL(m[1])
  }

  // Estratégia 2: linhas iniciadas por "TOTAL" (case-insensitive) com um valor
  // monetário. Pega o ÚLTIMO ocorrência (geralmente o consolidado), evitando
  // totais parciais por sócio que aparecem antes.
  let valor = 0
  const reLinhaTotal = /total[^\d\n]{0,40}([\d.]+,\d{2})/gi
  for (const m of text.matchAll(reLinhaTotal)) {
    const v = parseBRL(m[1])
    if (v > valor) valor = v
  }
  if (valor > 0) return valor

  // Estratégia 3: maior valor monetário do documento (último recurso).
  let maior = 0
  for (const m of text.matchAll(/(?<![\d,])([\d]{1,3}(?:\.\d{3})*,\d{2})(?!\d)/g)) {
    const v = parseBRL(m[1])
    if (v > maior) maior = v
  }
  return maior
}

async function extrairCnpjEMes(
  buffer: Buffer,
): Promise<{ cnpj: string | null; mesRef: Date | null; valorTotal: number }> {
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

  return { cnpj, mesRef, valorTotal }
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

    // Extrai o TOTAL principal do PDF antes do upload — não bloqueia o fluxo
    // se a extração falhar (alguns layouts não trazem o total no formato
    // esperado; o admin pode editar o valor depois).
    let valorTotal = 0
    try {
      const { valorTotal: v } = await extrairCnpjEMes(file.buffer)
      valorTotal = v
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
        uploaded_by: req.user!.id,
      },
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
async function persistirEstimativa(params: {
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
  let valorTotal = 0

  // Sempre extrai o total do PDF (mesmo quando hints estão presentes).
  const detect = await extrairCnpjEMes(file.buffer)
  valorTotal = detect.valorTotal
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
      uploaded_by,
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
    // como a "atual"; o histórico fica acessível via /estimativa-imposto/historico.
    const estimativa = await prisma.estimativaImpostoPDF.findFirst({
      where: { empresa_id: empresaId, mes_ref: mesRef },
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

/** GET /api/estimativa-imposto/historico → lista todas as versões da empresa */
export async function listHistoricoEstimativas(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { user } = req
    if (!user) throw new AppError(401, 'Não autenticado')

    let empresaId: string
    if (user.role === Role.CLIENTE) {
      if (!user.empresa_id) throw new AppError(403, 'Usuário não vinculado a uma empresa')
      empresaId = user.empresa_id
    } else {
      const q = req.query['empresa_id'] as string | undefined
      if (!q) throw new AppError(400, 'empresa_id obrigatório para admin/contador')
      empresaId = q
    }

    const items = await prisma.estimativaImpostoPDF.findMany({
      where: { empresa_id: empresaId },
      orderBy: [{ mes_ref: 'desc' }, { uploaded_at: 'desc' }],
      select: {
        id: true,
        mes_ref: true,
        nome_original: true,
        tamanho_bytes: true,
        uploaded_at: true,
        valor_total: true,
      },
    })

    res.json({
      data: items.map(i => ({ ...i, valor_total: Number(i.valor_total) })),
    })
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

/** DELETE /api/estimativa-imposto/:id */
export async function deleteEstimativa(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const estimativa = await prisma.estimativaImpostoPDF.findUnique({
      where: { id: req.params['id'] },
    })
    if (!estimativa) throw new AppError(404, 'Estimativa não encontrada')

    await deletePDF(estimativa.pdf_path)
    await prisma.estimativaImpostoPDF.delete({ where: { id: estimativa.id } })

    res.json({ deletado: true })
  } catch (err) {
    next(err)
  }
}
