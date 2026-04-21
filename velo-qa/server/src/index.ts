import { buildApp } from './app.js';
import { loadEnv } from './env.js';
import { logger } from './logger.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await buildApp();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting_down');
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: env.HOST, port: env.PORT });
  logger.info({ port: env.PORT }, 'server_listening');
}

main().catch((err) => {
  logger.fatal({ err }, 'server_failed_to_start');
  process.exit(1);
});
