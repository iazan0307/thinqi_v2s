import { Request, Response, NextFunction } from 'express'
import * as fs from 'fs/promises'
import * as path from 'path'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { TipoArquivo, StatusArquivo } from '@prisma/client'
import { parseOFX, extractCNPJfromOFX, extractOFXIdentificacao } from '../services/parser/ofx'
import { parseCSV } from '../services/parser/csv'
import { matchTransacoes, consolidarRetiradas } from '../services/engine/cpfEngine'
import { hashFile, findUploadDuplicado } from '../utils/hash'

/**
 * Detecta o tipo de arquivo de extrato pela extensão.
 * Lança AppError se a extensão não for suportada.
 */
export function tipoExtratoDe(originalName: string): TipoArquivo {
  const ext = path.extname(originalName).toLowerCase()
  if (ext === '.ofx') return TipoArquivo.OFX
  if (ext === '.csv') return TipoArquivo.CSV
  if (['.xlsx', '.xls'].includes(ext)) return TipoArquivo.PLANILHA
  throw new AppError(422, `Extensão não suportada para extrato: ${ext || '(sem extensão)'}`)
}

/**
 * Resolve a empresa dona de um arquivo OFX/CSV.
 *
 * Estratégia (em ordem de prioridade):
 *   1. `empresa_id_hint` explícito (vem do form do upload individual)
 *   2. OFX → BANKID + ACCTID cruzados com `ContaBancaria` cadastrada
 *   3. OFX → CNPJ no preâmbulo/comentário (fallback secundário; OFX brasileiros
 *      padrão NÃO trazem o CNPJ do titular nas tags do header — confirmado nos
 *      bancos Bradesco, Inter, Itaú; a única forma confiável é o cadastro prévio
 *      da conta via /api/empresas/:id/contas-bancarias/from-ofx)
 *
 * CSV genérico de extrato bancário não tem padrão de identificação confiável
 * — sempre depende de `empresa_id_hint`.
 */
async function resolverEmpresaExtrato(params: {
  file: Express.Multer.File
  tipo: TipoArquivo
  empresa_id_hint?: string
}): Promise<{ empresa_id: string; razao_social: string }> {
  const { file, tipo, empresa_id_hint } = params

  if (empresa_id_hint) {
    const empresa = await prisma.empresa.findUnique({ where: { id: empresa_id_hint } })
    if (!empresa) throw new AppError(404, 'Empresa não encontrada')
    if (!empresa.ativo) throw new AppError(422, `Empresa ${empresa.razao_social} está desativada.`)
    return { empresa_id: empresa.id, razao_social: empresa.razao_social }
  }

  if (tipo !== TipoArquivo.OFX) {
    throw new AppError(
      422,
      'Extrato CSV genérico exige seleção manual da empresa — não há padrão de identificação confiável.',
    )
  }

  const content = await fs.readFile(file.path, 'latin1')

  // Caminho primário: BANKID + ACCTID via ContaBancaria
  const ident = extractOFXIdentificacao(content)
  if (ident) {
    const conta = await prisma.contaBancaria.findUnique({
      where: { bank_id_acct_id: { bank_id: ident.bank_id, acct_id: ident.acct_id } },
      include: { empresa: true },
    })
    if (conta) {
      if (!conta.empresa.ativo) {
        throw new AppError(422, `Empresa ${conta.empresa.razao_social} está desativada.`)
      }
      return { empresa_id: conta.empresa.id, razao_social: conta.empresa.razao_social }
    }
    // Cai pro fallback de CNPJ (alguns OFX trazem CNPJ no preâmbulo/comentário)
  }

  // Fallback: CNPJ no conteúdo (formato não-padrão; raro mas existe)
  const cnpj = extractCNPJfromOFX(content)
  if (cnpj) {
    const empresa = await prisma.empresa.findUnique({ where: { cnpj } })
    if (empresa) {
      if (!empresa.ativo) throw new AppError(422, `Empresa ${empresa.razao_social} está desativada.`)
      return { empresa_id: empresa.id, razao_social: empresa.razao_social }
    }
  }

  // Mensagem de erro com a identificação extraída (ajuda o admin a saber qual
  // conta precisa cadastrar antes de tentar de novo).
  if (ident) {
    throw new AppError(
      404,
      `Conta ${ident.bank_name} (BANCO ${ident.bank_id}) / ACCT ${ident.acct_id_display} não está cadastrada em nenhuma empresa. ` +
      `Cadastre a conta no perfil da empresa em "Empresas & Sócios → Contas Bancárias" antes de subir o extrato.`,
    )
  }
  throw new AppError(
    422,
    'Não foi possível identificar o titular do arquivo OFX (BANKID/ACCTID ausentes). Importação manual necessária.',
  )
}

