import { Request, Response, NextFunction } from 'express'
import * as fs from 'fs/promises'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { TipoArquivo, StatusArquivo, Prisma } from '@prisma/client'
import { parseIAZAN, parseIAZANcsv } from '../services/parser/iazan'
import * as path from 'path'

/** Upload + processamento síncrono da planilha IAZAN */
export async function uploadFaturamento(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const file = req.file
    if (!file) throw new AppError(400, 'Arquivo não enviado')

    const { empresa_id, mes_ref } = req.body as { empresa_id?: string; mes_ref?: string }
    if (!empresa_id) throw new AppError(400, 'empresa_id obrigatório')
    if (!mes_ref) throw new AppError(400, 'mes_ref obrigatório (formato: YYYY-MM)')

    const empresa = await prisma.empresa.findUnique({ where: { id: empresa_id } })
    if (!empresa) throw new AppError(404, 'Empresa não encontrada')

    // Parseia mes_ref: aceita "YYYY-MM" ou "YYYY-MM-DD"
    const [year, month] = mes_ref.split('-').map(Number)
    if (!year || !month || month < 1 || month > 12) {
      throw new AppError(422, 'mes_ref inválido. Use formato YYYY-MM')
    }
    const mesRefDate = new Date(Date.UTC(year, month - 1, 1))

    const arquivo = await prisma.arquivoUpload.create({
      data: {
        empresa_id,
        tipo: TipoArquivo.PLANILHA,
        nome_original: file.originalname,
        nome_storage: file.filename,
        tamanho_bytes: file.size,
        status: StatusArquivo.PROCESSANDO,
        uploaded_by: req.user!.id,
      },
    })

    try {
      const ext = path.extname(file.originalname).toLowerCase()
      let resultados

      if (ext === '.xlsx' || ext === '.xls') {
        const buffer = await fs.readFile(file.path)
        resultados = await parseIAZAN(buffer, mesRefDate)
      } else if (ext === '.csv') {
        const content = await fs.readFile(file.path, 'utf-8')
        resultados = parseIAZANcsv(content, mesRefDate)
      } else {
        throw new AppError(422, 'Formato não suportado. Use XLSX ou CSV.')
      }

      // Upsert faturamento por mês
      for (const r of resultados) {
        await prisma.faturamento.upsert({
          where: {
            empresa_id_mes_ref: { empresa_id, mes_ref: r.mes_ref },
          },
          update: {
            valor_total_nf:      r.valor_total_nf,
            valor_liquido_total: r.valor_liquido_total,
            total_retencoes:     r.total_retencoes,
            qtd_notas:           r.qtd_notas,
            qtd_canceladas:      r.qtd_canceladas,
            cnpj_emitente:       r.cnpj_emitente || null,
            nome_emitente:       r.nome_emitente || null,
            furos_sequencia:     r.furos_sequencia.length > 0 ? (r.furos_sequencia as unknown as Prisma.InputJsonValue) : undefined,
            arquivo_id:          arquivo.id,
          },
          create: {
            empresa_id,
            arquivo_id:          arquivo.id,
            mes_ref:             r.mes_ref,
            valor_total_nf:      r.valor_total_nf,
            valor_liquido_total: r.valor_liquido_total,
            total_retencoes:     r.total_retencoes,
            qtd_notas:           r.qtd_notas,
            qtd_canceladas:      r.qtd_canceladas,
            cnpj_emitente:       r.cnpj_emitente || null,
            nome_emitente:       r.nome_emitente || null,
            furos_sequencia:     r.furos_sequencia.length > 0 ? (r.furos_sequencia as unknown as Prisma.InputJsonValue) : undefined,
          },
        })
      }

      await prisma.arquivoUpload.update({
        where: { id: arquivo.id },
        data: { status: StatusArquivo.CONFIRMADO, processado_at: new Date(), confirmado_at: new Date() },
      })

      res.status(201).json({
        arquivo_id:      arquivo.id,
        meses_importados: resultados.length,
        resultados: resultados.map(r => ({
          mes_ref:             r.mes_ref.toISOString().slice(0, 7),
          cnpj_emitente:       r.cnpj_emitente,
          nome_emitente:       r.nome_emitente,
          valor_total_nf:      r.valor_total_nf,
          valor_liquido_total: r.valor_liquido_total,
          total_retencoes:     r.total_retencoes,
          qtd_notas:           r.qtd_notas,
          qtd_canceladas:      r.qtd_canceladas,
          furos_sequencia:     r.furos_sequencia,
        })),
      })
    } catch (parseErr) {
      await prisma.arquivoUpload.update({
        where: { id: arquivo.id },
        data: {
          status: StatusArquivo.ERRO,
          mensagem_erro: parseErr instanceof Error ? parseErr.message : 'Erro ao processar planilha',
        },
      })
      throw parseErr
    }
  } catch (err) {
    next(err)
  }
}

/** Retorna faturamento de uma empresa em um mês */
export async function getFaturamento(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { empresaId, mes } = req.params

    const [year, month] = mes.split('-').map(Number)
    if (!year || !month) throw new AppError(422, 'Formato de mês inválido. Use YYYY-MM')

    const inicio = new Date(Date.UTC(year, month - 1, 1))
    const fim = new Date(Date.UTC(year, month, 0, 23, 59, 59))

    const faturamento = await prisma.faturamento.findFirst({
      where: { empresa_id: empresaId, mes_ref: { gte: inicio, lte: fim } },
    })

    if (!faturamento) {
      res.json({ faturamento: null })
      return
    }

    res.json({ faturamento })
  } catch (err) {
    next(err)
  }
}
