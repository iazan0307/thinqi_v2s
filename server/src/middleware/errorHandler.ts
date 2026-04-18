import { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Erros de validação Zod
  if (err instanceof ZodError) {
    res.status(422).json({
      error: 'Dados inválidos',
      details: err.errors.map((e) => ({
        campo: e.path.join('.'),
        mensagem: e.message,
      })),
    })
    return
  }

  // Erros de negócio conhecidos
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message })
    return
  }

  // Erros inesperados
  console.error('[UnhandledError]', err)
  res.status(500).json({ error: 'Erro interno do servidor' })
}