/**
 * Processa 1 extrato bancário (OFX/CSV) síncronamente, replicando o pipeline do
 * processarArquivo() abaixo mas sem fire-and-forget. Usado pelo upload em lote
 * unificado para reportar status real (sucesso/erro) na resposta.
 *
 * NÃO confirma o arquivo (status fica PROCESSADO) — a consolidação de retiradas
 * continua acontecendo no fluxo manual, igual ao upload individual.
 */
export async function processarExtratoSync(params: {
  file: Express.Multer.File
  empresa_id_hint?: string
  uploaded_by: string
}): Promise<{
  arquivo_id: string
  empresa_id: string
  empresa_razao: string
  transacoes_importadas: number
}> {
  const { file, empresa_id_hint, uploaded_by } = params

  const tipo = tipoExtratoDe(file.originalname)
  const { empresa_id, razao_social } = await resolverEmpresaExtrato({
    file, tipo, empresa_id_hint,
  })

  // Lê com latin1 — encoding comum em OFX/CSV de bancos brasileiros
  const content = await fs.readFile(file.path, 'latin1')

  let transacoes
  if (tipo === TipoArquivo.OFX) transacoes = parseOFX(content)
  else if (tipo === TipoArquivo.CSV) transacoes = parseCSV(content)
  else throw new AppError(422, 'Processamento automático disponível apenas para OFX e CSV')

  if (transacoes.length === 0) {
    throw new AppError(422, 'Nenhuma transação encontrada no arquivo')
  }

  const hash_sha256 = await hashFile(file.path)
  const dup = await findUploadDuplicado({ empresa_id, hash_sha256 })
  if (dup) {
    throw new AppError(
      409,
      `Este arquivo já foi importado anteriormente como "${dup.nome_original}" em ${dup.uploaded_at.toISOString().slice(0, 10)}. Reenvio bloqueado para evitar duplicatas.`,
    )
  }

  const arquivo = await prisma.arquivoUpload.create({
    data: {
      empresa_id,
      tipo,
      nome_original: file.originalname,
      nome_storage: file.filename,
      tamanho_bytes: file.size,
      hash_sha256,
      status: StatusArquivo.PROCESSANDO,
      uploaded_by,
    },
  })

  try {
    const matches = await matchTransacoes(transacoes, empresa_id)

    const created = await prisma.transacaoBancaria.createMany({
      data: matches.map(m => ({
        arquivo_id:       arquivo.id,
        empresa_id,
        data:             m.transacao.data,
        descricao:        m.transacao.descricao,
        nome_contraparte: m.transacao.nome_contraparte ?? null,
        valor:            m.transacao.valor,
        tipo:             m.transacao.tipo,
        cpf_detectado:    m.cpf_detectado,
        confianca:        m.confianca > 0 ? m.confianca : null,
        sinal_deteccao:   m.sinal !== 'none' ? m.sinal : null,
        socio_id:         m.socio_id,
      })),
      skipDuplicates: true,
    })

    await prisma.arquivoUpload.update({
      where: { id: arquivo.id },
      data: { status: StatusArquivo.PROCESSADO, processado_at: new Date() },
    })

    return {
      arquivo_id: arquivo.id,
      empresa_id,
      empresa_razao: razao_social,
      transacoes_importadas: created.count,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro ao processar extrato'
    await prisma.arquivoUpload.update({
      where: { id: arquivo.id },
      data: { status: StatusArquivo.ERRO, mensagem_erro: msg },
    })
    throw new AppError(500, msg)
  }
}

export async function uploadArquivo(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const file = req.file
    if (!file) throw new AppError(400, 'Arquivo não enviado')

    const { empresa_id } = req.body as { empresa_id?: string }
    if (!empresa_id) throw new AppError(400, 'empresa_id obrigatório')

    const empresa = await prisma.empresa.findUnique({ where: { id: empresa_id } })
    if (!empresa) throw new AppError(404, 'Empresa não encontrada')

    const ext = path.extname(file.originalname).toLowerCase()
    let tipo: TipoArquivo
    if (ext === '.ofx') tipo = TipoArquivo.OFX
    else if (ext === '.csv') tipo = TipoArquivo.CSV
    else if (['.xlsx', '.xls'].includes(ext)) tipo = TipoArquivo.PLANILHA
    else throw new AppError(422, 'Tipo de arquivo não suportado. Use OFX ou CSV.')

    const hash_sha256 = await hashFile(file.path)
    const dup = await findUploadDuplicado({ empresa_id, hash_sha256 })
    if (dup) {
      throw new AppError(
        409,
        `Este arquivo já foi importado anteriormente como "${dup.nome_original}" em ${dup.uploaded_at.toISOString().slice(0, 10)}. Reenvio bloqueado para evitar duplicatas.`,
      )
    }

    const arquivo = await prisma.arquivoUpload.create({
      data: {
        empresa_id,
        tipo,
        nome_original: file.originalname,
        nome_storage: file.filename,
        tamanho_bytes: file.size,
        hash_sha256,
        status: StatusArquivo.PENDENTE,
        uploaded_by: req.user!.id,
      },
    })

    // Processamento assíncrono — não bloqueia a resposta
    processarArquivo(arquivo.id, file.path, tipo, empresa_id).catch(err => {
      console.error(`[UPLOAD] Erro ao processar arquivo ${arquivo.id}:`, err)
    })

    res.status(201).json(arquivo)
  } catch (err) {
    next(err)
  }
}

