import { Request, Response, NextFunction } from 'express'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { TipoArquivo, StatusArquivo } from '@prisma/client'
import { parseCartao, CartaoParseResult, TransacaoCartaoParseada } from '../services/parser/cartao'

function tipoArquivoDe(originalName: string): TipoArquivo {
  const ext = originalName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ''
  return ext === 'xlsx' || ext === 'xls' ? TipoArquivo.PLANILHA : TipoArquivo.CSV
}

/**
 * Processa 1 arquivo de cartão: parse → roteia para empresa (via empresa_id explícito
 * ou CNPJ detectado no arquivo) → persiste arquivo + transações.
 * Lança AppError com status apropriado em qualquer falha prevista.
 */
async function processarArquivoCartao(params: {
  file: Express.Multer.File
  empresa_id_hint?: string
  uploaded_by: string
}): Promise<{
  arquivo_id: string
  empresa_id: string
  empresa_razao: string
  adquirente: string
  transacoes_importadas: number
  total_liquido: number
}> {
  const { file, empresa_id_hint, uploaded_by } = params

  let parsed: CartaoParseResult
  try {
    parsed = await parseCartao(file.path, file.originalname)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro ao processar extrato'
    throw new AppError(422, msg)
  }

  const { cnpj_detectado, transacoes } = parsed
  if (transacoes.length === 0) {
    throw new AppError(422, 'Nenhuma transação de cartão encontrada no arquivo')
  }

  // Resolve empresa: hint explícito > CNPJ detectado
  let empresa
  if (empresa_id_hint) {
    empresa = await prisma.empresa.findUnique({ where: { id: empresa_id_hint } })
    if (!empresa) throw new AppError(404, 'Empresa não encontrada')
  } else if (cnpj_detectado) {
    empresa = await prisma.empresa.findUnique({ where: { cnpj: cnpj_detectado } })
    if (!empresa) {
      throw new AppError(
        404,
        `CNPJ ${cnpj_detectado} do extrato não está cadastrado — cadastre a empresa antes de subir o arquivo.`,
      )
    }
  } else {
    throw new AppError(
      422,
      'Não foi possível identificar a empresa: selecione uma ou envie um arquivo que contenha o CNPJ.',
    )
  }

  const arquivo = await prisma.arquivoUpload.create({
    data: {
      empresa_id: empresa.id,
      tipo: tipoArquivoDe(file.originalname),
      nome_original: file.originalname,
      nome_storage: file.filename,
      tamanho_bytes: file.size,
      status: StatusArquivo.PROCESSANDO,
      uploaded_by,
    },
  })

  try {
    await prisma.transacaoCartao.createMany({
      data: transacoes.map((t: TransacaoCartaoParseada) => ({
        arquivo_id: arquivo.id,
        empresa_id: empresa.id,
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
      data: {
        status: StatusArquivo.CONFIRMADO,
        processado_at: new Date(),
        confirmado_at: new Date(),
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro ao salvar transações'
    await prisma.arquivoUpload.update({
      where: { id: arquivo.id },
      data: { status: StatusArquivo.ERRO, mensagem_erro: msg },
    })
    throw new AppError(500, msg)
  }

  return {
    arquivo_id: arquivo.id,
    empresa_id: empresa.id,
    empresa_razao: empresa.razao_social,
    adquirente: transacoes[0].adquirente,
    transacoes_importadas: transacoes.length,
    total_liquido: transacoes.reduce((s, t) => s + t.valor_liquido, 0),
  }
}

/** Upload + processamento de 1 extrato de cartão (empresa_id opcional: auto-detecta por CNPJ). */
export async function uploadCartao(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const file = req.file
    if (!file) throw new AppError(400, 'Arquivo não enviado')

    const { empresa_id } = req.body as { empresa_id?: string }

    const resultado = await processarArquivoCartao({
      file,
      empresa_id_hint: empresa_id || undefined,
      uploaded_by: req.user!.id,
    })

    res.status(201).json(resultado)
  } catch (err) {
    next(err)
  }
}

/** Upload em lote: múltiplos arquivos, cada um roteado para empresa via CNPJ do extrato. */
export async function uploadCartaoLote(
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
          const r = await processarArquivoCartao({
            file,
            empresa_id_hint: empresa_id || undefined,
            uploaded_by: req.user!.id,
          })
          return {
            nome_original: file.originalname,
            status: 'sucesso' as const,
            arquivo_id: r.arquivo_id,
            empresa_id: r.empresa_id,
            empresa_razao: r.empresa_razao,
            adquirente: r.adquirente,
            transacoes_importadas: r.transacoes_importadas,
            total_liquido: r.total_liquido,
            erro: null,
          }
        } catch (e) {
          return {
            nome_original: file.originalname,
            status: 'erro' as const,
            arquivo_id: null,
            empresa_id: null,
            empresa_razao: null,
            adquirente: null,
            transacoes_importadas: 0,
            total_liquido: 0,
            erro: e instanceof Error ? e.message : 'Erro desconhecido',
          }
        }
      }),
    )

    const sucesso = resultados.filter(r => r.status === 'sucesso').length
    res.status(201).json({
      total: resultados.length,
      sucesso,
      falha: resultados.length - sucesso,
      resultados,
    })
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
