/**
 * Upload em Lote Unificado — orquestrador para múltiplos tipos de arquivo.
 *
 * Recebe N arquivos misturados (OFX, CSV, XLSX, PDF) e despacha cada um para o
 * handler já existente do tipo correspondente. NÃO re-implementa parsers — só
 * detecta o tipo, chama a função pública de processamento e agrega resultados.
 *
 * Roteamento por CNPJ extraído do arquivo é responsabilidade dos handlers
 * (cada tipo tem sua heurística — ver controllers/cartaoController.ts,
 * faturamentoController.ts, estimativaImpostoController.ts,
 * contrachequeController.ts e a função processarExtratoSync em uploadController.ts).
 *
 * Exceção mantida: extrato CSV genérico não tem padrão de CNPJ — exige hint.
 */

import { Request, Response, NextFunction } from 'express'
import * as fs from 'fs/promises'
import { AppError } from '../middleware/errorHandler'
import { detectarTipoLote, TipoLote } from '../services/parser/uploadLoteDispatcher'
import { processarExtratoSync } from './uploadController'
import { processarArquivoCartao } from './cartaoController'
import { processarArquivoFaturamento } from './faturamentoController'
import { persistirEstimativa } from './estimativaImpostoController'
import { processarContrachequeBuffer } from './contrachequeController'

// ─── Tipo de retorno padronizado por arquivo ──────────────────────────────────

export interface ItemLoteResultado {
  nome_original: string
  tamanho_bytes: number
  tipo_detectado: TipoLote | null
  status: 'sucesso' | 'erro'
  empresa_id: string | null
  empresa_razao: string | null
  /** Mensagem para a coluna "Detalhes" — descreve o que foi importado ou o motivo do erro */
  detalhes: string
  /** Erro técnico (não exibido pra usuário final, fica no relatório CSV) */
  erro: string | null
}

// ─── Pool de concorrência ─────────────────────────────────────────────────────

/**
 * Executa `tasks` com no máximo `limit` em paralelo, preservando a ordem.
 * Implementação inline pra evitar dependência nova (p-limit).
 */
async function comLimite<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const resultados: T[] = new Array(tasks.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (true) {
      const idx = cursor++
      if (idx >= tasks.length) return
      resultados[idx] = await tasks[idx]()
    }
  })
  await Promise.all(workers)
  return resultados
}

// ─── Helper de cleanup ────────────────────────────────────────────────────────

async function unlinkSilent(p: string): Promise<void> {
  try {
    await fs.unlink(p)
  } catch {
    // O arquivo pode já ter sido deletado; não falha o lote por isso.
  }
}

// ─── Handler principal ────────────────────────────────────────────────────────

/**
 * Processa 1 arquivo do lote: detecta o tipo, chama o handler certo, retorna
 * um resumo padronizado. Faz cleanup do PDF quando aplicável (PDFs vão pra
 * Storage externo ou são descartados — o disco local é só transitório).
 */
