import { Router } from 'express'
import multer from 'multer'
import * as path from 'path'
import { authenticate, requireRole } from '../middleware/auth'
import { uploadContracheque, uploadContrachequeLote } from '../controllers/contrachequeController'
import { Role } from '@prisma/client'

const router = Router()

// Em memória: o PDF é descartado após extração; CPF em claro nunca toca o disco.
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
  uploadContracheque,
)
router.post(
  '/upload/lote',
  requireRole(Role.ADMIN, Role.CONTADOR),
  upload.array('arquivos', 50),
  uploadContrachequeLote,
)

export { router as contrachequeRoutes }
