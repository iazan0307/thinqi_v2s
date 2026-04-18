import { Router } from 'express'
import { z } from 'zod'
import { authenticate, requireRole } from '../middleware/auth'
import { validate } from '../middleware/validate'
import {
  gerarRelatorio,
  listRelatorios,
  getRelatorio,
  downloadPDF,
  downloadZip,
} from '../controllers/conciliacaoController'
import { enviarRelatorioEmail } from '../controllers/relatorioEnvioController'
import { Role } from '@prisma/client'

const router = Router()

router.use(authenticate)

const gerarSchema = z.object({
  empresa_id: z.string().min(1, 'empresa_id obrigatório'),
  mes_ref: z.string().regex(/^\d{4}-\d{2}$/, 'mes_ref deve estar no formato YYYY-MM'),
})

const listQuerySchema = z.object({
  empresa_id: z.string().optional(),
  status: z.enum(['OK', 'AVISO', 'ALERTA']).optional(),
  page: z.coerce.number().min(1).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
})

router.get('/', requireRole(Role.ADMIN, Role.CONTADOR), validate(listQuerySchema, 'query'), listRelatorios)
router.post('/', requireRole(Role.ADMIN, Role.CONTADOR), validate(gerarSchema), gerarRelatorio)
router.get('/export-zip', requireRole(Role.ADMIN, Role.CONTADOR), downloadZip)
router.get('/:id', getRelatorio)
router.get('/:id/pdf', downloadPDF)
router.post('/:id/enviar', requireRole(Role.ADMIN, Role.CONTADOR), enviarRelatorioEmail)

export { router as relatorioRoutes }
