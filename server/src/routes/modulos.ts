import { Router } from 'express'
import { authenticate, requireRole } from '../middleware/auth'
import {
  listModulos,
  listModulosEmpresa,
  toggleModuloEmpresa,
} from '../controllers/modulosController'
import { Role } from '@prisma/client'

const router = Router()

router.use(authenticate)
router.use(requireRole(Role.ADMIN, Role.CONTADOR))

router.get('/modulos', listModulos)
router.get('/empresas/:empresaId/modulos', listModulosEmpresa)
router.put('/empresas/:empresaId/modulos/:moduloId', toggleModuloEmpresa)

export { router as modulosRoutes }