async function processarArquivo(
  arquivoId: string,
  filePath: string,
  tipo: TipoArquivo,
  empresaId: string,
): Promise<void> {
  await prisma.arquivoUpload.update({
    where: { id: arquivoId },
    data: { status: StatusArquivo.PROCESSANDO },
  })

  try {
    // Lê com latin1 — encoding comum em OFX/CSV de bancos brasileiros
    const content = await fs.readFile(filePath, 'latin1')

    let transacoes
    if (tipo === TipoArquivo.OFX) {
      transacoes = parseOFX(content)
    } else if (tipo === TipoArquivo.CSV) {
      transacoes = parseCSV(content)
    } else {
      throw new Error('Processamento automático disponível apenas para OFX e CSV')
    }

    if (transacoes.length === 0) {
      throw new Error('Nenhuma transação encontrada no arquivo')
    }

    const matches = await matchTransacoes(transacoes, empresaId)

    await prisma.transacaoBancaria.createMany({
      data: matches.map(m => ({
        arquivo_id:      arquivoId,
        empresa_id:      empresaId,
        data:            m.transacao.data,
        descricao:       m.transacao.descricao,
        nome_contraparte: m.transacao.nome_contraparte ?? null,
        valor:           m.transacao.valor,
        tipo:            m.transacao.tipo,
        cpf_detectado:   m.cpf_detectado,
        confianca:       m.confianca > 0 ? m.confianca : null,
        sinal_deteccao:  m.sinal !== 'none' ? m.sinal : null,
        socio_id:        m.socio_id,
      })),
      skipDuplicates: true,
    })

    await prisma.arquivoUpload.update({
      where: { id: arquivoId },
      data: { status: StatusArquivo.PROCESSADO, processado_at: new Date() },
    })
  } catch (err) {
    await prisma.arquivoUpload.update({
      where: { id: arquivoId },
      data: {
        status: StatusArquivo.ERRO,
        mensagem_erro: err instanceof Error ? err.message : 'Erro desconhecido',
      },
    })
  }
}

