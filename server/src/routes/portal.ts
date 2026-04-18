import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/auth'
import { validate } from '../middleware/validate'
import {
  getDashboard,
  getHistorico,
  getAlertas,
  getPerfil,
  alterarSenha,
  getUltimoMes,
} from '../controllers/portalController'

const router = Router()

router.use(authenticate)

const senhaSchema = z.object({
  senha_atual: z.string().min(1, 'Senha atual obrigatória'),
  nova_senha: z.string().min(6, 'Nova senha deve ter ao menos 6 caracteres'),
})

router.get('/ultimo-mes', getUltimoMes)
router.get('/dashboard/:mes', getDashboard)
router.get('/historico', getHistorico)
router.get('/alertas', getAlertas)
router.get('/perfil', getPerfil)
router.put('/perfil/senha', validate(senhaSchema), alterarSenha)

export { router as portalRoutes }
