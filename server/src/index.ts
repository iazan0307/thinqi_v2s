import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { authRoutes } from './routes/auth'
import { empresasRoutes } from './routes/empresas'
import { sociosRoutes } from './routes/socios'
import { uploadRoutes } from './routes/upload'
import { retiradasRoutes } from './routes/retiradas'
import { faturamentoRoutes } from './routes/faturamento'
import { cartaoRoutes } from './routes/cartao'
import { conciliacaoRoutes } from './routes/conciliacao'
import { relatorioRoutes } from './routes/relatorio'
import { portalRoutes } from './routes/portal'
import { adminClientesRoutes } from './routes/adminClientes'
import { usuariosRoutes } from './routes/usuarios'
import { estimativaImpostoRoutes } from './routes/estimativaImposto'
import { errorHandler } from './middleware/errorHandler'
import { notFound } from './middleware/notFound'

const app = express()
const PORT = process.env.PORT ?? 3001

// ─── Middlewares globais ───────────────────────────────────────────────────────

// Aceita múltiplas origens separadas por vírgula em FRONTEND_URL
const allowedOrigins = (process.env.FRONTEND_URL ?? 'http://localhost:8080')
  .split(',')
  .map(o => o.trim())

app.use(cors({
  origin: (origin, cb) => {
    // Permite requests sem origin (ex: curl, Postman, Railway healthcheck)
    if (!origin) return cb(null, true)
    if (allowedOrigins.includes(origin)) return cb(null, true)
    // Retorna false (sem erro 500) — o cors middleware responde com 403 automaticamente
    cb(null, false)
  },
  credentials: true,
}))

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ─── Rotas da API ─────────────────────────────────────────────────────────────

app.use('/api/auth', authRoutes)
app.use('/api/empresas', empresasRoutes)
app.use('/api/socios', sociosRoutes)
app.use('/api/upload', uploadRoutes)
app.use('/api/retiradas', retiradasRoutes)
app.use('/api/faturamento', faturamentoRoutes)
app.use('/api/cartao', cartaoRoutes)
app.use('/api/conciliacao', conciliacaoRoutes)
app.use('/api/relatorio-desconforto', relatorioRoutes)
app.use('/api/portal', portalRoutes)
// Mais específica primeiro — Express casa por prefixo na ordem de registro,
// e o middleware de autenticação do mount /api/admin (adminClientesRoutes)
// consome requests a /api/admin/usuarios/* antes deles caírem pro router certo.
app.use('/api/admin/usuarios', usuariosRoutes)
app.use('/api/admin', adminClientesRoutes)
app.use('/api/estimativa-imposto', estimativaImpostoRoutes)

// ─── Error handling ───────────────────────────────────────────────────────────

app.use(notFound)
app.use(errorHandler)

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`🚀 ThinQi API rodando em http://localhost:${PORT}`)
  console.log(`   Ambiente: ${process.env.NODE_ENV ?? 'development'}`)
})

export default app
