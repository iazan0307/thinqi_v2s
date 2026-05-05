/**
 * Helpers de hash para deduplicação de uploads.
 *
 * Usamos SHA-256 (não criptográfico forte é desnecessário aqui — apenas
 * detecção de bytes idênticos). Hex sem prefixo, 64 caracteres.
 */

import * as crypto from 'crypto'
import * as fs from 'fs/promises'

export function hashBuffer(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

export async function hashFile(path: string): Promise<string> {
  const buffer = await fs.readFile(path)
  return hashBuffer(buffer)
}

import { prisma } from './prisma'

/**
 * Verifica se já existe um upload CONFIRMADO/PROCESSADO com o mesmo hash
 * para a mesma empresa. Uploads em estado de erro ou pendente não bloqueiam
 * — o usuário pode reenviar um arquivo que falhou anteriormente.
 *
 * Retorna o registro existente quando há duplicata, ou null quando OK pra subir.
 */
export async function findUploadDuplicado(params: {
  empresa_id: string
  hash_sha256: string
}): Promise<{ id: string; nome_original: string; uploaded_at: Date } | null> {
  const existente = await prisma.arquivoUpload.findFirst({
    where: {
      empresa_id: params.empresa_id,
      hash_sha256: params.hash_sha256,
      status: { in: ['PROCESSADO', 'CONFIRMADO'] },
    },
    select: { id: true, nome_original: true, uploaded_at: true },
    orderBy: { uploaded_at: 'desc' },
  })
  return existente
}
