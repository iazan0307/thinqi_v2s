/**
 * Módulos do produto: catálogo + habilitação por empresa.
 *
 * Os módulos são definidos no seed (auditoria_socios, conciliacao_fiscal,
 * portal_cliente). Cada empresa pode ter cada módulo habilitado/desabilitado
 * independentemente.
 */

import { Request, Response, NextFunction } from 'express'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'

/** GET /api/admin/modulos — lista o catálogo de módulos */
export async function listModulos(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const modulos = await prisma.modulo.findMany({
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    })
    res.json({ data: modulos })
  } catch (err) { next(err) }
}

/** GET /api/admin/empresas/:empresaId/modulos — módulos da empresa (com flag habilitado) */
export async function listModulosEmpresa(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { empresaId } = req.params
    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new AppError(404, 'Empresa não encontrada')

    const modulos = await prisma.modulo.findMany({
      where: { ativo: true },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
      include: {
        empresas: { where: { empresa_id: empresaId }, take: 1 },
      },
    })

    const data = modulos.map(m => ({
      id: m.id,
      codigo: m.codigo,
      nome: m.nome,
      descricao: m.descricao,
      // Default: módulo NÃO habilitado para empresa que ainda não opted-in
      habilitado: m.empresas[0]?.habilitado ?? false,
      observacao: m.empresas[0]?.observacao ?? null,
    }))

    res.json({ data })
  } catch (err) { next(err) }
}

/** PUT /api/admin/empresas/:empresaId/modulos/:moduloId — toggle de habilitação */
export async function toggleModuloEmpresa(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { empresaId, moduloId } = req.params
    const { habilitado, observacao } = req.body as { habilitado?: boolean; observacao?: string }
    if (typeof habilitado !== 'boolean') {
      throw new AppError(400, 'Campo "habilitado" (boolean) é obrigatório')
    }

    const [empresa, modulo] = await Promise.all([
      prisma.empresa.findUnique({ where: { id: empresaId } }),
      prisma.modulo.findUnique({ where: { id: moduloId } }),
    ])
    if (!empresa) throw new AppError(404, 'Empresa não encontrada')
    if (!modulo) throw new AppError(404, 'Módulo não encontrado')
    if (!modulo.ativo) throw new AppError(409, 'Módulo está inativo no catálogo')

    const link = await prisma.empresaModulo.upsert({
      where: { empresa_id_modulo_id: { empresa_id: empresaId, modulo_id: moduloId } },
      update: {
        habilitado,
        observacao: observacao ?? null,
        ...(habilitado ? { habilitado_em: new Date(), desabilitado_em: null } : { desabilitado_em: new Date() }),
      },
      create: {
        empresa_id: empresaId,
        modulo_id: moduloId,
        habilitado,
        observacao: observacao ?? null,
      },
    })

    res.json({
      empresa_id: empresaId,
      modulo_id: moduloId,
      codigo: modulo.codigo,
      habilitado: link.habilitado,
      observacao: link.observacao,
    })
  } catch (err) { next(err) }
}

/**
 * Helper de uso interno: confere se uma empresa tem o módulo habilitado.
 * Default permissivo: se a empresa nunca tomou ação no módulo, considera
 * habilitado (compatibilidade com bases já em produção sem a tabela).
 */
export async function empresaTemModulo(
  empresaId: string,
  codigoModulo: string,
): Promise<boolean> {
  const link = await prisma.empresaModulo.findFirst({
    where: { empresa_id: empresaId, modulo: { codigo: codigoModulo } },
    select: { habilitado: true },
  })
  return link?.habilitado ?? true
}
