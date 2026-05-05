import { Router } from 'express'
import { z } from 'zod'
import {
  listEmpresas,
  getEmpresa,
  createEmpresa,
  updateEmpresa,
  deleteEmpresa,
} from '../controllers/empresasController'
import { listSocios, createSocio } from '../controllers/sociosController'
import { contasBancariasRoutes } from './contasBancarias'
import { authenticate, requireRole, requireOwnEmpresa } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { Role, RegimeTributario } from '@prisma/client'

const router = Router()

// Todas as rotas de empresas requerem autenticação
router.use(authenticate)

const createEmpresaSchema = z.object({
  razao_social: z.string().min(3, 'Razão social deve ter ao menos 3 caracteres').max(200),
  cnpj: z.string().min(14, 'CNPJ inválido').max(18),
  regime_tributario: z.nativeEnum(RegimeTributario).optional(),
})

const updateEmpresaSchema = z.object({
  razao_social: z.string().min(3).max(200).optional(),
  regime_tributario: z.nativeEnum(RegimeTributario).optional(),
  ativo: z.boolean().optional(),
  saldo_inicial: z.number().optional(),
  // null = todos os meses; 1 = apenas o último; N = últimos N meses
  estimativa_historico_meses: z.number().int().positive().nullable().optional(),
})

const createSocioSchema = z.object({
  nome: z.string().min(3, 'Nome deve ter ao menos 3 caracteres').max(200),
  cpf: z.string().min(11, 'CPF inválido').max(14),
  percentual_societario: z.number().min(0.01).max(100),
  limite_isencao: z.number().min(0).optional(),
  tem_prolabore: z.boolean().optional(),
  valor_prolabore_mensal: z.number().min(0).optional(),
})

const listEmpresasQuerySchema = z.object({
  page: z.coerce.number().min(1).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  busca: z.string().optional(),
})

// GET  /api/empresas
router.get(
  '/',
  requireRole(Role.ADMIN, Role.CONTADOR),
  validate(listEmpresasQuerySchema, 'query'),
  listEmpresas,
)

// POST /api/empresas
router.post(
  '/',
  requireRole(Role.ADMIN, Role.CONTADOR),
  validate(createEmpresaSchema),
  createEmpresa,
)

// GET  /api/empresas/:id
router.get('/:id', requireOwnEmpresa, getEmpresa)

// PUT  /api/empresas/:id
router.put(
  '/:id',
  requireRole(Role.ADMIN, Role.CONTADOR),
  validate(updateEmpresaSchema),
  updateEmpresa,
)

// DELETE /api/empresas/:id — apenas ADMIN (operação destrutiva e irreversível)
router.delete('/:id', requireRole(Role.ADMIN), deleteEmpresa)

// GET  /api/empresas/:empresaId/socios
router.get('/:empresaId/socios', requireOwnEmpresa, listSocios)

// POST /api/empresas/:empresaId/socios
router.post(
  '/:empresaId/socios',
  requireRole(Role.ADMIN, Role.CONTADOR),
  validate(createSocioSchema),
  createSocio,
)

// /api/empresas/:empresaId/contas-bancarias/* — cadastro/listagem/remoção via OFX
router.use('/:empresaId/contas-bancarias', contasBancariasRoutes)

export { router as empresasRoutes }
