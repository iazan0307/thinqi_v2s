/**
 * Gerenciamento de usuários clientes pelo admin.
 * Convite por e-mail, listagem, liberação de períodos.
 */

import { Request, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { Role, PerfilCliente } from '@prisma/client'
import { enviarEmail } from '../services/email/mailer'

// ─── GET /api/admin/arquivos ──────────────────────────────────────────────────
// Lista uploads por empresa + tipo (OFX/CSV = extratos bancários; PLANILHA = Robô IAZAN)

export async function listArquivos(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const page  = Math.max(1, Number(req.query['page'])  || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query['limit']) || 20))
    const empresa_id = req.query['empresa_id'] as string | undefined
    const tipo       = req.query['tipo'] as string | undefined   // OFX | CSV | PLANILHA

    const where: Record<string, unknown> = {}
    if (empresa_id) where['empresa_id'] = empresa_id
    if (tipo)       where['tipo']       = tipo

    const [total, arquivos] = await Promise.all([
      prisma.arquivoUpload.count({ where }),
      prisma.arquivoUpload.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { uploaded_at: 'desc' },
        select: {
          id:            true,
          tipo:          true,
          nome_original: true,
          tamanho_bytes: true,
          status:        true,
          uploaded_at:   true,
          processado_at: true,
          mensagem_erro: true,
          empresa: { select: { id: true, razao_social: true, cnpj: true } },
          uploader: { select: { nome: true } },
        },
      }),
    ])

    res.json({ data: arquivos, meta: { total, page, limit } })
  } catch (err) {
    next(err)
  }
}

// ─── GET /api/admin/clientes ──────────────────────────────────────────────────

export async function listClientes(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const page = Math.max(1, Number(req.query['page']) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query['limit']) || 20))

    const [total, clientes] = await Promise.all([
      prisma.usuario.count({ where: { role: Role.CLIENTE } }),
      prisma.usuario.findMany({
        where: { role: Role.CLIENTE },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { nome: 'asc' },
        select: {
          id: true,
          nome: true,
          email: true,
          ativo: true,
          perfil_cliente: true,
          ultimo_login: true,
          created_at: true,
          empresa: {
            select: { id: true, razao_social: true, cnpj: true },
          },
        },
      }),
    ])

    res.json({ data: clientes, meta: { total, page, limit } })
  } catch (err) {
    next(err)
  }
}

// ─── POST /api/admin/clientes/convidar ───────────────────────────────────────

