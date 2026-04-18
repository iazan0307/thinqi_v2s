import jwt from 'jsonwebtoken'
import { Role } from '@prisma/client'

interface TokenPayload {
  id: string
  email: string
  role: Role
  empresa_id: string | null
}

function getSecret(key: 'JWT_SECRET' | 'JWT_REFRESH_SECRET'): string {
  const secret = process.env[key]
  if (!secret) throw new Error(`Variável de ambiente ${key} não definida`)
  return secret
}

export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, getSecret('JWT_SECRET'), {
    expiresIn: (process.env.JWT_EXPIRES_IN ?? '15m') as jwt.SignOptions['expiresIn'],
  })
}

export function signRefreshToken(payload: Pick<TokenPayload, 'id'>): string {
  return jwt.sign(payload, getSecret('JWT_REFRESH_SECRET'), {
    expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN ?? '7d') as jwt.SignOptions['expiresIn'],
  })
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, getSecret('JWT_SECRET')) as TokenPayload
}

export function verifyRefreshToken(token: string): Pick<TokenPayload, 'id'> {
  return jwt.verify(token, getSecret('JWT_REFRESH_SECRET')) as Pick<TokenPayload, 'id'>
}
