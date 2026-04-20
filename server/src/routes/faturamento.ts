import { Router } from 'express'
import multer from 'multer'
import * as path from 'path'
import * as fs from 'fs'
import { authenticate, requireRole } from '../middleware/auth'
import { uploadFaturamento, uploadFaturamentoLote, getFaturamento } from '../controllers/faturamentoController'
import { Role } from '@prisma/client'

const router = Router()

const uploadsDir = path.join(process.cwd(), 'uploads')
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) =>
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.originalname}`),
})

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.xlsx', '.xls', '.csv']
    const ext = path.extname(file.originalname).toLowerCase()
    if (allowed.includes(ext)) cb(null, true)
    else cb(new Error('Apenas arquivos XLSX e CSV são aceitos'))
  },
})

router.use(authenticate)

router.post('/upload', requireRole(Role.ADMIN, Role.CONTADOR), upload.single('arquivo'), uploadFaturamento)
router.post('/upload/lote', requireRole(Role.ADMIN, Role.CONTADOR), upload.array('arquivos', 50), uploadFaturamentoLote)
router.get('/:empresaId/:mes', getFaturamento)

export { router as faturamentoRoutes }
