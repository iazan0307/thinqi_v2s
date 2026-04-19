/**
 * Gestão de usuários internos (ADMIN e CONTADOR).
 * Somente ADMIN pode criar/editar/desativar outros usuários internos.
 */

import { Request, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { Role } from '@prisma/client'
import { enviarEmail } from '../services/email/mailer'

// ─── GET /api/admin/usuarios ──────────────────────────────────────────────────

export async function listUsuarios(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const page  = Math.max(1, Number(req.query['page'])  || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query['limit']) || 20))

    const [total, usuarios] = await Promise.all([
      prisma.usuario.count({ where: { role: { in: [Role.ADMIN, Role.CONTADOR] } } }),
      prisma.usuario.findMany({
        where:   { role: { in: [Role.ADMIN, Role.CONTADOR] } },
        skip:    (page - 1) * limit,
        take:    limit,
        orderBy: { nome: 'asc' },
        select: {
          id:          true,
          nome:        true,
          email:       true,
          role:        true,
          ativo:       true,
          ultimo_login: true,
          created_at:  true,
        },
      }),
    ])

    res.json({ data: usuarios, meta: { total, page, limit } })
  } catch (err) {
    next(err)
  }
}

// ─── POST /api/admin/usuarios ─────────────────────────────────────────────────

