import { Router } from 'express'
import multer from 'multer'
import * as path from 'path'
import { authenticate, requireRole } from '../middleware/auth'
import {
  uploadEstimativa,
  getEstimativa,
  downloadEstimativa,
  deleteEstimativa,
} from '../controllers/estimativaImpostoController'
import { Role } from '@prisma/client'

const router = Router()

// Em memória: o PDF é enviado direto ao Supabase Storage, sem tocar disco local.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (ext === '.pdf') cb(null, true)
    else cb(new Error('Apenas arquivos PDF são aceitos'))
  },
})

router.use(authenticate)

router.post(
  '/upload',
  requireRole(Role.ADMIN, Role.CONTADOR),
  upload.single('arquivo'),
  uploadEstimativa,
)
router.get('/', getEstimativa)
router.get('/:id/pdf', downloadEstimativa)
router.delete('/:id', requireRole(Role.ADMIN, Role.CONTADOR), deleteEstimativa)

export { router as estimativaImpostoRoutes }
