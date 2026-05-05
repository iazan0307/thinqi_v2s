/**
 * Cadastro de contas bancárias do cliente — popula a tabela usada no
 * roteamento automático do upload em lote de OFX.
 *
 * Fluxo: admin abre o cadastro da empresa, clica "Adicionar conta via OFX",
 * sobe um OFX da conta. O sistema lê BANKID + ACCTID do conteúdo, normaliza,
 * e vincula à empresa. Cliente com várias contas → sobe um OFX de cada.
 *
 * O CNPJ do titular não está nos OFX brasileiros confirmados (Bradesco,
 * Inter, Itaú), por isso esta etapa de cadastro prévio é obrigatória para
 * habilitar o upload em lote sem seleção manual.
 */

import { Request, Response, NextFunction } from 'express'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { extractOFXIdentificacao } from '../services/parser/ofx'
import { audit } from '../utils/audit'

/** GET /api/empresas/:empresaId/contas-bancarias */
export async function listContasBancarias(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { empresaId } = req.params

    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new AppError(404, 'Empresa não encontrada')

    const contas = await prisma.contaBancaria.findMany({
      where: { empresa_id: empresaId },
      orderBy: [{ bank_name: 'asc' }, { acct_id: 'asc' }],
    })

    res.json({ data: contas })
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/empresas/:empresaId/contas-bancarias/from-ofx
 * FormData: arquivo (1 OFX)
 *
 * Lê BANKID/ACCTID/BRANCHID/ACCTTYPE/ORG do OFX e cria 1 ContaBancaria.
 * Bloqueia se a mesma (bank_id, acct_id) já estiver em outra empresa
 * (constraint @@unique do Prisma) — nesse caso devolve mensagem específica
 * com o nome do cliente "dono" para o admin entender o conflito.
 */
export async function adicionarContaViaOFX(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { empresaId } = req.params
    const file = req.file
    if (!file) throw new AppError(400, 'Arquivo OFX obrigatório')
    if (!file.buffer) throw new AppError(500, 'Upload precisa estar em memória (memoryStorage)')

    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new AppError(404, 'Empresa não encontrada')

    // OFX brasileiro vem em latin1 — buffer.toString('latin1') é o canônico
    const content = file.buffer.toString('latin1')
    const ident = extractOFXIdentificacao(content)
    if (!ident) {
      throw new AppError(
        422,
        'Não foi possível extrair BANKID/ACCTID do arquivo OFX. Confirme se o arquivo é um extrato OFX válido.',
      )
    }

    // Verifica colisão com outra empresa
    const existente = await prisma.contaBancaria.findUnique({
      where: { bank_id_acct_id: { bank_id: ident.bank_id, acct_id: ident.acct_id } },
      include: { empresa: { select: { id: true, razao_social: true } } },
    })

    if (existente) {
      if (existente.empresa_id === empresaId) {
        // Conta já está nesta empresa — devolve a existente sem erro (idempotente)
        res.status(200).json({ ja_cadastrada: true, conta: existente })
        return
      }
      throw new AppError(
        409,
        `Esta conta ${ident.bank_name}/${ident.acct_id} já está cadastrada em outra empresa: ${existente.empresa.razao_social}.`,
      )
    }

    const conta = await prisma.contaBancaria.create({
      data: {
        empresa_id: empresaId,
        bank_id: ident.bank_id,
        bank_name: ident.bank_name,
        agencia: ident.agencia ?? null,
        acct_id: ident.acct_id,
        acct_id_display: ident.acct_id_display,
        account_type: ident.account_type ?? null,
      },
    })

    await audit({
      acao: 'CREATE_CONTA_BANCARIA',
      entidade: 'ContaBancaria',
      entidade_id: conta.id,
      empresa_id: empresaId,
      detalhes: {
        bank_id: conta.bank_id,
        bank_name: conta.bank_name,
        agencia: conta.agencia,
        acct_id_display: conta.acct_id_display,
      },
      req,
    })

    res.status(201).json({ ja_cadastrada: false, conta })
  } catch (err) {
    next(err)
  }
}

/** DELETE /api/empresas/:empresaId/contas-bancarias/:id */
export async function removerConta(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { empresaId, id } = req.params

    const conta = await prisma.contaBancaria.findUnique({ where: { id } })
    if (!conta) throw new AppError(404, 'Conta bancária não encontrada')
    if (conta.empresa_id !== empresaId) {
      throw new AppError(404, 'Conta bancária não pertence a esta empresa')
    }

    await prisma.contaBancaria.delete({ where: { id } })

    await audit({
      acao: 'DELETE_CONTA_BANCARIA',
      entidade: 'ContaBancaria',
      entidade_id: id,
      empresa_id: empresaId,
      detalhes: {
        bank_id: conta.bank_id,
        bank_name: conta.bank_name,
        acct_id_display: conta.acct_id_display,
      },
      req,
    })

    res.json({ deletado: true, id })
  } catch (err) {
    next(err)
  }
}
