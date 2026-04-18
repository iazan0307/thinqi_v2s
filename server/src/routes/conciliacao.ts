import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { getConciliacao } from '../controllers/conciliacaoController'

const router = Router()

router.use(authenticate)

// GET /api/conciliacao/:empresaId/:mes  (ex: /api/conciliacao/abc123/2025-03)
router.get('/:empresaId/:mes', getConciliacao)

export { router as conciliacaoRoutes }
