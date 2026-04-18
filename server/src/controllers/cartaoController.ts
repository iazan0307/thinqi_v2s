import { Request, Response, NextFunction } from 'express'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { TipoArquivo, StatusArquivo } from '@prisma/client'
import { parseCartao } from '../services/parser/cartao'

/** Upload + processamento de extrato de operadora de cartão */
export async function uploadCartao(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const file = req.file
    if (!file) throw new AppError(400, 'Arquivo não enviado')

    const { empresa_id } = req.body as { empresa_id?: string }
    if (!empresa_id) throw new AppError(400, 'empresa_id obrigatório')

    const empresa = await prisma.empresa.findUnique({ where: { id: empresa_id } })
    if (!empresa) throw new AppError(404, 'Empresa não encontrada')

    const ext = file.originalname.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ''
    const tipoArquivo = ext === 'xlsx' || ext === 'xls'
      ? TipoArquivo.PLANILHA
      : TipoArquivo.CSV

    const arquivo = await prisma.arquivoUpload.create({
      data: {
        empresa_id,
        tipo: tipoArquivo,
        nome_original: file.originalname,
        nome_storage: file.filename,
        tamanho_bytes: file.size,
        status: StatusArquivo.PROCESSANDO,
        uploaded_by: req.user!.id,
      },
    })

    try {
      const transacoes = await parseCartao(file.path, file.originalname)

      if (transacoes.length === 0) {
        throw new AppError(422, 'Nenhuma transação de cartão encontrada no arquivo')
      }

      await prisma.transacaoCartao.createMany({
        data: transacoes.map(t => ({
          arquivo_id: arquivo.id,
          empresa_id,
          data: t.data,
          bandeira: t.bandeira,
          adquirente: t.adquirente,
          valor_bruto: t.valor_bruto,
          taxa: t.taxa,
          valor_liquido: t.valor_liquido,
        })),
        skipDuplicates: true,
      })

      await prisma.arquivoUpload.update({
        where: { id: arquivo.id },
        data: { status: StatusArquivo.CONFIRMADO, processado_at: new Date(), confirmado_at: new Date() },
      })

      res.status(201).json({
        arquivo_id: arquivo.id,
        adquirente: transacoes[0]?.adquirente ?? 'GENERICO',
        transacoes_importadas: transacoes.length,
        total_liquido: transacoes.reduce((s, t) => s + t.valor_liquido, 0),
      })
    } catch (parseErr) {
      await prisma.arquivoUpload.update({
        where: { id: arquivo.id },
        data: {
          status: StatusArquivo.ERRO,
          mensagem_erro: parseErr instanceof Error ? parseErr.message : 'Erro ao processar extrato',
        },
      })
      throw parseErr
    }
  } catch (err) {
    next(err)
  }
}

/** Retorna liquidações de cartão de uma empresa em um mês */
export async function getCartao(
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

    const transacoes = await prisma.transacaoCartao.findMany({
      where: { empresa_id: empresaId, data: { gte: inicio, lte: fim } },
      orderBy: { data: 'desc' },
    })

    const totalBruto = transacoes.reduce((s, t) => s + Number(t.valor_bruto), 0)
    const totalLiquido = transacoes.reduce((s, t) => s + Number(t.valor_liquido), 0)

    res.json({ data: transacoes, meta: { total: transacoes.length, total_bruto: totalBruto, total_liquido: totalLiquido } })
  } catch (err) {
    next(err)
  }
}
