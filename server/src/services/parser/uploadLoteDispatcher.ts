/**
 * Dispatcher do upload em lote unificado.
 *
 * Responsabilidades:
 *   1. Detectar o tipo do arquivo a partir da extensão + sniffing leve do conteúdo
 *   2. Não confiar no nome — em particular, OFX usa CNPJ interno (ver parser ofx.ts)
 *   3. Devolver um descriptor que o controller usa para escolher o handler
 *
 * Não faz parsing do conteúdo de domínio — só inspeciona o suficiente para
 * decidir qual handler chamar. O parsing real fica nos parsers específicos.
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import ExcelJS from 'exceljs'

export type TipoLote =
  | 'extrato_ofx'
  | 'extrato_csv'
  | 'cartao'
  | 'faturamento_iazan'
  | 'estimativa_pdf'
  | 'contracheque_pdf'
  | 'desconhecido'

export interface DetectarResultado {
  tipo: TipoLote
  /** Mensagem informativa quando o tipo é "desconhecido" — usada na resposta de erro */
  motivo?: string
}

const RE_BANDEIRA = /\bbandeira\b/i
const RE_VALOR_BRUTO_LIQUIDO = /\bvalor\s*(bruto|l[íi]quido|da\s+venda)\b/i
// Cabeçalho típico da planilha IAZAN — basta uma destas marcações
const RE_IAZAN = /(emitente\s*cnpj|data\s*da\s*compet[êe]ncia|valor\s*servi[cç]o)/i

function snifTexto(s: string): string {
  return s.toLowerCase()
}

async function snifPDF(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath)
  // Lê o texto do PDF — pdf-parse é tolerante e devolve o texto consolidado.
  // Não importamos parses específicos aqui pra não acoplar o dispatcher aos
  // controllers; a heurística é suficiente para distinguir contracheque vs estimativa.
  const pdfParse = (await import('pdf-parse')).default
  try {
    const data = await pdfParse(buf)
    return data.text ?? ''
  } catch {
    return ''
  }
}

async function snifPlanilha(filePath: string): Promise<string> {
  // Lê só as primeiras 30 linhas da primeira aba como string concatenada
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)
  const sheet = wb.worksheets[0]
  if (!sheet) return ''
  const partes: string[] = []
  let count = 0
  sheet.eachRow((row) => {
    if (count >= 30) return
    const vals = (row.values as ExcelJS.CellValue[]).slice(1)
    partes.push(vals.map(v => (v == null ? '' : String(typeof v === 'object' && 'text' in v ? (v as { text: string }).text : v))).join(' | '))
    count++
  })
  return partes.join('\n')
}

async function snifCSV(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath, 'latin1')
  // Primeiras 30 linhas
  return content.split(/\r?\n/).slice(0, 30).join('\n')
}

/** Detecta o tipo do arquivo a partir da extensão + conteúdo. */
export async function detectarTipoLote(file: {
  originalname: string
  path: string
}): Promise<DetectarResultado> {
  const ext = path.extname(file.originalname).toLowerCase()

  // OFX — extensão é suficiente; o conteúdo de bancos brasileiros é SGML/XML
  if (ext === '.ofx') return { tipo: 'extrato_ofx' }

  if (ext === '.pdf') {
    const txt = snifTexto(await snifPDF(file.path))
    // Contracheque tem termos específicos da folha de pagamento
    if (
      txt.includes('pró-labore') ||
      txt.includes('prolabore') ||
      txt.includes('pro-labore') ||
      txt.includes('contracheque') ||
      txt.includes('total líquido') ||
      txt.includes('total liquido') ||
      txt.includes('líquido a receber')
    ) {
      return { tipo: 'contracheque_pdf' }
    }
    // Default para PDFs: estimativa de impostos. Se o conteúdo não tiver
    // CNPJ + valor numérico válido, o handler já devolve erro claro.
    return { tipo: 'estimativa_pdf' }
  }

  if (ext === '.xlsx' || ext === '.xls') {
    const txt = snifTexto(await snifPlanilha(file.path))
    if (RE_BANDEIRA.test(txt) && RE_VALOR_BRUTO_LIQUIDO.test(txt)) {
      return { tipo: 'cartao' }
    }
    if (RE_IAZAN.test(txt)) {
      return { tipo: 'faturamento_iazan' }
    }
    return {
      tipo: 'desconhecido',
      motivo: 'Planilha sem cabeçalho reconhecido (esperado: cartão com "Bandeira+Valor" ou IAZAN com "Emitente CNPJ").',
    }
  }

  if (ext === '.csv') {
    const txt = snifTexto(await snifCSV(file.path))
    if (RE_BANDEIRA.test(txt) && RE_VALOR_BRUTO_LIQUIDO.test(txt)) {
      return { tipo: 'cartao' }
    }
    if (RE_IAZAN.test(txt)) {
      return { tipo: 'faturamento_iazan' }
    }
    // CSV genérico de extrato bancário — só funciona se houver hint manual
    return { tipo: 'extrato_csv' }
  }

  if (ext === '.xml') {
    return {
      tipo: 'desconhecido',
      motivo: 'Importação de XML avulso de NF não é suportada no lote — use o upload de Faturamento (planilha IAZAN consolidada).',
    }
  }

  return {
    tipo: 'desconhecido',
    motivo: `Extensão "${ext || '(sem extensão)'}" não suportada. Aceitos: .ofx, .csv, .xlsx, .pdf`,
  }
}
