import { Router } from 'express'
import { z } from 'zod'
import { login, refresh, logout, me, forgotPassword } from '../controllers/authController'
import { authenticate } from '../middleware/auth'
import { validate } from '../middleware/validate'

const router = Router()

const loginSchema = z.object({
  email: z.string().email('E-mail inválido'),
  senha: z.string().min(6, 'Senha deve ter ao menos 6 caracteres'),
})

const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token obrigatório'),
})

const forgotPasswordSchema = z.object({
  email: z.string().email('E-mail inválido'),
})

router.post('/login', validate(loginSchema), login)
router.post('/refresh', validate(refreshSchema), refresh)
router.post('/logout', authenticate, logout)
router.get('/me', authenticate, me)
router.post('/forgot-password', validate(forgotPasswordSchema), forgotPassword)

export { router as authRoutes }
