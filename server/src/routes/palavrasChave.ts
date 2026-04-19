import { Router } from 'express'
import { z } from 'zod'
import {
  listPalavrasChave,
  createPalavraChave,
  updatePalavraChave,
  deletePalavraChave,
  reprocessarPalavrasChave,
} from '../controllers/palavrasChaveController'
import { authenticate, requireRole } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { Role } from '@prisma/client'

const router = Router()
router.use(authenticate)

const createSchema = z.object({
  palavra: z.string().min(3).max(120),
  descricao: z.string().max(500).optional(),
  ativo: z.boolean().optional(),
})

const updateSchema = z.object({
  palavra: z.string().min(3).max(120).optional(),
  descricao: z.string().max(500).optional(),
  ativo: z.boolean().optional(),
})

router.get('/', requireRole(Role.ADMIN, Role.CONTADOR), listPalavrasChave)
router.post('/', requireRole(Role.ADMIN, Role.CONTADOR), validate(createSchema), createPalavraChave)
router.post('/reprocessar', requireRole(Role.ADMIN, Role.CONTADOR), reprocessarPalavrasChave)
router.put('/:id', requireRole(Role.ADMIN, Role.CONTADOR), validate(updateSchema), updatePalavraChave)
router.delete('/:id', requireRole(Role.ADMIN), deletePalavraChave)

export { router as palavrasChaveRoutes }
