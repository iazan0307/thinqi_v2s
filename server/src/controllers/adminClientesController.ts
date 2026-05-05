/**
 * Gerenciamento de usuários clientes pelo admin.
 * Convite por e-mail, listagem, liberação de períodos.
 */

import { Request, Response, NextFunction } from 'express'
import * as fs from 'fs/promises'
import * as path from 'path'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { Role, PerfilCliente } from '@prisma/client'
import { enviarEmail } from '../services/email/mailer'
import { audit } from '../utils/audit'

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
          _count: {
            select: {
              transacoes_bancarias: true,
              transacoes_cartao:    true,
              faturamentos:         true,
            },
          },
        },
      }),
    ])

    res.json({ data: arquivos, meta: { total, page, limit } })
  } catch (err) {
    next(err)
  }
}

// ─── DELETE /api/admin/arquivos/:id ───────────────────────────────────────────
// Remove 1 ArquivoUpload + todas as transações geradas a partir dele + arquivo físico.
// Prisma não cascateia essas relações (nenhuma tem onDelete: Cascade), então a ordem
// importa: filhos primeiro dentro de uma transação.
//
// Pós-delete: recalcula automaticamente o RelatorioDesconforto dos meses afetados
// pelas transações removidas, para que a conciliação fique imediatamente consistente
// com os dados restantes. Se nenhum mês for afetado (arquivo sem lançamentos), pula
// o recálculo.

export async function deleteArquivo(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params

    const arquivo = await prisma.arquivoUpload.findUnique({
      where: { id },
      select: {
        id: true,
        nome_storage: true,
        nome_original: true,
        empresa_id: true,
        tipo: true,
        empresa: { select: { razao_social: true } },
      },
    })
    if (!arquivo) throw new AppError(404, 'Arquivo não encontrado')

    // Coleta os meses afetados ANTES de deletar — o conjunto é usado depois pra
    // recalcular o RelatorioDesconforto de cada mês.
    const [bancarias, cartoes, faturamentos] = await Promise.all([
      prisma.transacaoBancaria.findMany({
        where: { arquivo_id: id },
        select: { data: true },
      }),
      prisma.transacaoCartao.findMany({
        where: { arquivo_id: id },
        select: { data: true },
      }),
      prisma.faturamento.findMany({
        where: { arquivo_id: id },
        select: { mes_ref: true },
      }),
    ])

    const totalLancamentos = bancarias.length + cartoes.length + faturamentos.length

    const mesesAfetados = new Set<string>()
    const adicionarMes = (d: Date) => {
      mesesAfetados.add(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
    }
    bancarias.forEach(t => adicionarMes(t.data))
    cartoes.forEach(t => adicionarMes(t.data))
    faturamentos.forEach(f => adicionarMes(f.mes_ref))

    await prisma.$transaction([
      prisma.transacaoBancaria.deleteMany({ where: { arquivo_id: id } }),
      prisma.transacaoCartao.deleteMany({ where: { arquivo_id: id } }),
      prisma.faturamento.deleteMany({ where: { arquivo_id: id } }),
      prisma.arquivoUpload.delete({ where: { id } }),
    ])

    // Auditoria estruturada — gravada em audit_logs (table). Falha no log
    // não bloqueia o delete (best-effort).
    await audit({
      acao: 'DELETE_UPLOAD',
      entidade: 'ArquivoUpload',
      entidade_id: id,
      empresa_id: arquivo.empresa_id,
      detalhes: {
        nome_original: arquivo.nome_original,
        tipo: arquivo.tipo,
        empresa_razao: arquivo.empresa.razao_social,
        transacoes_bancarias_removidas: bancarias.length,
        transacoes_cartao_removidas: cartoes.length,
        faturamentos_removidos: faturamentos.length,
        meses_afetados: Array.from(mesesAfetados).sort(),
      },
      req,
    })

    // Remove o arquivo físico (se ainda existir). Silencia ENOENT — arquivos antigos
    // podem já ter sumido (Railway recria o disco entre deploys) e isso não é erro.
    if (arquivo.nome_storage) {
      const full = path.join(process.cwd(), 'uploads', arquivo.nome_storage)
      try {
        await fs.unlink(full)
      } catch (e) {
        const err = e as NodeJS.ErrnoException
        if (err.code !== 'ENOENT') {
          console.warn(`[ARQUIVOS] Falha ao remover ${full}: ${err.message}`)
        }
      }
    }

    // Recalcula RelatorioDesconforto dos meses afetados — só quando já existe
    // um relatório salvo pra aquele (empresa, mês). Se não existe, não cria
    // (o admin pode não ter aberto a conciliação ainda).
    if (mesesAfetados.size > 0) {
      const { calcularConciliacao, salvarRelatorio } = await import('../services/engine/conciliacao')
      for (const ym of mesesAfetados) {
        const [y, m] = ym.split('-').map(Number)
        const mesRef = new Date(Date.UTC(y, m - 1, 1))
        const fim = new Date(Date.UTC(y, m, 0, 23, 59, 59))

        const existente = await prisma.relatorioDesconforto.findFirst({
          where: { empresa_id: arquivo.empresa_id, mes_ref: { gte: mesRef, lte: fim } },
        })
        if (!existente) continue

        try {
          const resultado = await calcularConciliacao(arquivo.empresa_id, mesRef)
          await salvarRelatorio(resultado)
        } catch (e) {
          // Recálculo não é crítico — registra warning mas não falha a operação
          // de delete (o arquivo já foi removido do banco).
          console.warn(`[ARQUIVOS] Falha ao recalcular conciliação ${arquivo.empresa_id}/${ym}: ${e instanceof Error ? e.message : 'desconhecido'}`)
        }
      }
    }

    res.json({
      deletado: true,
      id,
      lancamentos_removidos: totalLancamentos,
      meses_recalculados: Array.from(mesesAfetados).sort(),
    })
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

    const perfil = perfil_cliente === 'SECRETARIA' ? PerfilCliente.SECRETARIA : PerfilCliente.SOCIO

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

    let conviteEnviado = false
    let erroEnvio: string | null = null
    try {
      await enviarEmail({
        to: email,
        subject: `Seu acesso ThinQi — ${empresa.razao_social}`,
        html: htmlConvite,
      })
      conviteEnviado = true
    } catch (e) {
      erroEnvio = e instanceof Error ? e.message : 'Falha desconhecida'
      console.warn(`[CLIENTES] Falha ao enviar convite para ${email}: ${erroEnvio}`)
    }

    await audit({
      acao: 'INVITE_CLIENTE',
      entidade: 'Usuario',
      entidade_id: usuario.id,
      empresa_id,
      detalhes: {
        nome: usuario.nome,
        email: usuario.email,
        perfil_cliente: usuario.perfil_cliente,
        convite_enviado: conviteEnviado,
      },
      req,
    })

    res.status(201).json({
      usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email },
      convite_enviado: conviteEnviado,
      erro_envio: erroEnvio,
      senha_temporaria: senhaTemp,
      login_url: loginUrl,
    })
  } catch (err) {
    next(err)
  }
}

