/**
 * Parser OFX (SGML / XML) — formato usado pelos bancos brasileiros.
 *
 * Extrai por transação:
 *   - descricao : campo MEMO completo
 *   - nome_contraparte : campo NAME (quando presente — ex: Banco Inter)
 *   - cpf_raw : CPF completo encontrado na descrição (11 dígitos, sem pontuação)
 */

export interface OFXMeta {
  /** CNPJ do titular da conta — 14 dígitos sem pontuação, ou null quando não encontrado */
  cnpj_detectado: string | null
  /** Identificação da conta — quando presente, é a chave primária de roteamento */
  identificacao: OFXIdentificacao | null
}

export interface OFXIdentificacao {
  /** Código FEBRABAN do banco (BANKID do OFX). Ex: "237", "077", "341" */
  bank_id: string
  /** Nome do banco para exibição (resolvido via tabela BANK_NAMES, com fallback genérico) */
  bank_name: string
  /** Número da conta normalizado: sem hífen, espaços, letras */
  acct_id: string
  /** Número da conta como aparece no OFX original (preserva dígito/hífen para auditoria) */
  acct_id_display: string
  /** Agência (BRANCHID do OFX), quando presente */
  agencia?: string
  /** Tipo da conta (ACCTTYPE): "CHECKING", "SAVINGS", "MONEYMRKT", etc. */
  account_type?: string
  /** Nome do organizador (FI/ORG) — geralmente o nome do banco emissor do OFX */
  org?: string
}

export interface OFXParseResult {
  meta: OFXMeta
  transacoes: TransacaoParseada[]
}

// Tabela FEBRABAN dos bancos mais comuns no Brasil. Não é exaustiva — bancos
// não mapeados aqui caem no fallback "Banco {bankId}".
const BANK_NAMES: Record<string, string> = {
  '001': 'Banco do Brasil',
  '033': 'Santander',
  '041': 'Banrisul',
  '070': 'BRB',
  '077': 'Inter',
  '104': 'Caixa Econômica',
  '212': 'Banco Original',
  '237': 'Bradesco',
  '260': 'Nubank',
  '290': 'PagBank',
  '323': 'Mercado Pago',
  '336': 'C6 Bank',
  '341': 'Itaú',
  '380': 'PicPay',
  '422': 'Safra',
  '745': 'Citibank',
  '748': 'Sicredi',
  '756': 'Sicoob',
}

export function nomeBanco(bankId: string): string {
  return BANK_NAMES[bankId.padStart(3, '0')] ?? BANK_NAMES[bankId] ?? `Banco ${bankId}`
}

export interface TransacaoParseada {
  data: Date
  descricao: string          // campo MEMO ou NAME como fallback
  nome_contraparte?: string  // campo NAME isolado (ex: "Caroline Silva Senra")
  cpf_raw?: string           // CPF limpo se encontrado na descrição ("02774260736")
  valor: number              // sempre positivo
  tipo: 'ENTRADA' | 'SAIDA'
  fitid?: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseOfxDate(dateStr: string): Date {
  const cleaned = dateStr.replace(/\[.*\]/, '').trim()
  const year  = parseInt(cleaned.slice(0, 4), 10)
  const month = parseInt(cleaned.slice(4, 6), 10) - 1
  const day   = parseInt(cleaned.slice(6, 8), 10)
  return new Date(Date.UTC(year, month, day))
}

function extractTag(block: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}>([^<\n\r]*)`, 'i')
  const match = regex.exec(block)
  return match ? match[1].trim() : null
}

function mapTrnType(trntype: string, valor: number): 'ENTRADA' | 'SAIDA' {
  const type = trntype.toUpperCase()
  if (['CREDIT', 'DEP', 'INT', 'DIV'].includes(type) || valor > 0) return 'ENTRADA'
  return 'SAIDA'
}

/**
 * Tenta extrair um CPF completo de uma string de texto.
 * Formatos aceitos: "027.742.607-36", "02774260736", "027 742 607 36"
 * Retorna somente os 11 dígitos limpos ou undefined.
 */
function extractCpfFromText(text: string): string | undefined {
  // Formato com pontuação: DDD.DDD.DDD-DD
  const withPunctuation = /\b(\d{3})[.\-\s](\d{3})[.\-\s](\d{3})[.\-\s](\d{2})\b/g
  let m = withPunctuation.exec(text)
  if (m) {
    const digits = m[1] + m[2] + m[3] + m[4]
    if (digits.length === 11) return digits
  }

  // Sequência pura de 11 dígitos (sem letras adjacentes)
  const pure = /(?<!\d)(\d{11})(?!\d)/g
  while ((m = pure.exec(text)) !== null) {
    const digits = m[1]
    // Descarta sequências triviais (00000000000, 11111111111…)
    if (/^(\d)\1{10}$/.test(digits)) continue
    return digits
  }

  return undefined
}

// ─── Identificação da conta (BANKID + ACCTID) ────────────────────────────────

/**
 * Normaliza o ACCTID removendo hífen, espaço, dígitos verificadores em letra
 * e qualquer caractere não-numérico. Em alguns bancos o OFX traz "12345-6"
 * (com dígito) e em outros "123456" sem ele — normalizar para um formato
 * único garante que duas exportações da mesma conta colidam corretamente
 * no índice (bank_id, acct_id) da tabela ContaBancaria.
 */
function normalizeAcctId(raw: string): string {
  return raw.replace(/\s+/g, '').replace(/-/g, '').replace(/[a-zA-Z]/g, '').trim()
}

function readTag(content: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([^<\\n\\r]+)`, 'i')
  const m = re.exec(content)
  return m ? m[1].trim() : null
}

