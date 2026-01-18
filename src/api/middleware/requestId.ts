import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Hook to ensure request ID is available on the request object.
 * Fastify generates the ID, this hook makes it easily accessible.
 */
export async function requestIdHook(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Fastify already generates request.id, we just add it to headers
  reply.header('x-request-id', request.id);
}
