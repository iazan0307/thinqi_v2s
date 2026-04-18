import { Request, Response, NextFunction } from 'express'
import { verifyAccessToken } from '../utils/jwt'
import { AppError } from './errorHandler'
import { Role } from '@prisma/client'

// Extende o tipo Request do Express para incluir o usuário autenticado
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string
        email: string
        role: Role
        empresa_id: string | null
      }
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization

  if (!authHeader?.startsWith('Bearer ')) {
    return next(new AppError(401, 'Token de autenticação ausente'))
  }

  const token = authHeader.slice(7)

  try {
    const payload = verifyAccessToken(token)
    req.user = payload
    next()
  } catch {
    next(new AppError(401, 'Token inválido ou expirado'))
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError(401, 'Não autenticado'))
    }
    if (!roles.includes(req.user.role)) {
      return next(new AppError(403, 'Permissão insuficiente'))
    }
    next()
  }
}

// Garante que o usuário CLIENTE só acessa dados da própria empresa
export function requireOwnEmpresa(req: Request, _res: Response, next: NextFunction): void {
  const { user } = req
  if (!user) return next(new AppError(401, 'Não autenticado'))

  // ADMIN e CONTADOR têm acesso livre
  if (user.role === Role.ADMIN || user.role === Role.CONTADOR) {
    return next()
  }

  const empresaId = req.params.empresaId ?? req.params.id
  if (user.empresa_id !== empresaId) {
    return next(new AppError(403, 'Acesso negado a esta empresa'))
  }

  next()
}
