import { Router } from 'express'
import multer from 'multer'
import * as path from 'path'
import * as fs from 'fs'
import { uploadArquivo, statusUpload, confirmarUpload } from '../controllers/uploadController'
import { authenticate, requireRole } from '../middleware/auth'
import { Role } from '@prisma/client'

const UPLOAD_DIR = path.join(process.cwd(), 'uploads')

// Garante que o diretório de uploads existe
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const ext = path.extname(file.originalname)
    cb(null, `${unique}${ext}`)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.ofx', '.csv', '.xlsx', '.xls']
    const ext = path.extname(file.originalname).toLowerCase()
    if (allowed.includes(ext)) {
      cb(null, true)
    } else {
      cb(new Error('Tipo de arquivo não permitido. Use: OFX, CSV, XLSX'))
    }
  },
})

const router = Router()
router.use(authenticate)

// POST /api/upload
router.post('/', requireRole(Role.ADMIN, Role.CONTADOR), upload.single('arquivo'), uploadArquivo)

// GET /api/upload/status/:id
router.get('/status/:id', statusUpload)

// POST /api/upload/:id/confirmar
router.post('/:id/confirmar', requireRole(Role.ADMIN, Role.CONTADOR), confirmarUpload)

export { router as uploadRoutes }