// ─── DELETE /api/admin/clientes/:id ──────────────────────────────────────────
// SOFT DELETE: desativa o cliente (ativo=false) preservando o histórico.
// Auditoria contábil exige que o registro do cliente continue acessível mesmo
// após "desativação" — para reconciliações antigas, relatórios exportados etc.
// Uso da flag `ativo` impede login (vide authController.login) e oculta da
// listagem padrão (filtros de listClientes/listEmpresas).

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

    if (!usuario.ativo) {
      // Idempotente — já estava desativado.
      res.json({ deletado: true, ja_inativo: true })
      return
    }

    await prisma.usuario.update({
      where: { id },
      data: {
        ativo: false,
        // Invalida sessão ativa caso o cliente esteja logado no momento.
        refresh_token_hash: null,
      },
    })

    await audit({
      acao: 'SOFT_DELETE_CLIENTE',
      entidade: 'Usuario',
      entidade_id: id,
      empresa_id: usuario.empresa_id,
      detalhes: {
        nome: usuario.nome,
        email: usuario.email,
        perfil_cliente: usuario.perfil_cliente,
      },
      req,
    })

    res.json({ deletado: true, soft: true })
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

    if (perfil_cliente !== 'SOCIO' && perfil_cliente !== 'SECRETARIA') {
      throw new AppError(400, 'perfil_cliente deve ser SOCIO ou SECRETARIA')
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

    await audit({
      acao: 'UPDATE_PERFIL_CLIENTE',
      entidade: 'Usuario',
      entidade_id: id,
      empresa_id: usuario.empresa_id,
      detalhes: {
        de: usuario.perfil_cliente,
        para: perfil_cliente,
      },
      req,
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
      data: {
        ativo,
        // Ao desativar, invalida a sessão ativa
        ...(!ativo ? { refresh_token_hash: null } : {}),
      },
      select: { id: true, nome: true, email: true, ativo: true },
    })

    await audit({
      acao: 'TOGGLE_ATIVO_CLIENTE',
      entidade: 'Usuario',
      entidade_id: id,
      empresa_id: usuario.empresa_id,
      detalhes: { de: usuario.ativo, para: ativo },
      req,
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

    await audit({
      acao: 'LIBERAR_PERIODO',
      entidade: 'RelatorioDesconforto',
      entidade_id: relatorioLiberado.id,
      empresa_id: empresaId,
      detalhes: { mes_ref: mes },
      req,
    })

    res.json({ liberado: true, relatorio: relatorioLiberado })
  } catch (err) {
    next(err)
  }
}