export async function criarUsuario(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { nome, email, role } = req.body as {
      nome?: string; email?: string; role?: string
    }

    if (!nome || !email || !role) {
      throw new AppError(400, 'nome, email e role são obrigatórios')
    }

    if (role !== Role.ADMIN && role !== Role.CONTADOR) {
      throw new AppError(400, 'role deve ser ADMIN ou CONTADOR')
    }

    // Apenas ADMIN pode criar outro ADMIN
    if (role === Role.ADMIN && req.user!.role !== Role.ADMIN) {
      throw new AppError(403, 'Somente um ADMIN pode criar outro ADMIN')
    }

    const existe = await prisma.usuario.findUnique({ where: { email } })
    if (existe) throw new AppError(409, 'Já existe um usuário com este e-mail')

    const senhaTemp = crypto.randomBytes(6).toString('hex')
    const senhaHash = await bcrypt.hash(senhaTemp, 10)

    const usuario = await prisma.usuario.create({
      data: {
        nome:       nome.trim(),
        email:      email.toLowerCase().trim(),
        senha_hash: senhaHash,
        role:       role as Role,
      },
      select: { id: true, nome: true, email: true, role: true },
    })

    const roleLabel = role === Role.ADMIN ? 'Administrador' : 'Contador'

    // Falha de SMTP NÃO deve quebrar a criação — o usuário já existe no banco.
    // Devolvemos a senha temporária ao admin para repasse manual.
    let conviteEnviado = false
    let erroEnvio: string | null = null
    try {
      await enviarEmail({
        to:      email,
        subject: 'Seu acesso ThinQi foi criado',
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #1e293b; color: white; padding: 24px; border-radius: 8px 8px 0 0;">
              <h2 style="margin: 0;">ThinQi — Bem-vindo(a)!</h2>
            </div>
            <div style="background: #f8fafc; padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
              <p>Olá, <strong>${usuario.nome}</strong>!</p>
              <p>Seu acesso ao painel ThinQi foi criado com o perfil de <strong>${roleLabel}</strong>.</p>
              <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0;">
                <p style="margin: 0 0 8px;"><strong>E-mail:</strong> ${usuario.email}</p>
                <p style="margin: 0;"><strong>Senha temporária:</strong> <code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">${senhaTemp}</code></p>
              </div>
              <p style="color: #6b7280; font-size: 12px;">Por segurança, altere sua senha no primeiro acesso em <em>Configurações → Alterar Senha</em>.</p>
            </div>
          </div>
        `,
      })
      conviteEnviado = true
    } catch (e) {
      erroEnvio = e instanceof Error ? e.message : 'Falha desconhecida'
      console.warn(`[USUARIOS] Falha ao enviar convite para ${email}: ${erroEnvio}`)
    }

    res.status(201).json({
      usuario,
      convite_enviado: conviteEnviado,
      erro_envio: erroEnvio,
      senha_temporaria: senhaTemp,
    })
  } catch (err) {
    next(err)
  }
}

// ─── PUT /api/admin/usuarios/:id ─────────────────────────────────────────────

export async function atualizarUsuario(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params
    const { nome, role } = req.body as { nome?: string; role?: string }

    const usuario = await prisma.usuario.findUnique({ where: { id } })
    if (!usuario || usuario.role === Role.CLIENTE) {
      throw new AppError(404, 'Usuário não encontrado')
    }

    // Impede que o próprio admin se rebaixe
    if (req.user!.id === id && role && role !== Role.ADMIN) {
      throw new AppError(400, 'Você não pode alterar seu próprio perfil de ADMIN')
    }

    if (role && role !== Role.ADMIN && role !== Role.CONTADOR) {
      throw new AppError(400, 'role deve ser ADMIN ou CONTADOR')
    }

    if (role === Role.ADMIN && req.user!.role !== Role.ADMIN) {
      throw new AppError(403, 'Somente um ADMIN pode promover a ADMIN')
    }

    const updated = await prisma.usuario.update({
      where: { id },
      data: {
        ...(nome ? { nome: nome.trim() } : {}),
        ...(role ? { role: role as Role } : {}),
      },
      select: { id: true, nome: true, email: true, role: true, ativo: true },
    })

    res.json(updated)
  } catch (err) {
    next(err)
  }
}

// ─── PUT /api/admin/usuarios/:id/ativo ───────────────────────────────────────

export async function toggleUsuario(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params
    const { ativo } = req.body as { ativo?: boolean }

    if (ativo === undefined) throw new AppError(400, 'Campo ativo obrigatório')

    if (req.user!.id === id) {
      throw new AppError(400, 'Você não pode desativar sua própria conta')
    }

    const usuario = await prisma.usuario.findUnique({ where: { id } })
    if (!usuario || usuario.role === Role.CLIENTE) {
      throw new AppError(404, 'Usuário não encontrado')
    }

    const updated = await prisma.usuario.update({
      where: { id },
      data:  { ativo },
      select: { id: true, nome: true, email: true, role: true, ativo: true },
    })

    res.json(updated)
  } catch (err) {
    next(err)
  }
}

// ─── DELETE /api/admin/usuarios/:id ──────────────────────────────────────────

export async function excluirUsuario(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params

    if (req.user!.id === id) {
      throw new AppError(400, 'Você não pode excluir sua própria conta')
    }

    const usuario = await prisma.usuario.findUnique({ where: { id } })
    if (!usuario || usuario.role === Role.CLIENTE) {
      throw new AppError(404, 'Usuário não encontrado')
    }

    // ArquivoUpload.uploaded_by tem FK obrigatória — se o usuário já subiu
    // qualquer arquivo, exclusão hard bloqueia. Nesse caso, orientamos a desativar.
    const uploads = await prisma.arquivoUpload.count({ where: { uploaded_by: id } })
    if (uploads > 0) {
      throw new AppError(
        409,
        `Usuário possui ${uploads} upload(s) no histórico. Desative em vez de excluir.`,
      )
    }

    await prisma.usuario.delete({ where: { id } })
    res.json({ excluido: true })
  } catch (err) {
    next(err)
  }
}

// ─── POST /api/admin/usuarios/:id/resetar-senha ──────────────────────────────

export async function resetarSenha(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params

    const usuario = await prisma.usuario.findUnique({ where: { id } })
    if (!usuario || usuario.role === Role.CLIENTE) {
      throw new AppError(404, 'Usuário não encontrado')
    }

    const novaSenha = crypto.randomBytes(6).toString('hex')
    const hash      = await bcrypt.hash(novaSenha, 10)

    await prisma.usuario.update({ where: { id }, data: { senha_hash: hash } })

    let emailEnviado = false
    let erroEnvio: string | null = null
    try {
      await enviarEmail({
        to:      usuario.email,
        subject: 'Sua senha ThinQi foi redefinida',
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #1e293b; color: white; padding: 24px; border-radius: 8px 8px 0 0;">
              <h2 style="margin: 0;">ThinQi — Redefinição de Senha</h2>
            </div>
            <div style="background: #f8fafc; padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
              <p>Olá, <strong>${usuario.nome}</strong>!</p>
              <p>Sua senha foi redefinida por um administrador.</p>
              <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0;">
                <p style="margin: 0;"><strong>Nova senha temporária:</strong> <code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">${novaSenha}</code></p>
              </div>
              <p style="color: #6b7280; font-size: 12px;">Altere sua senha imediatamente em <em>Configurações → Alterar Senha</em>.</p>
            </div>
          </div>
        `,
      })
      emailEnviado = true
    } catch (e) {
      erroEnvio = e instanceof Error ? e.message : 'Falha desconhecida'
      console.warn(`[USUARIOS] Falha ao enviar e-mail de reset para ${usuario.email}: ${erroEnvio}`)
    }

    res.json({
      resetado: true,
      email_enviado: emailEnviado,
      erro_envio: erroEnvio,
      senha_temporaria: novaSenha,
    })
  } catch (err) {
    next(err)
  }
}
