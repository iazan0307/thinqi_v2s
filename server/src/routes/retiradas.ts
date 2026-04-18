import { Router } from 'express'
import { z } from 'zod'
import { listRetiradas, exportRetiradas } from '../controllers/retiradasController'
import { authenticate } from '../middleware/auth'
import { validate } from '../middleware/validate'

const listQuerySchema = z.object({
  empresa_id: z.string().optional(),
  mes_ref: z.string().optional(),
  alerta_limite: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().min(1).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
})

const router = Router()
router.use(authenticate)

// GET /api/retiradas
router.get('/', validate(listQuerySchema, 'query'), listRetiradas)

// GET /api/retiradas/export/:fmt
router.get('/export/:fmt', exportRetiradas)

export { router as retiradasRoutes }
