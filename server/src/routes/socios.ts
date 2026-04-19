import { Router } from 'express'
import { z } from 'zod'
import { updateSocio, deleteSocio } from '../controllers/sociosController'
import { authenticate, requireRole } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { Role } from '@prisma/client'

const router = Router()

router.use(authenticate)

const updateSocioSchema = z.object({
  nome: z.string().min(3).max(200).optional(),
  percentual_societario: z.number().min(0.01).max(100).optional(),
  limite_isencao: z.number().min(0).optional(),
  tem_prolabore: z.boolean().optional(),
  valor_prolabore_mensal: z.number().min(0).optional(),
  ativo: z.boolean().optional(),
})

// PUT /api/socios/:id
router.put('/:id', requireRole(Role.ADMIN, Role.CONTADOR), validate(updateSocioSchema), updateSocio)

// DELETE /api/socios/:id
router.delete('/:id', requireRole(Role.ADMIN, Role.CONTADOR), deleteSocio)

export { router as sociosRoutes }
