import { Request, Response, NextFunction } from 'express'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { Role } from '@prisma/client'
import { audit } from '../utils/audit'

/** Normaliza CNPJ para armazenamento: remove pontuação */
function normalizeCnpj(cnpj: string): string {
  return cnpj.replace(/\D/g, '')
}

/** Valida CNPJ pelo algoritmo oficial */
function isValidCnpj(cnpj: string): boolean {
  const digits = normalizeCnpj(cnpj)
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return false

  const calcDigit = (base: string, weights: number[]) =>
    weights.reduce((sum, w, i) => sum + Number(base[i]) * w, 0)

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const rem1 = calcDigit(digits, w1) % 11
  const d1 = rem1 < 2 ? 0 : 11 - rem1

  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const rem2 = calcDigit(digits, w2) % 11
  const d2 = rem2 < 2 ? 0 : 11 - rem2

  return Number(digits[12]) === d1 && Number(digits[13]) === d2
}

/** Formata CNPJ para exibição: "12345678000199" → "12.345.678/0001-99" */
function formatCnpj(cnpj: string): string {
  const d = normalizeCnpj(cnpj)
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

export async function listEmpresas(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = Math.max(1, Number(req.query['page']) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query['limit']) || 20))
    const busca = String(req.query['busca'] ?? '')

    const where = busca
      ? {
          OR: [
            { razao_social: { contains: busca, mode: 'insensitive' as const } },
            { cnpj: { contains: normalizeCnpj(busca) } },
          ],
        }
      : undefined

    const [total, empresas] = await Promise.all([
      prisma.empresa.count({ where }),
      prisma.empresa.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { razao_social: 'asc' },
        include: {
          _count: {
            select: {
              socios: true,
              usuarios: { where: { role: Role.CLIENTE } },
            },
          },
        },
      }),
    ])

    res.json({
      data: empresas.map((e) => ({ ...e, cnpj: formatCnpj(e.cnpj) })),
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    next(err)
  }
}

export async function getEmpresa(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const empresa = await prisma.empresa.findUnique({
      where: { id: req.params['id'] },
      include: { socios: { where: { ativo: true }, orderBy: { nome: 'asc' } } },
    })

    if (!empresa) throw new AppError(404, 'Empresa não encontrada')

    res.json({ ...empresa, cnpj: formatCnpj(empresa.cnpj) })
  } catch (err) {
    next(err)
  }
}

export async function createEmpresa(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { razao_social, cnpj, regime_tributario, saldo_inicial } = req.body as {
      razao_social: string
      cnpj: string
      regime_tributario?: string
      saldo_inicial?: number
    }

    const cnpjNorm = normalizeCnpj(cnpj)
    if (!isValidCnpj(cnpjNorm)) {
      throw new AppError(422, 'CNPJ inválido')
    }

    const existe = await prisma.empresa.findUnique({ where: { cnpj: cnpjNorm } })
    if (existe) throw new AppError(409, 'CNPJ já cadastrado')

    const empresa = await prisma.empresa.create({
      data: {
        razao_social: razao_social.trim(),
        cnpj: cnpjNorm,
        ...(regime_tributario && { regime_tributario: regime_tributario as never }),
        ...(saldo_inicial !== undefined && { saldo_inicial }),
      },
    })

    await audit({
      acao: 'CREATE_EMPRESA',
      entidade: 'Empresa',
      entidade_id: empresa.id,
      empresa_id: empresa.id,
      detalhes: {
        razao_social: empresa.razao_social,
        cnpj: empresa.cnpj,
        regime_tributario: empresa.regime_tributario,
      },
      req,
    })

    res.status(201).json({ ...empresa, cnpj: formatCnpj(empresa.cnpj) })
  } catch (err) {
    next(err)
  }
}

export async function deleteEmpresa(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params

    const empresa = await prisma.empresa.findUnique({ where: { id } })
    if (!empresa) throw new AppError(404, 'Empresa não encontrada')

    // Deleta todos os dados vinculados em ordem correta (sem cascade no schema)
    await prisma.$transaction([
      prisma.relatorioDesconforto.deleteMany({ where: { empresa_id: id } }),
      prisma.retiradaSocio.deleteMany({ where: { empresa_id: id } }),
      prisma.transacaoBancaria.deleteMany({ where: { empresa_id: id } }),
      prisma.transacaoCartao.deleteMany({ where: { empresa_id: id } }),
      prisma.faturamento.deleteMany({ where: { empresa_id: id } }),
      prisma.arquivoUpload.deleteMany({ where: { empresa_id: id } }),
      prisma.usuario.deleteMany({ where: { empresa_id: id, role: Role.CLIENTE } }),
      prisma.socio.deleteMany({ where: { empresa_id: id } }),
      prisma.empresa.delete({ where: { id } }),
    ])

    await audit({
      acao: 'DELETE_EMPRESA',
      entidade: 'Empresa',
      entidade_id: id,
      detalhes: {
        razao_social: empresa.razao_social,
        cnpj: empresa.cnpj,
      },
      req,
    })

    res.json({ deletado: true })
  } catch (err) {
    next(err)
  }
}

export async function updateEmpresa(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params
    const { razao_social, regime_tributario, ativo, saldo_inicial, estimativa_historico_meses } = req.body as {
      razao_social?: string
      regime_tributario?: string
      ativo?: boolean
      saldo_inicial?: number
      estimativa_historico_meses?: number | null
    }

    const empresa = await prisma.empresa.findUnique({ where: { id } })
    if (!empresa) throw new AppError(404, 'Empresa não encontrada')

    const updated = await prisma.empresa.update({
      where: { id },
      data: {
        ...(razao_social && { razao_social: razao_social.trim() }),
        ...(regime_tributario && { regime_tributario: regime_tributario as never }),
        ...(ativo !== undefined && { ativo }),
        ...(saldo_inicial !== undefined && { saldo_inicial }),
        ...(estimativa_historico_meses !== undefined && { estimativa_historico_meses }),
      },
    })

    await audit({
      acao: 'UPDATE_EMPRESA',
      entidade: 'Empresa',
      entidade_id: id,
      empresa_id: id,
      detalhes: {
        antes: {
          razao_social: empresa.razao_social,
          regime_tributario: empresa.regime_tributario,
          ativo: empresa.ativo,
          saldo_inicial: empresa.saldo_inicial,
        },
        depois: {
          razao_social: updated.razao_social,
          regime_tributario: updated.regime_tributario,
          ativo: updated.ativo,
          saldo_inicial: updated.saldo_inicial,
        },
      },
      req,
    })

    res.json({ ...updated, cnpj: formatCnpj(updated.cnpj) })
  } catch (err) {
    next(err)
  }
}
