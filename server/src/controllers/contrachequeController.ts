/**
 * Contracheque de Pró-labore — upload de PDF que:
 *   1. Extrai CNPJ (empresa), CPF (sócio) e valor líquido do contracheque
 *   2. Rota por CNPJ → Empresa
 *   3. Identifica sócio por CPF (prefixo+sufixo filtrando + bcrypt.compare)
 *   4. Marca socio.tem_prolabore = true e atualiza valor_prolabore_mensal
 *
 * O PDF NÃO é arquivado — só extraímos e persistimos os campos. Isso evita
 * guardar CPF em claro (o texto do contracheque contém CPF não mascarado).
 */

import { Request, Response, NextFunction } from 'express'
import pdfParse from 'pdf-parse'
import bcrypt from 'bcryptjs'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { normalizeCpf, extractCpfParts, isValidCpf } from '../utils/cpf'

function normalizeCnpj(cnpj: string): string {
  return cnpj.replace(/\D/g, '')
}

function parseBRL(s: string): number {
  const clean = s.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.')
  const n = parseFloat(clean)
  return isNaN(n) ? 0 : n
}

export interface ContrachequeParsed {
  cnpj: string | null
  cpf: string | null       // 11 dígitos (será descartado após o matching)
  valor_liquido: number
  mes_ref: Date | null
  // CPFs encontrados no PDF (todos), na ordem em que aparecem.
  // Permite ao chamador casar com sócios cadastrados quando o
  // primeiro CPF do PDF é de funcionário (não-sócio).
  cpfs_no_pdf?: string[]
  // Texto bruto + páginas — usado por aplicarContracheque para extrair
  // o valor líquido perto do CPF do sócio (em PDFs com várias páginas).
  paginas?: string[]
}

const RE_CPF = /\d{3}\.\d{3}\.\d{3}-\d{2}|(?<!\d)\d{11}(?!\d)/g

const PADROES_LIQUIDO: RegExp[] = [
  /total\s*l[íi]quido[^\d]*([\d.]+,\d{2})/i,
  /l[íi]quido\s*(?:a\s*receber)?[^\d]*([\d.]+,\d{2})/i,
  /valor\s*l[íi]quido[^\d]*([\d.]+,\d{2})/i,
]

function extrairValorLiquido(texto: string): number {
  for (const re of PADROES_LIQUIDO) {
    const m = texto.match(re)
    if (m) return parseBRL(m[1])
  }
  return 0
}

/**
 * pdf-parse retorna o texto inteiro concatenado, sem marcadores de página
 * confiáveis. Usamos `pagerender` para coletar o texto de cada página
 * separadamente — necessário porque um contracheque pode ter o sócio na
 * 2ª/3ª página (com funcionários nas demais).
 */
interface PdfPageItem { str: string }
interface PdfTextContent { items: PdfPageItem[] }
interface PdfPage {
  getTextContent(opts: { normalizeWhitespace: boolean; disableCombineTextItems: boolean }): Promise<PdfTextContent>
}

async function extrairPaginas(buffer: Buffer): Promise<string[]> {
  const paginas: string[] = []
  await pdfParse(buffer, {
    pagerender: async (pageData: PdfPage) => {
      const tc = await pageData.getTextContent({
        normalizeWhitespace: true,
        disableCombineTextItems: false,
      })
      const txt = tc.items.map(it => it.str).join('\n')
      paginas.push(txt)
      return txt
    },
  })
  return paginas
}

/**
 * Pipeline público: a partir do buffer do PDF, extrai os campos e aplica
 * (resolve empresa+sócio, atualiza pró-labore). Usado pelo lote unificado.
 */
export async function processarContrachequeBuffer(params: {
  buffer: Buffer
  originalname: string
}): Promise<{
  empresa_id: string
  empresa_razao: string
  socio_id: string
  socio_nome: string
  cpf_mascara: string
  valor_prolabore_mensal: number
  mes_ref: string | null
}> {
  const parsed = await extrairContracheque(params.buffer)
  return aplicarContracheque(parsed)
}

