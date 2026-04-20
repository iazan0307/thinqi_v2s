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
}

async function extrairContracheque(buffer: Buffer): Promise<ContrachequeParsed> {
  const data = await pdfParse(buffer)
  const text = data.text ?? ''

  // CNPJ
  const matchCnpj = text.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|(?<!\d)\d{14}(?!\d)/)
  const cnpj = matchCnpj ? normalizeCnpj(matchCnpj[0]) : null

  // CPF
  const matchCpf = text.match(/\d{3}\.\d{3}\.\d{3}-\d{2}|(?<!\d)\d{11}(?!\d)/)
  const cpf = matchCpf ? normalizeCpf(matchCpf[0]) : null

  // Valor líquido: "Total Líquido\n1.442,69" ou "Líquido: 1.442,69"
  let valor_liquido = 0
  const padroes = [
    /total\s*l[íi]quido[^\d]*([\d.]+,\d{2})/i,
    /l[íi]quido\s*(?:a\s*receber)?[^\d]*([\d.]+,\d{2})/i,
    /valor\s*l[íi]quido[^\d]*([\d.]+,\d{2})/i,
  ]
  for (const re of padroes) {
    const m = text.match(re)
    if (m) { valor_liquido = parseBRL(m[1]); break }
  }

  // Mês de referência: "01/2026" isolado (a data de pagamento 31/01/2026 vira DD/MM/YYYY)
  let mes_ref: Date | null = null
  const reMesIsolada = /(?<!\d\/)(?<!\d)(0[1-9]|1[0-2])\/(\d{4})(?!\/)(?!\d)/g
  const m = reMesIsolada.exec(text)
  if (m) {
    mes_ref = new Date(Date.UTC(parseInt(m[2], 10), parseInt(m[1], 10) - 1, 1))
  }

  return { cnpj, cpf, valor_liquido, mes_ref }
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
  if (!parsed.cpf) {
    throw new AppError(422, 'CPF do funcionário não identificado no contracheque')
  }
  if (!isValidCpf(parsed.cpf)) {
    throw new AppError(422, `CPF extraído (${parsed.cpf}) é inválido`)
  }
  if (parsed.valor_liquido <= 0) {
    throw new AppError(422, 'Valor líquido do pró-labore não identificado no contracheque')
  }

  const empresa = await prisma.empresa.findUnique({ where: { cnpj: parsed.cnpj } })
  if (!empresa) {
    throw new AppError(404, `CNPJ ${parsed.cnpj} do contracheque não está cadastrado — cadastre a empresa primeiro.`)
  }

  // Filtro grosso por prefixo+sufixo dentro da empresa; depois bcrypt.compare
  const { prefixo, sufixo } = extractCpfParts(parsed.cpf)
  const candidatos = await prisma.socio.findMany({
    where: {
      empresa_id:  empresa.id,
      cpf_prefixo: prefixo,
      cpf_sufixo:  sufixo,
      ativo:       true,
    },
  })

  let socio: typeof candidatos[number] | null = null
  for (const c of candidatos) {
    if (await bcrypt.compare(parsed.cpf, c.cpf_hash)) { socio = c; break }
  }

  if (!socio) {
    throw new AppError(
      404,
      `Sócio com CPF informado no contracheque não encontrado em ${empresa.razao_social} — cadastre o sócio antes.`,
    )
  }

  const atualizado = await prisma.socio.update({
    where: { id: socio.id },
    data: {
      tem_prolabore:          true,
      valor_prolabore_mensal: parsed.valor_liquido,
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
