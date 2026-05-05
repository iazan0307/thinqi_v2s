/**
 * Rota do upload em lote unificado.
 * Aceita múltiplos arquivos misturados; cada um é roteado pelo tipo detectado
 * e pelo CNPJ extraído do conteúdo (não do nome).
 */

import { Router } from 'express'
import multer from 'multer'
import * as path from 'path'
import * as fs from 'fs'
import { authenticate, requireRole } from '../middleware/auth'
import { uploadLote } from '../controllers/uploadLoteController'
import { Role } from '@prisma/client'

const router = Router()

const uploadsDir = path.join(process.cwd(), 'uploads')
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })

const MAX_FILES = Number(process.env.UPLOAD_LOTE_MAX_FILES ?? 50)
const MAX_SIZE_MB = Number(process.env.UPLOAD_LOTE_MAX_SIZE_MB ?? 20)

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) =>
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.originalname}`),
})

const ACEITOS = ['.ofx', '.csv', '.xlsx', '.xls', '.pdf', '.xml']

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (ACEITOS.includes(ext)) cb(null, true)
    else cb(new Error(`Extensão "${ext}" não aceita. Permitidos: ${ACEITOS.join(', ')}`))
  },
})

router.use(authenticate)

router.post(
  '/',
  requireRole(Role.ADMIN, Role.CONTADOR),
  upload.array('arquivos', MAX_FILES),
  uploadLote,
)

export { router as uploadLoteRoutes }