async function extrairContracheque(buffer: Buffer): Promise<ContrachequeParsed> {
  const data = await pdfParse(buffer)
  const text = data.text ?? ''

  // CNPJ — mesmo em PDFs com várias páginas, o CNPJ do empregador costuma
  // aparecer no cabeçalho de cada uma; pegamos a primeira ocorrência.
  const matchCnpj = text.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|(?<!\d)\d{14}(?!\d)/)
  const cnpj = matchCnpj ? normalizeCnpj(matchCnpj[0]) : null

  // Coleta TODOS os CPFs do PDF (não apenas o primeiro).
  // Em contracheques com múltiplos beneficiários (sócio + funcionários),
  // o aplicarContracheque escolhe o que casa com um sócio cadastrado.
  const cpfs_no_pdf = Array.from(
    new Set(
      Array.from(text.matchAll(RE_CPF)).map(m => normalizeCpf(m[0])),
    ),
  )
  const cpf = cpfs_no_pdf[0] ?? null

  // Coleta texto por página para extrair o valor líquido perto do CPF correto
  let paginas: string[] = []
  try {
    paginas = await extrairPaginas(buffer)
  } catch {
    // Fallback: divide o texto em "páginas" pelas form-feeds que pdf-parse
    // ocasionalmente emite, ou usa o texto inteiro como única página.
    paginas = text.split(/\f/).filter(Boolean)
    if (paginas.length === 0) paginas = [text]
  }

  // Valor líquido (fallback global): primeira ocorrência no texto inteiro.
  // Pode ser sobrescrito em aplicarContracheque ao extrair perto do CPF do sócio.
  const valor_liquido = extrairValorLiquido(text)

  // Mês de referência: "01/2026" isolado (a data de pagamento 31/01/2026 vira DD/MM/YYYY)
  let mes_ref: Date | null = null
  const reMesIsolada = /(?<!\d\/)(?<!\d)(0[1-9]|1[0-2])\/(\d{4})(?!\/)(?!\d)/g
  const m = reMesIsolada.exec(text)
  if (m) {
    mes_ref = new Date(Date.UTC(parseInt(m[2], 10), parseInt(m[1], 10) - 1, 1))
  }

  return { cnpj, cpf, valor_liquido, mes_ref, cpfs_no_pdf, paginas }
}

/**
 * Aplica o contracheque extraído: resolve empresa+sócio e atualiza pró-labore.
 * Retorna resumo com sócio vinculado (sem vazar CPF em claro).
 */
