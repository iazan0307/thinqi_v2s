import { Request, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import {
  normalizeCpf,
  isValidCpf,
  extractCpfParts,
  maskCpf,
} from '../utils/cpf'

export async function listSocios(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { empresaId } = req.params

    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new AppError(404, 'Empresa não encontrada')

    const socios = await prisma.socio.findMany({
      where: { empresa_id: empresaId },
      orderBy: { nome: 'asc' },
      select: {
        id: true,
        nome: true,
        cpf_mascara: true,      // LGPD: nunca retornar cpf_hash, prefixo ou sufixo
        percentual_societario: true,
        limite_isencao: true,
        tem_prolabore: true,
        valor_prolabore_mensal: true,
        ativo: true,
        created_at: true,
      },
    })

    res.json(socios)
  } catch (err) {
    next(err)
  }
}

export async function createSocio(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { empresaId } = req.params
    const { nome, cpf, percentual_societario, limite_isencao, tem_prolabore, valor_prolabore_mensal } = req.body as {
      nome: string
      cpf: string
      percentual_societario: number
      limite_isencao?: number
      tem_prolabore?: boolean
      valor_prolabore_mensal?: number
    }

    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new AppError(404, 'Empresa não encontrada')

    const cpfNorm = normalizeCpf(cpf)
    if (!isValidCpf(cpfNorm)) throw new AppError(422, 'CPF inválido')

    // Verifica duplicidade por hash (sem armazenar em claro)
    const cpfHash = await bcrypt.hash(cpfNorm, 10)

    // Busca por prefixo+sufixo para checar duplicata na mesma empresa
    const { prefixo, sufixo } = extractCpfParts(cpfNorm)
    const duplicata = await prisma.socio.findFirst({
      where: { empresa_id: empresaId, cpf_prefixo: prefixo, cpf_sufixo: sufixo },
    })
    if (duplicata) throw new AppError(409, 'Sócio com este CPF já cadastrado nesta empresa')

    const socio = await prisma.socio.create({
      data: {
        empresa_id: empresaId,
        nome: nome.trim(),
        cpf_hash: cpfHash,
        cpf_prefixo: prefixo,
        cpf_sufixo: sufixo,
        cpf_mascara: maskCpf(cpfNorm),
        percentual_societario,
        ...(limite_isencao !== undefined && { limite_isencao }),
        ...(tem_prolabore !== undefined && { tem_prolabore }),
        ...(valor_prolabore_mensal !== undefined && { valor_prolabore_mensal }),
      },
      select: {
        id: true,
        nome: true,
        cpf_mascara: true,
        percentual_societario: true,
        limite_isencao: true,
        tem_prolabore: true,
        valor_prolabore_mensal: true,
        ativo: true,
        created_at: true,
      },
    })

    res.status(201).json(socio)
  } catch (err) {
    next(err)
  }
}

export async function deleteSocio(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params

    const socio = await prisma.socio.findUnique({ where: { id } })
    if (!socio) throw new AppError(404, 'Sócio não encontrado')

    await prisma.socio.delete({ where: { id } })
    res.json({ deletado: true })
  } catch (err) {
    next(err)
  }
}

export async function updateSocio(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params
    const { nome, percentual_societario, limite_isencao, tem_prolabore, valor_prolabore_mensal, ativo } = req.body as {
      nome?: string
      percentual_societario?: number
      limite_isencao?: number
      tem_prolabore?: boolean
      valor_prolabore_mensal?: number
      ativo?: boolean
    }

    const socio = await prisma.socio.findUnique({ where: { id } })
    if (!socio) throw new AppError(404, 'Sócio não encontrado')

    const updated = await prisma.socio.update({
      where: { id },
      data: {
        ...(nome && { nome: nome.trim() }),
        ...(percentual_societario !== undefined && { percentual_societario }),
        ...(limite_isencao !== undefined && { limite_isencao }),
        ...(tem_prolabore !== undefined && { tem_prolabore }),
        ...(valor_prolabore_mensal !== undefined && { valor_prolabore_mensal }),
        ...(ativo !== undefined && { ativo }),
      },
      select: {
        id: true,
        nome: true,
        cpf_mascara: true,
        percentual_societario: true,
        limite_isencao: true,
        tem_prolabore: true,
        valor_prolabore_mensal: true,
        ativo: true,
        updated_at: true,
      },
    })

    res.json(updated)
  } catch (err) {
    next(err)
  }
}
