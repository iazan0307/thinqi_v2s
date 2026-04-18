import { Request, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { prisma } from '../utils/prisma'
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt'
import { AppError } from '../middleware/errorHandler'
import { enviarEmail } from '../services/email/mailer'

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, senha } = req.body as { email: string; senha: string }

    const usuario = await prisma.usuario.findUnique({ where: { email } })

    if (!usuario || !(await bcrypt.compare(senha, usuario.senha_hash))) {
      throw new AppError(401, 'E-mail ou senha inválidos')
    }

    if (!usuario.ativo) {
      throw new AppError(403, 'Usuário inativo. Contate o suporte.')
    }

    const payload = {
      id: usuario.id,
      email: usuario.email,
      role: usuario.role,
      empresa_id: usuario.empresa_id,
    }

    const accessToken = signAccessToken(payload)
    const refreshToken = signRefreshToken({ id: usuario.id })
    const refreshHash = await bcrypt.hash(refreshToken, 10)

    await prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        refresh_token_hash: refreshHash,
        ultimo_login: new Date(),
      },
    })

    res.json({
      accessToken,
      refreshToken,
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        role: usuario.role,
        empresa_id: usuario.empresa_id,
        perfil_cliente: usuario.perfil_cliente,
      },
    })
  } catch (err) {
    next(err)
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { refreshToken } = req.body as { refreshToken: string }

    if (!refreshToken) {
      throw new AppError(400, 'Refresh token ausente')
    }

    let payload: { id: string }
    try {
      payload = verifyRefreshToken(refreshToken)
    } catch {
      throw new AppError(401, 'Refresh token inválido ou expirado')
    }

    const usuario = await prisma.usuario.findUnique({ where: { id: payload.id } })

    if (!usuario?.refresh_token_hash) {
      throw new AppError(401, 'Sessão expirada. Faça login novamente.')
    }

    const tokenValido = await bcrypt.compare(refreshToken, usuario.refresh_token_hash)
    if (!tokenValido) {
      // Possível reutilização de token — invalida a sessão por segurança
      await prisma.usuario.update({
        where: { id: usuario.id },
        data: { refresh_token_hash: null },
      })
      throw new AppError(401, 'Token de sessão comprometido. Faça login novamente.')
    }

    if (!usuario.ativo) {
      throw new AppError(403, 'Usuário inativo')
    }

    const newAccessToken = signAccessToken({
      id: usuario.id,
      email: usuario.email,
      role: usuario.role,
      empresa_id: usuario.empresa_id,
    })

    const newRefreshToken = signRefreshToken({ id: usuario.id })
    const newRefreshHash = await bcrypt.hash(newRefreshToken, 10)

    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { refresh_token_hash: newRefreshHash },
    })

    res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken })
  } catch (err) {
    next(err)
  }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.id
    if (userId) {
      await prisma.usuario.update({
        where: { id: userId },
        data: { refresh_token_hash: null },
      })
    }
    res.status(204).send()
  } catch (err) {
    next(err)
  }
}

export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        nome: true,
        email: true,
        role: true,
        empresa_id: true,
        perfil_cliente: true,
        ultimo_login: true,
        empresa: { select: { razao_social: true, cnpj: true } },
      },
    })

    if (!usuario) throw new AppError(404, 'Usuário não encontrado')

    res.json(usuario)
  } catch (err) {
    next(err)
  }
}

export async function forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email } = req.body as { email: string }

    const usuario = await prisma.usuario.findUnique({ where: { email } })

    // Sempre retorna 200 para não revelar se o e-mail existe (anti-enumeration)
    if (!usuario || !usuario.ativo) {
      res.json({ message: 'Se o e-mail estiver cadastrado, você receberá as instruções em breve.' })
      return
    }

    const token = crypto.randomBytes(32).toString('hex')
    const tokenHash = await bcrypt.hash(token, 10)
    const expires = new Date(Date.now() + 60 * 60 * 1000) // 1 hora

    await prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        reset_token_hash: tokenHash,
        reset_token_expires: expires,
      },
    })

    // Envio do link de redefinição de senha
    const portalUrl = (process.env['FRONTEND_URL'] ?? 'http://localhost:8080')
      .split(',')[0]
      .trim()
      .replace(/\/$/, '')
    const resetUrl = `${portalUrl}/redefinir-senha?token=${token}&email=${encodeURIComponent(email)}`

    try {
      await enviarEmail({
        to: email,
        subject: 'ThinQi — Redefinição de senha',
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #1e293b; color: white; padding: 24px; border-radius: 8px 8px 0 0;">
              <h2 style="margin: 0;">ThinQi — Redefinição de senha</h2>
            </div>
            <div style="background: #f8fafc; padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
              <p>Olá, <strong>${usuario.nome}</strong>.</p>
              <p>Recebemos uma solicitação para redefinir sua senha no portal ThinQi.</p>
              <p style="text-align: center; margin: 24px 0;">
                <a href="${resetUrl}" style="display: inline-block; background: #6366f1; color: white; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600;">
                  Redefinir senha
                </a>
              </p>
              <p style="color: #6b7280; font-size: 12px;">Ou cole este link no navegador:<br><span style="word-break: break-all;">${resetUrl}</span></p>
              <p style="color: #6b7280; font-size: 12px;">Este link expira em 1 hora. Se você não solicitou a redefinição, ignore este e-mail.</p>
            </div>
          </div>
        `,
      })
    } catch (e) {
      // Não vaza falha de envio ao usuário (anti-enumeration) — apenas registra
      console.error('Falha ao enviar e-mail de redefinição:', e)
    }

    if (process.env['NODE_ENV'] !== 'production') {
      console.log(`[DEV] Reset token para ${email}: ${token}`)
      console.log(`[DEV] Expira em: ${expires.toISOString()}`)
    }

    res.json({ message: 'Se o e-mail estiver cadastrado, você receberá as instruções em breve.' })
  } catch (err) {
    next(err)
  }
}
