import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { HttpError } from '../errors.js';

const errorHandler: FastifyPluginAsync = async (app) => {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details },
      });
    }
    if (err instanceof ZodError) {
      const summary = err.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      req.log.warn({ issues: err.issues }, 'validation_failed');
      return reply.status(400).send({
        error: {
          code: 'validation_error',
          message: summary || 'Request validation failed',
          details: err.flatten(),
        },
      });
    }
    req.log.error({ err }, 'unhandled_error');
    return reply.status(500).send({
      error: { code: 'internal_error', message: 'Internal server error' },
    });
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ error: { code: 'not_found', message: 'Route not found' } });
  });
};

export default fp(errorHandler, { name: 'veloqa-error-handler' });
