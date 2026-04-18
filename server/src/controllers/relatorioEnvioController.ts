import { Request, Response, NextFunction } from 'express'
import * as fs from 'fs/promises'
import * as path from 'path'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { calcularConciliacao } from '../services/engine/conciliacao'
import { gerarPDFRelatorio } from '../services/report/pdf'
import { enviarRelatorio } from '../services/email/mailer'
import { Role } from '@prisma/client'

/** POST /api/relatorio-desconforto/:id/enviar — Envia PDF para todos os clientes da empresa */
export async function enviarRelatorioEmail(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params

    const relatorio = await prisma.relatorioDesconforto.findUnique({
      where: { id },
      include: {
        empresa: { select: { id: true, razao_social: true, cnpj: true, regime_tributario: true } },
      },
    })

    if (!relatorio) throw new AppError(404, 'Relatório não encontrado')

    // Busca todos os clientes ativos vinculados à empresa
    const clientes = await prisma.usuario.findMany({
      where: { empresa_id: relatorio.empresa_id, role: Role.CLIENTE, ativo: true },
      select: { email: true },
    })

    if (clientes.length === 0) {
      throw new AppError(404, 'Nenhum cliente ativo cadastrado para esta empresa')
    }

    const destinatarios = clientes.map(c => c.email)

    // Tenta ler PDF do disco; se não existir, regera
    let pdfBuffer: Buffer

    if (relatorio.pdf_path) {
      const fullPath = path.join(process.cwd(), 'uploads', relatorio.pdf_path)
      try {
        pdfBuffer = await fs.readFile(fullPath)
      } catch {
        const resultado = await calcularConciliacao(relatorio.empresa_id, relatorio.mes_ref)
        pdfBuffer = await gerarPDFRelatorio(resultado, {
          razao_social: relatorio.empresa.razao_social,
          cnpj: relatorio.empresa.cnpj,
          regime_tributario: relatorio.empresa.regime_tributario,
        })
      }
    } else {
      const resultado = await calcularConciliacao(relatorio.empresa_id, relatorio.mes_ref)
      pdfBuffer = await gerarPDFRelatorio(resultado, {
        razao_social: relatorio.empresa.razao_social,
        cnpj: relatorio.empresa.cnpj,
        regime_tributario: relatorio.empresa.regime_tributario,
      })
    }

    const mes = new Date(relatorio.mes_ref).toLocaleDateString('pt-BR', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    })

    const mesSlug = new Date(relatorio.mes_ref).toISOString().slice(0, 7)

    await enviarRelatorio({
      to: destinatarios,
      empresaNome: relatorio.empresa.razao_social,
      mesRef: mes,
      pdfBuffer,
      pdfFilename: `relatorio_desconforto_${mesSlug}.pdf`,
    })

    await prisma.relatorioDesconforto.update({
      where: { id },
      data: { enviado_em: new Date() },
    })

    res.json({ enviado: true, destinatarios })
  } catch (err) {
    next(err)
  }
}
