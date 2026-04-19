import { Request, Response, NextFunction } from 'express'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { carregarPalavrasChaveCache, invalidarPalavrasChaveCache, isInvestimentoAutomatico } from '../utils/investimento'
import { consolidarRetiradas } from '../services/engine/cpfEngine'

export async function listPalavrasChave(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const palavras = await prisma.palavraChaveInvestimento.findMany({
      orderBy: [{ ativo: 'desc' }, { palavra: 'asc' }],
    })
    res.json(palavras)
  } catch (err) {
    next(err)
  }
}

export async function createPalavraChave(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { palavra, descricao, ativo } = req.body as {
      palavra: string
      descricao?: string
      ativo?: boolean
    }

    const palavraNorm = palavra.trim()
    if (palavraNorm.length < 3) throw new AppError(422, 'Palavra deve ter ao menos 3 caracteres')

    const dup = await prisma.palavraChaveInvestimento.findUnique({ where: { palavra: palavraNorm } })
    if (dup) throw new AppError(409, 'Palavra-chave já cadastrada')

    const created = await prisma.palavraChaveInvestimento.create({
      data: {
        palavra: palavraNorm,
        descricao: descricao?.trim() || null,
        ativo: ativo ?? true,
        created_by: req.user?.id ?? null,
      },
    })

    invalidarPalavrasChaveCache()
    res.status(201).json(created)
  } catch (err) {
    next(err)
  }
}

export async function updatePalavraChave(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params
    const { palavra, descricao, ativo } = req.body as {
      palavra?: string
      descricao?: string
      ativo?: boolean
    }

    const existente = await prisma.palavraChaveInvestimento.findUnique({ where: { id } })
    if (!existente) throw new AppError(404, 'Palavra-chave não encontrada')

    const updated = await prisma.palavraChaveInvestimento.update({
      where: { id },
      data: {
        ...(palavra !== undefined && { palavra: palavra.trim() }),
        ...(descricao !== undefined && { descricao: descricao.trim() || null }),
        ...(ativo !== undefined && { ativo }),
      },
    })

    invalidarPalavrasChaveCache()
    res.json(updated)
  } catch (err) {
    next(err)
  }
}

/**
 * Reaplica palavras-chave aos lançamentos já importados:
 *   1. Recarrega o cache (inclui palavras recém-cadastradas).
 *   2. Para todas as transações de SAÍDA vinculadas a sócio, verifica se a
 *      descrição agora bate com alguma palavra-chave de investimento.
 *   3. As que baterem são desvinculadas (socio_id, cpf_detectado, confianca,
 *      sinal_deteccao zerados).
 *   4. RetiradaSocio é recalculada para as empresas afetadas.
 */
export async function reprocessarPalavrasChave(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await carregarPalavrasChaveCache()

    const candidatas = await prisma.transacaoBancaria.findMany({
      where: { tipo: 'SAIDA', socio_id: { not: null } },
      select: { id: true, descricao: true, empresa_id: true },
    })

    const idsParaDesvincular: string[] = []
    const empresasAfetadas = new Set<string>()
    for (const t of candidatas) {
      if (isInvestimentoAutomatico(t.descricao)) {
        idsParaDesvincular.push(t.id)
        empresasAfetadas.add(t.empresa_id)
      }
    }

    if (idsParaDesvincular.length > 0) {
      await prisma.transacaoBancaria.updateMany({
        where: { id: { in: idsParaDesvincular } },
        data: {
          socio_id: null,
          cpf_detectado: null,
          confianca: null,
          sinal_deteccao: null,
        },
      })

      // Apaga RetiradaSocio das empresas afetadas e reconstrói a partir das
      // transações restantes — garante que sócios cujas únicas retiradas
      // viraram "investimento" não fiquem com registros órfãos.
      for (const empresaId of empresasAfetadas) {
        await prisma.retiradaSocio.deleteMany({ where: { empresa_id: empresaId } })
        await consolidarRetiradas(empresaId)
      }
    }

    res.json({
      transacoes_desvinculadas: idsParaDesvincular.length,
      empresas_recalculadas: empresasAfetadas.size,
    })
  } catch (err) {
    next(err)
  }
}

export async function deletePalavraChave(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params
    const existente = await prisma.palavraChaveInvestimento.findUnique({ where: { id } })
    if (!existente) throw new AppError(404, 'Palavra-chave não encontrada')

    await prisma.palavraChaveInvestimento.delete({ where: { id } })
    invalidarPalavrasChaveCache()
    res.json({ deletado: true })
  } catch (err) {
    next(err)
  }
}
