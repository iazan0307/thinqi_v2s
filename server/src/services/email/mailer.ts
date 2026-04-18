/**
 * Serviço de envio de e-mail via Resend.
 * Produção e dev usam a mesma API — sem gambiarra de Ethereal.
 */

import { Resend } from 'resend'

const resend = new Resend(process.env['RESEND_API_KEY'])
const FROM   = process.env['RESEND_FROM'] ?? 'ThinQi <noreply@iazan.com.br>'

// ─── Relatório de Desconforto (com PDF em anexo) ──────────────────────────────

export interface EnvioEmailOptions {
  to: string | string[]
  empresaNome: string
  mesRef: string
  pdfBuffer: Buffer
  pdfFilename: string
}

export async function enviarRelatorio(opts: EnvioEmailOptions): Promise<void> {
  const subject = `Relatório de Desconforto Financeiro — ${opts.empresaNome} — ${opts.mesRef}`

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #1e293b; color: white; padding: 24px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0;">ThinQi — Auditoria Financeira</h2>
        <p style="margin: 4px 0 0; color: #94a3b8; font-size: 13px;">Relatório de Desconforto Financeiro</p>
      </div>
      <div style="background: #f8fafc; padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
        <p style="color: #374151;">Prezado(a),</p>
        <p style="color: #374151;">
          Segue em anexo o Relatório de Desconforto Financeiro de <strong>${opts.empresaNome}</strong>
          referente ao período de <strong>${opts.mesRef}</strong>.
        </p>
        <p style="color: #374151;">
          Este relatório identifica possíveis divergências entre as entradas financeiras
          (banco + cartão) e o faturamento declarado por notas fiscais.
        </p>
        <p style="color: #6b7280; font-size: 12px; margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 16px;">
          Este é um documento confidencial gerado automaticamente pela plataforma ThinQi.
          Em caso de dúvidas, entre em contato com seu contador.
        </p>
      </div>
    </div>
  `

  const { error } = await resend.emails.send({
    from:        FROM,
    to:          Array.isArray(opts.to) ? opts.to : [opts.to],
    subject,
    html,
    attachments: [
      {
        filename: opts.pdfFilename,
        content:  opts.pdfBuffer.toString('base64'),
      },
    ],
  })

  if (error) throw new Error(`Resend: ${error.message}`)
}

// ─── Envio genérico (convites, notificações) ──────────────────────────────────

export async function enviarEmail(opts: {
  to: string
  subject: string
  html: string
}): Promise<void> {
  const { error } = await resend.emails.send({
    from:    FROM,
    to:      [opts.to],
    subject: opts.subject,
    html:    opts.html,
  })

  if (error) throw new Error(`Resend: ${error.message}`)
}