export async function convidarCliente(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { nome, email, empresa_id, perfil_cliente } = req.body as {
      nome?: string
      email?: string
      empresa_id?: string
      perfil_cliente?: PerfilCliente
    }

    if (!nome || !email || !empresa_id) {
      throw new AppError(400, 'nome, email e empresa_id são obrigatórios')
    }

    const perfil = perfil_cliente === 'ADMINISTRATIVO' ? PerfilCliente.ADMINISTRATIVO : PerfilCliente.SOCIO

    const empresa = await prisma.empresa.findUnique({ where: { id: empresa_id } })
    if (!empresa) throw new AppError(404, 'Empresa não encontrada')

    const existe = await prisma.usuario.findUnique({ where: { email } })
    if (existe) throw new AppError(409, 'Já existe um usuário com este e-mail')

    // Gera senha temporária aleatória
    const senhaTemp = crypto.randomBytes(5).toString('hex') // ex: "a3f9c2b1d4"
    const senhaHash = await bcrypt.hash(senhaTemp, 10)

    const usuario = await prisma.usuario.create({
      data: {
        nome: nome.trim(),
        email: email.toLowerCase().trim(),
        senha_hash: senhaHash,
        role: Role.CLIENTE,
        perfil_cliente: perfil,
        empresa_id,
      },
      select: { id: true, nome: true, email: true, perfil_cliente: true, empresa: { select: { razao_social: true } } },
    })

    // E-mail de boas-vindas com link direto para o portal (primeira origem em FRONTEND_URL)
    const portalUrl = (process.env['FRONTEND_URL'] ?? 'http://localhost:8080')
      .split(',')[0]
      .trim()
      .replace(/\/$/, '')
    const loginUrl = `${portalUrl}/?email=${encodeURIComponent(usuario.email)}`

    const htmlConvite = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #1e293b; color: white; padding: 24px; border-radius: 8px 8px 0 0;">
          <h2 style="margin: 0;">ThinQi — Seu acesso foi criado!</h2>
        </div>
        <div style="background: #f8fafc; padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
          <p>Olá, <strong>${usuario.nome}</strong>!</p>
          <p>Seu acesso ao portal financeiro da empresa <strong>${empresa.razao_social}</strong> foi criado.</p>
          <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0;">
            <p style="margin: 0 0 8px;"><strong>E-mail:</strong> ${usuario.email}</p>
            <p style="margin: 0;"><strong>Senha temporária:</strong> <code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">${senhaTemp}</code></p>
          </div>
          <p style="text-align: center; margin: 24px 0;">
            <a href="${loginUrl}" style="display: inline-block; background: #6366f1; color: white; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600;">
              Acessar o Portal ThinQi
            </a>
          </p>
          <p style="color: #6b7280; font-size: 12px;">Ou copie e cole este link no seu navegador:<br><span style="word-break: break-all;">${loginUrl}</span></p>
          <p style="color: #6b7280; font-size: 12px;">Por segurança, altere sua senha no primeiro acesso em <em>Configurações → Alterar Senha</em>.</p>
        </div>
      </div>
    `

    await enviarEmail({
      to: email,
      subject: `Seu acesso ThinQi — ${empresa.razao_social}`,
      html: htmlConvite,
    })

    res.status(201).json({
      usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email },
      convite_enviado: true,
    })
  } catch (err) {
    next(err)
  }
}

// ─── DELETE /api/admin/clientes/:id ──────────────────────────────────────────

export async function deletarCliente(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params

    const usuario = await prisma.usuario.findUnique({ where: { id } })
    if (!usuario || usuario.role !== Role.CLIENTE) {
      throw new AppError(404, 'Cliente não encontrado')
    }

    await prisma.usuario.delete({ where: { id } })
    res.json({ deletado: true })
  } catch (err) {
    next(err)
  }
}

// ─── PUT /api/admin/clientes/:id/perfil ───────────────────────────────────────

export async function atualizarPerfilCliente(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params
    const { perfil_cliente } = req.body as { perfil_cliente?: PerfilCliente }

    if (perfil_cliente !== 'SOCIO' && perfil_cliente !== 'ADMINISTRATIVO') {
      throw new AppError(400, 'perfil_cliente deve ser SOCIO ou ADMINISTRATIVO')
    }

    const usuario = await prisma.usuario.findUnique({ where: { id } })
    if (!usuario || usuario.role !== Role.CLIENTE) {
      throw new AppError(404, 'Cliente não encontrado')
    }

    const updated = await prisma.usuario.update({
      where: { id },
      data: { perfil_cliente },
      select: { id: true, nome: true, email: true, perfil_cliente: true },
    })

    res.json(updated)
  } catch (err) {
    next(err)
  }
}

// ─── PUT /api/admin/clientes/:id/ativo ────────────────────────────────────────

export async function toggleCliente(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params
    const { ativo } = req.body as { ativo?: boolean }

    if (ativo === undefined) throw new AppError(400, 'Campo ativo obrigatório')

    const usuario = await prisma.usuario.findUnique({ where: { id } })
    if (!usuario || usuario.role !== Role.CLIENTE) {
      throw new AppError(404, 'Cliente não encontrado')
    }

    const updated = await prisma.usuario.update({
      where: { id },
      data: { ativo },
      select: { id: true, nome: true, email: true, ativo: true },
    })

    res.json(updated)
  } catch (err) {
    next(err)
  }
}

// ─── PUT /api/admin/liberacao/:empresaId/:mes ─────────────────────────────────
// "Liberar" um período = gerar/marcar o RelatorioDesconforto para que o cliente veja

export async function liberarPeriodo(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { empresaId, mes } = req.params

    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new AppError(404, 'Empresa não encontrada')

    const [year, month] = mes.split('-').map(Number)
    if (!year || !month) throw new AppError(422, 'Formato inválido. Use YYYY-MM')

    const mesRef = new Date(Date.UTC(year, month - 1, 1))
    const fim = new Date(Date.UTC(year, month, 0, 23, 59, 59))

    // Verifica se já existe um relatório; se não, calcula e cria
    let relatorio = await prisma.relatorioDesconforto.findFirst({
      where: { empresa_id: empresaId, mes_ref: { gte: mesRef, lte: fim } },
    })

    if (!relatorio) {
      // Importa o motor de conciliação e gera
      const { calcularConciliacao, salvarRelatorio } = await import('../services/engine/conciliacao')
      const resultado = await calcularConciliacao(empresaId, mesRef)
      const id = await salvarRelatorio(resultado)
      relatorio = await prisma.relatorioDesconforto.findUnique({ where: { id } })
    }

    // Bug 3: marca explicitamente como liberado para o cliente visualizar
    const relatorioLiberado = await prisma.relatorioDesconforto.update({
      where: { id: relatorio!.id },
      data: { liberado: true },
    })

    res.json({ liberado: true, relatorio: relatorioLiberado })
  } catch (err) {
    next(err)
  }
}
