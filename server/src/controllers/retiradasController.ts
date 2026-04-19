import { Request, Response, NextFunction } from 'express'
import ExcelJS from 'exceljs'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { Role, PerfilCliente } from '@prisma/client'
import { calcularIrDevido, STATUS_DISTRIBUICAO } from '../utils/distribuicao'

/** Perfil ADMINISTRATIVO: cliente com acesso restrito não consulta retiradas */
async function bloqueiaAdministrativo(userId: string, role: Role): Promise<boolean> {
  if (role !== Role.CLIENTE) return false
  const u = await prisma.usuario.findUnique({
    where: { id: userId },
    select: { perfil_cliente: true },
  })
  return u?.perfil_cliente === PerfilCliente.ADMINISTRATIVO
}

export async function listRetiradas(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const {
      empresa_id,
      mes_ref,
      alerta_limite,
      page: pageStr = '1',
      limit: limitStr = '20',
    } = req.query as Record<string, string>

    const page = Math.max(1, parseInt(pageStr, 10))
    const limit = Math.min(100, Math.max(1, parseInt(limitStr, 10)))

    const user = req.user!
    if (await bloqueiaAdministrativo(user.id, user.role)) {
      throw new AppError(403, 'Perfil administrativo não tem acesso às retiradas de sócios')
    }
    // Clientes só veem dados da própria empresa
    const effectiveEmpresaId =
      user.role === Role.CLIENTE ? user.empresa_id! : empresa_id

    const where: Record<string, unknown> = {}
    if (effectiveEmpresaId) where['empresa_id'] = effectiveEmpresaId
    if (mes_ref) where['mes_ref'] = new Date(mes_ref)
    if (alerta_limite !== undefined) where['alerta_limite'] = alerta_limite === 'true'

    const [total, retiradas] = await Promise.all([
      prisma.retiradaSocio.count({ where }),
      prisma.retiradaSocio.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ mes_ref: 'desc' }, { valor_total: 'desc' }],
        include: {
          socio: { select: { nome: true, cpf_mascara: true, valor_prolabore_mensal: true } },
          empresa: { select: { razao_social: true } },
        },
      }),
    ])

    const data = retiradas.map(r => {
      const valor = Number(r.valor_total)
      const prolabore = Number(r.socio.valor_prolabore_mensal ?? 0)
      const valorDistribuicao = Math.max(0, valor - prolabore)
      return {
        ...r,
        valor_prolabore: prolabore,
        valor_distribuicao: valorDistribuicao,
        ir_devido: calcularIrDevido(valorDistribuicao),
        status_distribuicao: r.alerta_limite
          ? STATUS_DISTRIBUICAO.TRIBUTADA
          : STATUS_DISTRIBUICAO.ISENTA,
      }
    })

    res.json({
      data,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    next(err)
  }
}

