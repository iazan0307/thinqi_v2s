import { Request, Response, NextFunction } from 'express'
import * as fs from 'fs/promises'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { TipoArquivo, StatusArquivo, Prisma } from '@prisma/client'
import { parseIAZAN, parseIAZANcsv, FaturamentoParseado } from '../services/parser/iazan'
import * as path from 'path'

function normalizeCnpj(cnpj: string): string {
  return cnpj.replace(/\D/g, '')
}

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
      let resultadosBrutos

      if (ext === '.xlsx' || ext === '.xls') {
        const buffer = await fs.readFile(file.path)
        resultadosBrutos = await parseIAZAN(buffer, mesRefDate)
      } else if (ext === '.csv') {
        const content = await fs.readFile(file.path, 'utf-8')
        resultadosBrutos = parseIAZANcsv(content, mesRefDate)
      } else {
        throw new AppError(422, 'Formato não suportado. Use XLSX ou CSV.')
      }

      // Validação por CNPJ: a planilha IAZAN pode conter notas de várias empresas.
      // Quando o admin seleciona uma empresa, importamos só as notas cujo CNPJ do
      // emitente bate com o CNPJ da empresa selecionada. Os demais são bloqueados.
      const cnpjEmpresa = empresa.cnpj.replace(/\D/g, '')
      const resultados = resultadosBrutos.filter(r =>
        (r.cnpj_emitente || '').replace(/\D/g, '') === cnpjEmpresa,
      )
      const bloqueados = resultadosBrutos
        .filter(r => (r.cnpj_emitente || '').replace(/\D/g, '') !== cnpjEmpresa)
        .map(r => ({
          cnpj_emitente: r.cnpj_emitente,
          nome_emitente: r.nome_emitente,
          mes_ref:       r.mes_ref.toISOString().slice(0, 7),
          qtd_notas:     r.qtd_notas,
          valor_total_nf: r.valor_total_nf,
          motivo:        `Nota da empresa ${r.cnpj_emitente || '(sem CNPJ)'} — ${r.nome_emitente || 'desconhecida'}. Não pode ser importada em ${empresa.cnpj} - ${empresa.razao_social}.`,
        }))

      if (resultados.length === 0 && bloqueados.length > 0) {
        const lista = bloqueados.map(b => `${b.cnpj_emitente || 'sem CNPJ'} (${b.nome_emitente || '?'})`).join('; ')
        throw new AppError(
          422,
          `Nenhuma nota da planilha pertence à empresa ${empresa.razao_social} (CNPJ ${empresa.cnpj}). ` +
          `CNPJ(s) encontrado(s): ${lista}. Arquivo ignorado.`,
        )
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
        bloqueados,
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

/**
 * Processa 1 planilha IAZAN em lote: parseia → roteia cada linha de faturamento
 * pelo CNPJ do emitente → upsert por (empresa, mes_ref).
 */
async function processarArquivoFaturamento(params: {
  file: Express.Multer.File
  uploaded_by: string
}): Promise<{
  arquivo_id: string
  meses_importados: number
  resultados: Array<{
    empresa_id: string
    empresa_razao: string
    cnpj_emitente: string
    mes_ref: string
    valor_total_nf: number
    qtd_notas: number
  }>
}> {
  const { file, uploaded_by } = params

  const ext = path.extname(file.originalname).toLowerCase()
  const fallback = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))

  let resultados: FaturamentoParseado[]
  try {
    if (ext === '.xlsx' || ext === '.xls') {
      const buffer = await fs.readFile(file.path)
      resultados = await parseIAZAN(buffer, fallback)
    } else if (ext === '.csv') {
      const content = await fs.readFile(file.path, 'utf-8')
      resultados = parseIAZANcsv(content, fallback)
    } else {
      throw new AppError(422, 'Formato não suportado. Use XLSX ou CSV.')
    }
  } catch (err) {
    if (err instanceof AppError) throw err
    const msg = err instanceof Error ? err.message : 'Erro ao processar planilha'
    throw new AppError(422, msg)
  }

  if (resultados.length === 0) {
    throw new AppError(422, 'Nenhum faturamento encontrado na planilha')
  }

  // Resolve empresa para cada resultado via CNPJ emitente
  const cnpjsDistintos = Array.from(
    new Set(resultados.map(r => normalizeCnpj(r.cnpj_emitente)).filter(Boolean)),
  )
  if (cnpjsDistintos.length === 0) {
    throw new AppError(422, 'Planilha não contém CNPJ do emitente — não é possível rotear automaticamente.')
  }

  const empresas = await prisma.empresa.findMany({
    where: { cnpj: { in: cnpjsDistintos } },
  })
  const empresaPorCnpj = new Map(empresas.map(e => [e.cnpj, e]))

  // Valida: todos os CNPJs devem estar cadastrados
  const naoCadastrados = cnpjsDistintos.filter(c => !empresaPorCnpj.has(c))
  if (naoCadastrados.length > 0) {
    throw new AppError(
      404,
      `CNPJ(s) não cadastrado(s): ${naoCadastrados.join(', ')} — cadastre a(s) empresa(s) antes de subir o arquivo.`,
    )
  }

  // Cria 1 ArquivoUpload por empresa afetada (mesmo arquivo físico referenciado)
  const arquivoPorEmpresa = new Map<string, string>()
  for (const empresa of empresas) {
    const arquivo = await prisma.arquivoUpload.create({
      data: {
        empresa_id: empresa.id,
        tipo: TipoArquivo.PLANILHA,
        nome_original: file.originalname,
        nome_storage: file.filename,
        tamanho_bytes: file.size,
        status: StatusArquivo.PROCESSANDO,
        uploaded_by,
      },
    })
    arquivoPorEmpresa.set(empresa.id, arquivo.id)
  }

  const resumo: Array<{
    empresa_id: string
    empresa_razao: string
    cnpj_emitente: string
    mes_ref: string
    valor_total_nf: number
    qtd_notas: number
  }> = []

  try {
    for (const r of resultados) {
      const cnpjNorm = normalizeCnpj(r.cnpj_emitente)
      const empresa = empresaPorCnpj.get(cnpjNorm)
      if (!empresa) continue
      const arquivo_id = arquivoPorEmpresa.get(empresa.id)!

      await prisma.faturamento.upsert({
        where: { empresa_id_mes_ref: { empresa_id: empresa.id, mes_ref: r.mes_ref } },
        update: {
          valor_total_nf:      r.valor_total_nf,
          valor_liquido_total: r.valor_liquido_total,
          total_retencoes:     r.total_retencoes,
          qtd_notas:           r.qtd_notas,
          qtd_canceladas:      r.qtd_canceladas,
          cnpj_emitente:       r.cnpj_emitente || null,
          nome_emitente:       r.nome_emitente || null,
          furos_sequencia:     r.furos_sequencia.length > 0 ? (r.furos_sequencia as unknown as Prisma.InputJsonValue) : undefined,
          arquivo_id,
        },
        create: {
          empresa_id:          empresa.id,
          arquivo_id,
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

      resumo.push({
        empresa_id:     empresa.id,
        empresa_razao:  empresa.razao_social,
        cnpj_emitente:  r.cnpj_emitente,
        mes_ref:        r.mes_ref.toISOString().slice(0, 7),
        valor_total_nf: r.valor_total_nf,
        qtd_notas:      r.qtd_notas,
      })
    }

    // Confirma todos os ArquivoUpload
    await prisma.arquivoUpload.updateMany({
      where: { id: { in: Array.from(arquivoPorEmpresa.values()) } },
      data: {
        status: StatusArquivo.CONFIRMADO,
        processado_at: new Date(),
        confirmado_at: new Date(),
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro ao salvar faturamento'
    await prisma.arquivoUpload.updateMany({
      where: { id: { in: Array.from(arquivoPorEmpresa.values()) } },
      data: { status: StatusArquivo.ERRO, mensagem_erro: msg },
    })
    throw new AppError(500, msg)
  }

  return {
    arquivo_id:       Array.from(arquivoPorEmpresa.values())[0] ?? '',
    meses_importados: resumo.length,
    resultados:       resumo,
  }
}

/** Upload em lote: múltiplos arquivos IAZAN, cada faturamento roteado por CNPJ + mês. */
export async function uploadFaturamentoLote(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const files = (req.files as Express.Multer.File[] | undefined) ?? []
    if (files.length === 0) throw new AppError(400, 'Nenhum arquivo enviado')

    const resultados = await Promise.all(
      files.map(async file => {
        try {
          const r = await processarArquivoFaturamento({ file, uploaded_by: req.user!.id })
          return {
            nome_original:    file.originalname,
            status:           'sucesso' as const,
            arquivo_id:       r.arquivo_id,
            meses_importados: r.meses_importados,
            resultados:       r.resultados,
            erro:             null,
          }
        } catch (e) {
          return {
            nome_original:    file.originalname,
            status:           'erro' as const,
            arquivo_id:       null,
            meses_importados: 0,
            resultados:       [],
            erro:             e instanceof Error ? e.message : 'Erro desconhecido',
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
