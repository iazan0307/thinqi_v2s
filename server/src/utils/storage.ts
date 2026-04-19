/**
 * Wrapper do Supabase Storage.
 * Usado para persistir PDFs de Estimativa de Imposto (upload manual do admin,
 * não regenerável — precisa sobreviver a redeploys).
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { AppError } from '../middleware/errorHandler'

const BUCKET = 'estimativas'

let _client: SupabaseClient | null = null

function getClient(): SupabaseClient {
  if (_client) return _client
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) {
    throw new AppError(
      500,
      'Supabase Storage não configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.',
    )
  }
  _client = createClient(url, key, { auth: { persistSession: false } })
  return _client
}

export async function uploadPDF(key: string, buffer: Buffer): Promise<void> {
  // cacheControl: '0' — evita que o CDN do Supabase sirva versão antiga
  // após um re-upload ou delete. PDFs de estimativa são raramente acessados
  // e precisam refletir a última versão enviada pelo admin.
  const { error } = await getClient()
    .storage.from(BUCKET)
    .upload(key, buffer, { contentType: 'application/pdf', upsert: true, cacheControl: '0' })
  if (error) throw new AppError(500, `Falha no upload ao Storage: ${error.message}`)
}

export async function downloadPDF(key: string): Promise<Buffer | null> {
  const { data, error } = await getClient().storage.from(BUCKET).download(key)
  if (error) {
    // 404 / objeto não encontrado → null (tratado pelo caller)
    if (error.message?.toLowerCase().includes('not found')) return null
    throw new AppError(500, `Falha ao baixar do Storage: ${error.message}`)
  }
  const arrBuffer = await data.arrayBuffer()
  return Buffer.from(arrBuffer)
}

export async function deletePDF(key: string): Promise<void> {
  const { error } = await getClient().storage.from(BUCKET).remove([key])
  // Falha silenciosa — se o objeto já não existe, não é erro que justifique 500
  if (error) console.warn(`[storage] falha ao remover ${key}: ${error.message}`)
}
