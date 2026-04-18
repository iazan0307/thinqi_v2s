import { Router } from 'express'
import multer from 'multer'
import * as path from 'path'
import * as fs from 'fs'
import { authenticate, requireRole } from '../middleware/auth'
import {
  uploadEstimativa,
  getEstimativa,
  downloadEstimativa,
  deleteEstimativa,
} from '../controllers/estimativaImpostoController'
import { Role } from '@prisma/client'

const router = Router()

const uploadsDir = path.join(process.cwd(), 'uploads', 'estimativas')
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) =>
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.originalname}`),
})

const upload = multer({
  storage,
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