async function processarItem(file: Express.Multer.File, uploaded_by: string): Promise<ItemLoteResultado> {
  let tipo: TipoLote | null = null
  try {
    const det = await detectarTipoLote(file)
    tipo = det.tipo

    if (det.tipo === 'desconhecido') {
      return {
        nome_original: file.originalname,
        tamanho_bytes: file.size,
        tipo_detectado: 'desconhecido',
        status: 'erro',
        empresa_id: null,
        empresa_razao: null,
        detalhes: det.motivo ?? 'Tipo de arquivo não suportado',
        erro: det.motivo ?? 'desconhecido',
      }
    }

    if (det.tipo === 'extrato_ofx') {
      const r = await processarExtratoSync({ file, uploaded_by })
      return {
        nome_original: file.originalname,
        tamanho_bytes: file.size,
        tipo_detectado: tipo,
        status: 'sucesso',
        empresa_id: r.empresa_id,
        empresa_razao: r.empresa_razao,
        detalhes: `${r.transacoes_importadas} transação(ões) importada(s)`,
        erro: null,
      }
    }

    if (det.tipo === 'extrato_csv') {
      // CSV genérico de banco não tem CNPJ confiável — exigimos hint.
      return {
        nome_original: file.originalname,
        tamanho_bytes: file.size,
        tipo_detectado: tipo,
        status: 'erro',
        empresa_id: null,
        empresa_razao: null,
        detalhes:
          'Extrato CSV genérico exige seleção manual da empresa — use o upload individual em Central de Uploads.',
        erro: 'csv_extrato_sem_cnpj',
      }
    }

    if (det.tipo === 'cartao') {
      // Cartão sem CNPJ válido pra cruzar é a EXCEÇÃO documentada — manda
      // sem hint; se o handler não conseguir, devolve mensagem clara.
      const r = await processarArquivoCartao({ file, uploaded_by })
      return {
        nome_original: file.originalname,
        tamanho_bytes: file.size,
        tipo_detectado: tipo,
        status: 'sucesso',
        empresa_id: r.empresa_id,
        empresa_razao: r.empresa_razao,
        detalhes: `${r.adquirente} · ${r.transacoes_importadas} transação(ões) · líquido R$ ${r.total_liquido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        erro: null,
      }
    }

    if (det.tipo === 'faturamento_iazan') {
      const r = await processarArquivoFaturamento({ file, uploaded_by })
      const empresasUnicas = Array.from(new Set(r.resultados.map(x => x.empresa_razao)))
      const empresa_razao = empresasUnicas.length === 1 ? empresasUnicas[0] : `${empresasUnicas.length} empresas`
      return {
        nome_original: file.originalname,
        tamanho_bytes: file.size,
        tipo_detectado: tipo,
        status: 'sucesso',
        empresa_id: r.resultados[0]?.empresa_id ?? null,
        empresa_razao,
        detalhes: `${r.meses_importados} faturamento(s) importado(s)`,
        erro: null,
      }
    }

    if (det.tipo === 'estimativa_pdf') {
      // Estimativa precisa de buffer (vai pro Supabase Storage) — lemos do disco.
      const buffer = await fs.readFile(file.path)
      const fileWithBuffer = { ...file, buffer } as Express.Multer.File
      const r = await persistirEstimativa({ file: fileWithBuffer, uploaded_by })
      return {
        nome_original: file.originalname,
        tamanho_bytes: file.size,
        tipo_detectado: tipo,
        status: 'sucesso',
        empresa_id: r.empresa_id,
        empresa_razao: r.empresa_razao,
        detalhes: `Estimativa ${r.mes_ref} · valor total R$ ${r.valor_total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        erro: null,
      }
    }

    if (det.tipo === 'contracheque_pdf') {
      const buffer = await fs.readFile(file.path)
      const r = await processarContrachequeBuffer({ buffer, originalname: file.originalname })
      return {
        nome_original: file.originalname,
        tamanho_bytes: file.size,
        tipo_detectado: tipo,
        status: 'sucesso',
        empresa_id: r.empresa_id,
        empresa_razao: r.empresa_razao,
        detalhes: `${r.socio_nome} (${r.cpf_mascara}) · pró-labore R$ ${r.valor_prolabore_mensal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        erro: null,
      }
    }

    // Cobertura de exhaustiveness (TS garante tipo nunca chega aqui)
    return {
      nome_original: file.originalname,
      tamanho_bytes: file.size,
      tipo_detectado: tipo,
      status: 'erro',
      empresa_id: null,
      empresa_razao: null,
      detalhes: 'Tipo detectado mas sem handler registrado',
      erro: 'sem_handler',
    }
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : 'Erro desconhecido'
    return {
      nome_original: file.originalname,
      tamanho_bytes: file.size,
      tipo_detectado: tipo,
      status: 'erro',
      empresa_id: null,
      empresa_razao: null,
      detalhes: mensagem,
      erro: mensagem,
    }
  } finally {
    // PDFs ficam em disco transitório; depois do processamento o arquivo
    // ou já foi enviado pro Storage (estimativa) ou foi descartado por design
    // (contracheque). Em ambos os casos o disco local pode ser limpo.
    if (tipo === 'estimativa_pdf' || tipo === 'contracheque_pdf') {
      await unlinkSilent(file.path)
    }
  }
}

// ─── Endpoint ─────────────────────────────────────────────────────────────────

const CONCURRENCY = 5

/**
 * POST /api/upload-lote
 * Form-data: arquivos[] (até 50), max 20 MB cada
 * Resposta: { total, sucesso, falha, resultados: ItemLoteResultado[] }
 */
export async function uploadLote(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const files = (req.files as Express.Multer.File[] | undefined) ?? []
    if (files.length === 0) throw new AppError(400, 'Nenhum arquivo enviado')

    const tasks = files.map(f => () => processarItem(f, req.user!.id))
    const resultados = await comLimite(tasks, CONCURRENCY)

    const sucesso = resultados.filter(r => r.status === 'sucesso').length
    res.status(201).json({
      total: resultados.length,
      sucesso,
      falha: resultados.length - sucesso,
      resultados,
    })
  } catch (err) {
    next(err)
  }
}
