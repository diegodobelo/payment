import type { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';

/**
 * Base application error class.
 */
export class AppError extends Error {
  constructor(
    public code: string,
    public override message: string,
    public statusCode: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * Validation error for invalid request data.
 */
export class ValidationError extends AppError {
  constructor(zodError: ZodError) {
    const details = zodError.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    super('VALIDATION_ERROR', 'Invalid request data', 400, details);
    this.name = 'ValidationError';
  }
}

/**
 * Not found error for missing resources.
 */
export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super('NOT_FOUND', `${resource} not found: ${id}`, 404);
    this.name = 'NotFoundError';
  }
}

/**
 * Conflict error for duplicate resources.
 */
export class ConflictError extends AppError {
  constructor(message: string, existingId?: string) {
    super(
      'CONFLICT',
      message,
      409,
      existingId ? { existingId } : undefined
    );
    this.name = 'ConflictError';
  }
}

/**
 * Unprocessable entity error for invalid state transitions.
 */
export class UnprocessableError extends AppError {
  constructor(message: string) {
    super('UNPROCESSABLE_ENTITY', message, 422);
    this.name = 'UnprocessableError';
  }
}

/**
 * Error response format.
 */
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
}

/**
 * Global error handler for Fastify.
 */
export function errorHandler(
  error: FastifyError | AppError | Error,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  const requestId = request.id;

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    const validationError = new ValidationError(error);
    request.log.warn({ err: error, requestId }, 'Validation error');
    const response: ErrorResponse = {
      error: {
        code: validationError.code,
        message: validationError.message,
        details: validationError.details,
        requestId,
      },
    };
    reply.status(validationError.statusCode).send(response);
    return;
  }

  // Handle application errors
  if (error instanceof AppError) {
    request.log.warn({ err: error, requestId }, error.message);
    const response: ErrorResponse = {
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        requestId,
      },
    };
    reply.status(error.statusCode).send(response);
    return;
  }

  // Handle Fastify validation errors
  if ('validation' in error && error.validation) {
    request.log.warn({ err: error, requestId }, 'Fastify validation error');
    const response: ErrorResponse = {
      error: {
        code: 'VALIDATION_ERROR',
        message: error.message,
        details: error.validation,
        requestId,
      },
    };
    reply.status(400).send(response);
    return;
  }

  // Handle unexpected errors - log full details, send generic message
  request.log.error({ err: error, requestId }, 'Unexpected error');
  const response: ErrorResponse = {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      requestId,
    },
  };
  reply.status(500).send(response);
}
