/**
 * Rotas de contas bancárias da empresa — cadastro via OFX (BANKID + ACCTID).
 * Montadas como subrota de /api/empresas/:empresaId/contas-bancarias.
 */

import { Router } from 'express'
import multer from 'multer'
import * as path from 'path'
import { authenticate, requireRole } from '../middleware/auth'
import {
  listContasBancarias,
  adicionarContaViaOFX,
  removerConta,
} from '../controllers/contasBancariasController'
import { Role } from '@prisma/client'

const router = Router({ mergeParams: true })

// OFX é pequeno (~poucas centenas de KB) — em memória é suficiente, e evita
// criar arquivo no disco que não vai ser persistido no fluxo de cadastro.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (ext === '.ofx') cb(null, true)
    else cb(new Error('Apenas arquivos OFX são aceitos para cadastro de conta bancária'))
  },
})

router.use(authenticate)

router.get('/', requireRole(Role.ADMIN, Role.CONTADOR), listContasBancarias)

router.post(
  '/from-ofx',
  requireRole(Role.ADMIN, Role.CONTADOR),
  upload.single('arquivo'),
  adicionarContaViaOFX,
)

router.delete('/:id', requireRole(Role.ADMIN, Role.CONTADOR), removerConta)

export { router as contasBancariasRoutes }
