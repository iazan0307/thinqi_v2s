/**
 * Helper de auditoria — registra operações sensíveis na tabela `audit_logs`.
 *
 * Princípios:
 *   - Falha do log NUNCA deve interromper a operação principal. Erros aqui são
 *     apenas logados em stdout — o sistema continua funcionando.
 *   - O log é imutável (apenas inserts). Não há rota pra editar/remover.
 *   - Inclua sempre `entidade` + `entidade_id` para permitir reconstrução do
 *     histórico de um recurso específico via SELECT WHERE entidade='X' AND entidade_id='Y'.
 */

import { Request } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from './prisma'

export type AuditAction =
  // Uploads
  | 'DELETE_UPLOAD'
  // Clientes (usuários do portal)
  | 'INVITE_CLIENTE'
  | 'UPDATE_PERFIL_CLIENTE'
  | 'TOGGLE_ATIVO_CLIENTE'
  | 'SOFT_DELETE_CLIENTE'
  // Empresas
  | 'CREATE_EMPRESA'
  | 'UPDATE_EMPRESA'
  | 'DELETE_EMPRESA'
  // Contas bancárias
  | 'CREATE_CONTA_BANCARIA'
  | 'DELETE_CONTA_BANCARIA'
  // Sócios
  | 'CREATE_SOCIO'
  | 'UPDATE_SOCIO'
  | 'DELETE_SOCIO'
  // Liberação de período / relatório
  | 'LIBERAR_PERIODO'
  // Login/Logout (opcional, alto volume — desabilitado por padrão)
  | 'LOGIN'
  | 'LOGOUT'

export interface AuditEntry {
  acao: AuditAction
  entidade: string
  entidade_id?: string | null
  empresa_id?: string | null
  detalhes?: Prisma.InputJsonValue
  /** Quando undefined, tenta extrair de req. Quando null, registra log de sistema (sem usuário). */
  usuario_id?: string | null
  /** Request opcional para extrair IP/user-agent automaticamente */
  req?: Request
}

function getIp(req: Request | undefined): string | null {
  if (!req) return null
  // Em Railway/Render há proxy: usa X-Forwarded-For quando válido
  const fwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
  return fwd || req.socket?.remoteAddress || null
}

function getUserAgent(req: Request | undefined): string | null {
  if (!req) return null
  return (req.headers['user-agent'] as string | undefined) ?? null
}

/**
 * Registra uma entrada de auditoria. Esta função nunca lança — falhas são
 * absorvidas e logadas em stdout como `[AUDIT-FAIL]`.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    const usuario_id = entry.usuario_id !== undefined ? entry.usuario_id : (entry.req?.user?.id ?? null)
    await prisma.auditLog.create({
      data: {
        acao: entry.acao,
        entidade: entry.entidade,
        entidade_id: entry.entidade_id ?? null,
        usuario_id,
        empresa_id: entry.empresa_id ?? null,
        detalhes: entry.detalhes,
        ip: getIp(entry.req),
        user_agent: getUserAgent(entry.req),
      },
    })
  } catch (err) {
    // Não interrompe a operação principal — auditoria é best-effort.
    console.error('[AUDIT-FAIL]', {
      acao: entry.acao,
      entidade: entry.entidade,
      entidade_id: entry.entidade_id,
      erro: err instanceof Error ? err.message : 'desconhecido',
    })
  }
}
