import { Request, Response, NextFunction } from 'express'
import archiver from 'archiver'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { calcularConciliacao, salvarRelatorio } from '../services/engine/conciliacao'
import { gerarPDFRelatorio } from '../services/report/pdf'

/** GET /api/conciliacao/:empresaId/:mes — Calcula (sem salvar) */
export async function getConciliacao(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { empresaId, mes } = req.params

    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new AppError(404, 'Empresa não encontrada')

    const [year, month] = mes.split('-').map(Number)
    if (!year || !month) throw new AppError(422, 'Formato de mês inválido. Use YYYY-MM')

    const mesRef = new Date(Date.UTC(year, month - 1, 1))
    const resultado = await calcularConciliacao(empresaId, mesRef)

    res.json(resultado)
  } catch (err) {
    next(err)
  }
}

/** POST /api/relatorio-desconforto/gerar — Calcula, salva e gera PDF */
export async function gerarRelatorio(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { empresa_id, mes_ref: mesStr } = req.body as {
      empresa_id?: string
      mes_ref?: string
    }

    if (!empresa_id) throw new AppError(400, 'empresa_id obrigatório')
    if (!mesStr) throw new AppError(400, 'mes_ref obrigatório (formato: YYYY-MM)')

    const empresa = await prisma.empresa.findUnique({ where: { id: empresa_id } })
    if (!empresa) throw new AppError(404, 'Empresa não encontrada')

    const [year, month] = mesStr.split('-').map(Number)
    if (!year || !month) throw new AppError(422, 'mes_ref inválido. Use formato YYYY-MM')

    const mesRef = new Date(Date.UTC(year, month - 1, 1))
    const resultado = await calcularConciliacao(empresa_id, mesRef)

    // Valida geração do PDF sem persistir: o download e o envio por e-mail sempre
    // regeneram a partir do resultado salvo, então não precisamos de cache em disco.
    await gerarPDFRelatorio(resultado, {
      razao_social: empresa.razao_social,
      cnpj: empresa.cnpj,
      regime_tributario: empresa.regime_tributario,
    })

    const relatorioId = await salvarRelatorio(resultado)

    res.status(201).json({ id: relatorioId, pdf_gerado: true })
  } catch (err) {
    next(err)
  }
}

/** GET /api/relatorio-desconforto — Lista relatórios (com filtros) */
export async function listRelatorios(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { empresa_id, status, mes_ref, page: pageQ, limit: limitQ } = req.query as Record<string, string>

    const page = Math.max(1, Number(pageQ) || 1)
    const limit = Math.min(500, Math.max(1, Number(limitQ) || 20))

    const where: Record<string, unknown> = {}
    if (empresa_id) where['empresa_id'] = empresa_id
    if (status) where['status'] = status
    if (mes_ref) {
      const [y, m] = mes_ref.split('-').map(Number)
      if (y && m) where['mes_ref'] = new Date(Date.UTC(y, m - 1, 1))
    }

    const [total, relatorios] = await Promise.all([
      prisma.relatorioDesconforto.count({ where }),
      prisma.relatorioDesconforto.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ mes_ref: 'desc' }, { created_at: 'desc' }],
        include: {
          empresa: { select: { id: true, razao_social: true, cnpj: true } },
        },
      }),
    ])

    res.json({ data: relatorios, meta: { total, page, limit } })
  } catch (err) {
    next(err)
  }
}

/** GET /api/relatorio-desconforto/:id — Busca um relatório */
export async function getRelatorio(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const relatorio = await prisma.relatorioDesconforto.findUnique({
      where: { id: req.params['id'] },
      include: { empresa: { select: { id: true, razao_social: true, cnpj: true, regime_tributario: true } } },
    })

    if (!relatorio) throw new AppError(404, 'Relatório não encontrado')

    res.json(relatorio)
  } catch (err) {
    next(err)
  }
}

/** GET /api/relatorio-desconforto/:id/pdf — Download do PDF (sempre regera) */
export async function downloadPDF(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const relatorio = await prisma.relatorioDesconforto.findUnique({
      where: { id: req.params['id'] },
      include: { empresa: { select: { razao_social: true, cnpj: true, regime_tributario: true } } },
    })

    if (!relatorio) throw new AppError(404, 'Relatório não encontrado')

    // Sempre regera o PDF para garantir o design mais recente
    const resultado = await calcularConciliacao(relatorio.empresa_id, relatorio.mes_ref)
    const pdfBuffer = await gerarPDFRelatorio(resultado, {
      razao_social: relatorio.empresa.razao_social,
      cnpj: relatorio.empresa.cnpj,
      regime_tributario: relatorio.empresa.regime_tributario,
    })

    const mes = new Date(relatorio.mes_ref).toISOString().slice(0, 7)
    const nome = relatorio.empresa.razao_social.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="thinqi_relatorio_${nome}_${mes}.pdf"`)
    res.send(pdfBuffer)
  } catch (err) {
    next(err)
  }
}

/** GET /api/relatorio-desconforto/export-zip?ids=a,b,c — Baixa vários PDFs em um ZIP */
export async function downloadZip(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const idsParam = (req.query['ids'] as string | undefined) ?? ''
    const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean)

    if (ids.length === 0) throw new AppError(400, 'Informe ao menos um id em ?ids=')
    if (ids.length > 100) throw new AppError(400, 'Máximo de 100 relatórios por ZIP')

    const relatorios = await prisma.relatorioDesconforto.findMany({
      where: { id: { in: ids } },
      include: { empresa: { select: { razao_social: true, cnpj: true, regime_tributario: true } } },
    })

    if (relatorios.length === 0) throw new AppError(404, 'Nenhum relatório encontrado')

    const stamp = new Date().toISOString().slice(0, 10)
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="thinqi_relatorios_${stamp}.zip"`)

    const archive = archiver('zip', { zlib: { level: 9 } })
    archive.on('error', err => next(err))
    archive.pipe(res)

    for (const rel of relatorios) {
      const resultado = await calcularConciliacao(rel.empresa_id, rel.mes_ref)
      const pdfBuffer = await gerarPDFRelatorio(resultado, {
        razao_social: rel.empresa.razao_social,
        cnpj: rel.empresa.cnpj,
        regime_tributario: rel.empresa.regime_tributario,
      })

      const mes = new Date(rel.mes_ref).toISOString().slice(0, 7)
      const cnpj = rel.empresa.cnpj.replace(/\D/g, '') || 'sem_cnpj'
      archive.append(pdfBuffer, { name: `${cnpj}_${mes}.pdf` })
    }

    await archive.finalize()
  } catch (err) {
    next(err)
  }
}