/**
 * Extrai a identificação da conta do OFX (BANKID + ACCTID + extras).
 * Esta é a fonte de verdade para roteamento automático no upload em lote —
 * cruza com `ContaBancaria` para descobrir a empresa dona do extrato.
 *
 * Retorna `null` se BANKID ou ACCTID estiverem ausentes — o caller decide
 * se é erro fatal ou se há fallback (ex: CNPJ no OFX, hint manual).
 */
export function extractOFXIdentificacao(content: string): OFXIdentificacao | null {
  const bankId = readTag(content, 'BANKID')
  const acctRaw = readTag(content, 'ACCTID')
  if (!bankId || !acctRaw) return null

  const acct_id = normalizeAcctId(acctRaw)
  if (!acct_id) return null

  const branch = readTag(content, 'BRANCHID')
  const accType = readTag(content, 'ACCTTYPE')
  const org = readTag(content, 'ORG')

  return {
    bank_id: bankId,
    bank_name: nomeBanco(bankId),
    acct_id,
    acct_id_display: acctRaw,
    agencia: branch ?? undefined,
    account_type: accType ?? undefined,
    org: org ?? undefined,
  }
}

// ─── Detecção de CNPJ do titular (fallback secundário) ────────────────────────

/**
 * Tenta extrair o CNPJ do titular do OFX. Os bancos brasileiros NÃO seguem um
 * padrão único — diferentes locais do header carregam o documento conforme o
 * banco emissor:
 *   - <BANKACCTFROM><ACCTID> (geralmente é só nº da conta, mas alguns colocam CNPJ)
 *   - Tags customizadas: <CPFCNPJ>, <DOC>, <CNPJ>, <TAXID>
 *   - Texto livre dentro de <SIGNONMSGSRSV1><FI><ORG>
 *   - Comentário com "CNPJ: 12.345.678/0001-99" no preâmbulo
 *
 * Estratégia: varre o conteúdo inteiro pelo padrão de CNPJ válido (formatado
 * ou 14 dígitos consecutivos), descarta sequências triviais e devolve a primeira
 * ocorrência. Não usa o nome do arquivo — esse é input humano não confiável.
 */
export function extractCNPJfromOFX(content: string): string | null {
  // 1) CNPJ formatado tem prioridade (mais difícil de colidir com nº de conta)
  const reFormatado = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/
  const m1 = reFormatado.exec(content)
  if (m1) return m1[0].replace(/\D/g, '')

  // 2) CNPJ "puro" — procura primeiro dentro de tags conhecidas
  const tagsCandidatas = ['CPFCNPJ', 'CNPJ', 'TAXID', 'DOC', 'CGC']
  for (const tag of tagsCandidatas) {
    const re = new RegExp(`<${tag}>\\s*(\\d{14})(?!\\d)`, 'i')
    const m = re.exec(content)
    if (m && !/^(\d)\1{13}$/.test(m[1])) return m[1]
  }

  // 3) Fallback: 14 dígitos consecutivos em qualquer lugar (descarta repetidos
  // e CPFs adjacentes que poderiam casar acidentalmente)
  const rePuro = /(?<!\d)(\d{14})(?!\d)/g
  let m
  while ((m = rePuro.exec(content)) !== null) {
    const digits = m[1]
    if (/^(\d)\1{13}$/.test(digits)) continue
    return digits
  }

  return null
}

// ─── Parser principal ─────────────────────────────────────────────────────────

/**
 * Parseia o conteúdo do OFX devolvendo transações + metadados (CNPJ detectado).
 * Use esta função quando precisar rotear o arquivo automaticamente; o legado
 * `parseOFX(content)` continua disponível e devolve apenas as transações.
 */
export function parseOFXWithMeta(content: string): OFXParseResult {
  return {
    meta: {
      cnpj_detectado: extractCNPJfromOFX(content),
      identificacao: extractOFXIdentificacao(content),
    },
    transacoes: parseOFX(content),
  }
}

export function parseOFX(content: string): TransacaoParseada[] {
  const transactions: TransacaoParseada[] = []

  const stmtPattern = /<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi

  let match
  while ((match = stmtPattern.exec(content)) !== null) {
    const block = match[1]

    const trntype  = extractTag(block, 'TRNTYPE')
    const dtposted = extractTag(block, 'DTPOSTED')
    const trnamt   = extractTag(block, 'TRNAMT')
    const memo     = extractTag(block, 'MEMO')
    const name     = extractTag(block, 'NAME')
    const fitid    = extractTag(block, 'FITID') ?? undefined

    if (!dtposted || !trnamt) continue

    const valorRaw = parseFloat(trnamt.replace(',', '.'))
    if (isNaN(valorRaw)) continue

    const tipo = mapTrnType(trntype ?? '', valorRaw)

    // descricao = MEMO se existir, senão NAME
    const descricao = memo ?? name ?? ''

    // nome_contraparte = NAME quando existe e é diferente do MEMO
    const nome_contraparte = (name && name !== memo) ? name : undefined

    // Tenta extrair CPF do texto completo disponível
    const textoBusca = [memo, name].filter(Boolean).join(' ')
    const cpf_raw    = extractCpfFromText(textoBusca)

    transactions.push({
      data: parseOfxDate(dtposted),
      descricao,
      nome_contraparte,
      cpf_raw,
      valor: Math.abs(valorRaw),
      tipo,
      fitid,
    })
  }

  return transactions
}