export async function uploadArquivosLote(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const files = (req.files as Express.Multer.File[] | undefined) ?? []
    if (files.length === 0) throw new AppError(400, 'Nenhum arquivo enviado')

    const { empresa_id } = req.body as { empresa_id?: string }
    if (!empresa_id) throw new AppError(400, 'empresa_id obrigatório')

    const empresa = await prisma.empresa.findUnique({ where: { id: empresa_id } })
    if (!empresa) throw new AppError(404, 'Empresa não encontrada')

    const resultados: Array<{
      nome_original: string
      arquivo_id: string | null
      status: 'criado' | 'erro'
      erro: string | null
    }> = []

    for (const file of files) {
      try {
        const ext = path.extname(file.originalname).toLowerCase()
        let tipo: TipoArquivo
        if (ext === '.ofx') tipo = TipoArquivo.OFX
        else if (ext === '.csv') tipo = TipoArquivo.CSV
        else if (['.xlsx', '.xls'].includes(ext)) tipo = TipoArquivo.PLANILHA
        else throw new Error('Tipo de arquivo não suportado. Use OFX, CSV ou XLSX.')

        const arquivo = await prisma.arquivoUpload.create({
          data: {
            empresa_id,
            tipo,
            nome_original: file.originalname,
            nome_storage: file.filename,
            tamanho_bytes: file.size,
            status: StatusArquivo.PENDENTE,
            uploaded_by: req.user!.id,
          },
        })

        processarArquivo(arquivo.id, file.path, tipo, empresa_id).catch(err => {
          console.error(`[UPLOAD-LOTE] Erro ao processar arquivo ${arquivo.id}:`, err)
        })

        resultados.push({
          nome_original: file.originalname,
          arquivo_id: arquivo.id,
          status: 'criado',
          erro: null,
        })
      } catch (e) {
        resultados.push({
          nome_original: file.originalname,
          arquivo_id: null,
          status: 'erro',
          erro: e instanceof Error ? e.message : 'Erro desconhecido',
        })
      }
    }

    const total = resultados.length
    const sucesso = resultados.filter(r => r.status === 'criado').length
    res.status(201).json({
      total,
      sucesso,
      falha: total - sucesso,
      resultados,
    })
  } catch (err) {
    next(err)
  }
}

export async function statusUpload(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const arquivo = await prisma.arquivoUpload.findUnique({
      where: { id: req.params['id'] },
      select: {
        id: true,
        tipo: true,
        nome_original: true,
        tamanho_bytes: true,
        status: true,
        mensagem_erro: true,
        uploaded_at: true,
        processado_at: true,
        confirmado_at: true,
        empresa_id: true,
        _count: { select: { transacoes_bancarias: true } },
      },
    })

    if (!arquivo) throw new AppError(404, 'Arquivo não encontrado')

    res.json(arquivo)
  } catch (err) {
    next(err)
  }
}

export async function confirmarUpload(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const arquivo = await prisma.arquivoUpload.findUnique({
      where: { id: req.params['id'] },
    })

    if (!arquivo) throw new AppError(404, 'Arquivo não encontrado')

    if (arquivo.status !== StatusArquivo.PROCESSADO) {
      throw new AppError(422, `Arquivo no status "${arquivo.status}" não pode ser confirmado`)
    }

    await consolidarRetiradas(arquivo.empresa_id)

    const updated = await prisma.arquivoUpload.update({
      where: { id: req.params['id'] },
      data: { status: StatusArquivo.CONFIRMADO, confirmado_at: new Date() },
    })

    res.json(updated)
  } catch (err) {
    next(err)
  }
}
