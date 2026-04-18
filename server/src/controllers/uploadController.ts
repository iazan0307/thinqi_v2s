import { Request, Response, NextFunction } from 'express'
import * as fs from 'fs/promises'
import * as path from 'path'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { TipoArquivo, StatusArquivo } from '@prisma/client'
import { parseOFX } from '../services/parser/ofx'
import { parseCSV } from '../services/parser/csv'
import { matchTransacoes, consolidarRetiradas } from '../services/engine/cpfEngine'

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