async function aplicarContracheque(parsed: ContrachequeParsed): Promise<{
  empresa_id: string
  empresa_razao: string
  socio_id: string
  socio_nome: string
  cpf_mascara: string
  valor_prolabore_mensal: number
  mes_ref: string | null
}> {
  if (!parsed.cnpj) {
    throw new AppError(422, 'CNPJ do empregador não identificado no contracheque')
  }

  const empresa = await prisma.empresa.findUnique({ where: { cnpj: parsed.cnpj } })
  if (!empresa) {
    throw new AppError(404, `CNPJ ${parsed.cnpj} do contracheque não está cadastrado — cadastre a empresa primeiro.`)
  }

  // Coleta todos os CPFs distintos no PDF (válidos). Ordem importa: o
  // primeiro CPF que casa com um sócio cadastrado é o escolhido.
  const cpfsValidos = (parsed.cpfs_no_pdf ?? (parsed.cpf ? [parsed.cpf] : []))
    .filter(c => isValidCpf(c))
  if (cpfsValidos.length === 0) {
    throw new AppError(422, 'Nenhum CPF válido identificado no contracheque')
  }

  // Carrega TODOS os sócios ativos da empresa. O matching contra cada CPF
  // do PDF é feito por prefixo+sufixo + bcrypt para respeitar LGPD.
  const socios = await prisma.socio.findMany({
    where: { empresa_id: empresa.id, ativo: true },
    select: {
      id: true, nome: true, cpf_hash: true, cpf_prefixo: true, cpf_sufixo: true, cpf_mascara: true,
    },
  })

  type SocioMin = typeof socios[number]
  let socio: SocioMin | null = null
  let cpfDoSocio: string | null = null

  for (const cpfPdf of cpfsValidos) {
    const { prefixo, sufixo } = extractCpfParts(cpfPdf)
    const candidatos = socios.filter(s => s.cpf_prefixo === prefixo && s.cpf_sufixo === sufixo)
    for (const c of candidatos) {
      if (await bcrypt.compare(cpfPdf, c.cpf_hash)) {
        socio = c
        cpfDoSocio = cpfPdf
        break
      }
    }
    if (socio) break
  }

  if (!socio || !cpfDoSocio) {
    throw new AppError(
      404,
      `CPF do sócio não identificado em nenhuma página do documento (${empresa.razao_social}). ` +
      `Verifique se o sócio está cadastrado.`,
    )
  }

  // Extrai o valor líquido da página onde o CPF do sócio aparece.
  // Se não houver páginas separadas, cai no valor extraído do texto inteiro.
  let valorLiquido = parsed.valor_liquido
  const paginas = parsed.paginas ?? []
  if (paginas.length > 0) {
    for (const pag of paginas) {
      const cpfsNaPagina = Array.from(pag.matchAll(RE_CPF)).map(m => normalizeCpf(m[0]))
      if (cpfsNaPagina.includes(cpfDoSocio)) {
        const v = extrairValorLiquido(pag)
        if (v > 0) { valorLiquido = v; break }
      }
    }
  }

  if (valorLiquido <= 0) {
    throw new AppError(422, 'Valor líquido do pró-labore não identificado no contracheque')
  }

  const atualizado = await prisma.socio.update({
    where: { id: socio.id },
    data: {
      tem_prolabore:          true,
      valor_prolabore_mensal: valorLiquido,
    },
    select: {
      id:                     true,
      nome:                   true,
      cpf_mascara:            true,
      valor_prolabore_mensal: true,
    },
  })

  return {
    empresa_id:             empresa.id,
    empresa_razao:          empresa.razao_social,
    socio_id:               atualizado.id,
    socio_nome:             atualizado.nome,
    cpf_mascara:            atualizado.cpf_mascara,
    valor_prolabore_mensal: Number(atualizado.valor_prolabore_mensal),
    mes_ref:                parsed.mes_ref?.toISOString().slice(0, 7) ?? null,
  }
}

/** POST /api/contracheque/upload — arquivo único */
export async function uploadContracheque(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const file = req.file
    if (!file) throw new AppError(400, 'Arquivo PDF obrigatório')
    if (!file.buffer) throw new AppError(500, 'Upload precisa estar em memória (memoryStorage)')

    const parsed = await extrairContracheque(file.buffer)
    const resultado = await aplicarContracheque(parsed)
    res.status(200).json({ ...resultado, nome_original: file.originalname })
  } catch (err) {
    next(err)
  }
}

/** POST /api/contracheque/upload/lote — múltiplos PDFs */
export async function uploadContrachequeLote(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const files = (req.files as Express.Multer.File[] | undefined) ?? []
    if (files.length === 0) throw new AppError(400, 'Nenhum arquivo enviado')

    const resultados = await Promise.all(
      files.map(async file => {
        try {
          if (!file.buffer) throw new AppError(500, 'Upload precisa estar em memória')
          const parsed = await extrairContracheque(file.buffer)
          const r = await aplicarContracheque(parsed)
          return {
            nome_original:          file.originalname,
            status:                 'sucesso' as const,
            empresa_razao:          r.empresa_razao,
            socio_nome:             r.socio_nome,
            cpf_mascara:            r.cpf_mascara,
            valor_prolabore_mensal: r.valor_prolabore_mensal,
            mes_ref:                r.mes_ref,
            erro:                   null,
          }
        } catch (e) {
          return {
            nome_original:          file.originalname,
            status:                 'erro' as const,
            empresa_razao:          null,
            socio_nome:             null,
            cpf_mascara:            null,
            valor_prolabore_mensal: 0,
            mes_ref:                null,
            erro:                   e instanceof Error ? e.message : 'Erro desconhecido',
          }
        }
      }),
    )

    const sucesso = resultados.filter(r => r.status === 'sucesso').length
    res.status(201).json({
      total:      resultados.length,
      sucesso,
      falha:      resultados.length - sucesso,
      resultados,
    })
  } catch (err) {
    next(err)
  }
}
