import { Router } from 'express'
import { z } from 'zod'
import { authenticate, requireRole } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { Role } from '@prisma/client'
import {
  listUsuarios,
  criarUsuario,
  atualizarUsuario,
  toggleUsuario,
  resetarSenha,
} from '../controllers/usuariosController'

const router = Router()
router.use(authenticate, requireRole(Role.ADMIN))

const criarSchema = z.object({
  nome:  z.string().min(3, 'Nome deve ter ao menos 3 caracteres'),
  email: z.string().email('E-mail inválido'),
  role:  z.enum(['ADMIN', 'CONTADOR']),
})

const atualizarSchema = z.object({
  nome: z.string().min(3).optional(),
  role: z.enum(['ADMIN', 'CONTADOR']).optional(),
})

const toggleSchema = z.object({ ativo: z.boolean() })

router.get('/',                          listUsuarios)
router.post('/',  validate(criarSchema), criarUsuario)
router.put('/:id',  validate(atualizarSchema), atualizarUsuario)
router.put('/:id/ativo', validate(toggleSchema), toggleUsuario)
router.post('/:id/resetar-senha',        resetarSenha)

export { router as usuariosRoutes }