export async function exportRetiradas(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { fmt } = req.params as { fmt: string }
    if (!['csv', 'xlsx'].includes(fmt)) {
      throw new AppError(400, 'Formato inválido. Use: csv ou xlsx')
    }

    const { empresa_id, mes_ref, alerta_limite } = req.query as Record<string, string>

    const user = req.user!
    if (await bloqueiaAdministrativo(user.id, user.role)) {
      throw new AppError(403, 'Perfil administrativo não tem acesso às retiradas de sócios')
    }
    const effectiveEmpresaId =
      user.role === Role.CLIENTE ? user.empresa_id! : empresa_id

    const where: Record<string, unknown> = {}
    if (effectiveEmpresaId) where['empresa_id'] = effectiveEmpresaId
    if (mes_ref) where['mes_ref'] = new Date(mes_ref)
    if (alerta_limite !== undefined) where['alerta_limite'] = alerta_limite === 'true'

    const retiradas = await prisma.retiradaSocio.findMany({
      where,
      orderBy: [{ mes_ref: 'desc' }, { valor_total: 'desc' }],
      include: {
        socio: { select: { nome: true, cpf_mascara: true, valor_prolabore_mensal: true } },
        empresa: { select: { razao_social: true } },
      },
    })

    if (fmt === 'csv') {
      const header = 'Empresa,Sócio,CPF,Mês Referência,Valor Total (R$),Pró-labore (R$),Distribuição (R$),Qtd Transferências,Status,IR Devido (R$)'
      const rows = retiradas.map(r => {
        const mesRef = new Date(r.mes_ref)
        const mesStr = `${String(mesRef.getUTCMonth() + 1).padStart(2, '0')}/${mesRef.getUTCFullYear()}`
        const valor = Number(r.valor_total)
        const prolabore = Number(r.socio.valor_prolabore_mensal ?? 0)
        const distribuicao = Math.max(0, valor - prolabore)
        const ir = calcularIrDevido(distribuicao)
        const status = r.alerta_limite
          ? STATUS_DISTRIBUICAO.TRIBUTADA
          : STATUS_DISTRIBUICAO.ISENTA
        return [
          `"${r.empresa.razao_social}"`,
          `"${r.socio.nome}"`,
          `"${r.socio.cpf_mascara}"`,
          mesStr,
          valor.toFixed(2).replace('.', ','),
          prolabore.toFixed(2).replace('.', ','),
          distribuicao.toFixed(2).replace('.', ','),
          r.qtd_transferencias,
          `"${status}"`,
          ir.toFixed(2).replace('.', ','),
        ].join(',')
      })

      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', 'attachment; filename="retiradas.csv"')
      // BOM para o Excel reconhecer UTF-8
      res.send('\uFEFF' + header + '\n' + rows.join('\n'))
      return
    }

    // ─── XLSX ──────────────────────────────────────────────────────────────
    const wb = new ExcelJS.Workbook()
    wb.creator = 'ThinQi'
    wb.created = new Date()

    const ws = wb.addWorksheet('Retiradas')
    ws.columns = [
      { header: 'Empresa',             key: 'empresa',         width: 32 },
      { header: 'Sócio',               key: 'socio',           width: 28 },
      { header: 'CPF',                 key: 'cpf',             width: 18 },
      { header: 'Mês Referência',      key: 'mes',             width: 14 },
      { header: 'Valor Total (R$)',    key: 'valor',           width: 16 },
      { header: 'Pró-labore (R$)',     key: 'prolabore',       width: 16 },
      { header: 'Distribuição (R$)',   key: 'distribuicao',    width: 18 },
      { header: 'Qtd Transferências',  key: 'qtd',             width: 18 },
      { header: 'Status',              key: 'status',          width: 24 },
      { header: 'IR Devido (R$)',      key: 'ir',              width: 16 },
    ]
    ws.getRow(1).font = { bold: true }

    for (const r of retiradas) {
      const mesRef = new Date(r.mes_ref)
      const mesStr = `${String(mesRef.getUTCMonth() + 1).padStart(2, '0')}/${mesRef.getUTCFullYear()}`
      const valor  = Number(r.valor_total)
      const prolabore = Number(r.socio.valor_prolabore_mensal ?? 0)
      const distribuicao = Math.max(0, valor - prolabore)
      const ir     = calcularIrDevido(distribuicao)
      const status = r.alerta_limite
        ? STATUS_DISTRIBUICAO.TRIBUTADA
        : STATUS_DISTRIBUICAO.ISENTA

      ws.addRow({
        empresa: r.empresa.razao_social,
        socio:   r.socio.nome,
        cpf:     r.socio.cpf_mascara,
        mes:     mesStr,
        valor,
        prolabore,
        distribuicao,
        qtd:     r.qtd_transferencias,
        status,
        ir,
      })
    }

    ws.getColumn('valor').numFmt        = 'R$ #,##0.00'
    ws.getColumn('prolabore').numFmt    = 'R$ #,##0.00'
    ws.getColumn('distribuicao').numFmt = 'R$ #,##0.00'
    ws.getColumn('ir').numFmt           = 'R$ #,##0.00'

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    res.setHeader('Content-Disposition', 'attachment; filename="retiradas.xlsx"')
    await wb.xlsx.write(res)
    res.end()
  } catch (err) {
    next(err)
  }
}
