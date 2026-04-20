import { Router } from 'express'
import { z } from 'zod'
import { authenticate, requireRole } from '../middleware/auth'
import { validate } from '../middleware/validate'
import {
  listArquivos,
  deleteArquivo,
  listClientes,
  convidarCliente,
  toggleCliente,
  deletarCliente,
  liberarPeriodo,
  atualizarPerfilCliente,
} from '../controllers/adminClientesController'
import { Role } from '@prisma/client'

const router = Router()

router.use(authenticate, requireRole(Role.ADMIN, Role.CONTADOR))

const convidarSchema = z.object({
  nome: z.string().min(3, 'Nome deve ter ao menos 3 caracteres'),
  email: z.string().email('E-mail inválido'),
  empresa_id: z.string().min(1, 'empresa_id obrigatório'),
  perfil_cliente: z.enum(['SOCIO', 'ADMINISTRATIVO']).optional(),
})

const perfilSchema = z.object({
  perfil_cliente: z.enum(['SOCIO', 'ADMINISTRATIVO']),
})

const toggleSchema = z.object({
  ativo: z.boolean(),
})

router.get('/arquivos', listArquivos)
router.delete('/arquivos/:id', deleteArquivo)
router.get('/clientes', listClientes)
router.post('/clientes/convidar', validate(convidarSchema), convidarCliente)
router.put('/clientes/:id/ativo', validate(toggleSchema), toggleCliente)
router.put('/clientes/:id/perfil', validate(perfilSchema), atualizarPerfilCliente)
router.delete('/clientes/:id', deletarCliente)
router.put('/liberacao/:empresaId/:mes', liberarPeriodo)

export { router as adminClientesRoutes }
