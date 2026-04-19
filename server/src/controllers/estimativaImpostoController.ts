/**
 * Estimativa de Impostos — upload manual de PDF por empresa+mês.
 * Não há cálculo automático: o admin/contador envia o PDF gerado externamente
 * e o cliente visualiza/baixa no portal.
 *
 * PDFs ficam no Supabase Storage (bucket "estimativas"), pois o host pode ser
 * efêmero (Railway recria o disco em cada deploy).
 */

import { Request, Response, NextFunction } from 'express'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { Role } from '@prisma/client'
import { uploadPDF, downloadPDF, deletePDF } from '../utils/storage'

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

    // Substitui PDF anterior do mesmo mês, se existir.
    // Cada upload tem key única (timestamp), então precisamos remover
    // explicitamente o arquivo antigo do Storage antes de apagar o registro.
    const existente = await prisma.estimativaImpostoPDF.findUnique({
      where: { empresa_id_mes_ref: { empresa_id, mes_ref: mesRef } },
    })
    if (existente) {
      await deletePDF(existente.pdf_path)
      await prisma.estimativaImpostoPDF.delete({ where: { id: existente.id } })
    }

    await uploadPDF(key, file.buffer)

    const estimativa = await prisma.estimativaImpostoPDF.create({
      data: {
        empresa_id,
        mes_ref: mesRef,
        pdf_path: key, // agora é a chave do Storage, não um path de disco
        nome_original: file.originalname,
        tamanho_bytes: file.size,
        uploaded_by: req.user!.id,
      },
    })

    res.status(201).json({
      id: estimativa.id,
      empresa_id,
      mes_ref: mes_ref,
      nome_original: file.originalname,
      tamanho_bytes: file.size,
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

    const estimativa = await prisma.estimativaImpostoPDF.findUnique({
      where: { empresa_id_mes_ref: { empresa_id: empresaId, mes_ref: mesRef } },
      select: {
        id: true,
        mes_ref: true,
        nome_original: true,
        tamanho_bytes: true,
        uploaded_at: true,
      },
    })

    if (!estimativa) {
      res.status(404).json({ mensagem: 'Nenhuma estimativa cadastrada para este mês' })
      return
    }

    res.json(estimativa)
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
