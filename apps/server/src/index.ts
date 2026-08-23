import { createServer } from 'node:http';
import type { HealthResponse } from '@malign-ai/contracts';

const port = Number.parseInt(process.env.SERVER_PORT ?? '3001', 10);

const server = createServer((_request, response) => {
  const body: HealthResponse = { status: 'ok' };
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
});

server.listen(port, () => {
  process.stdout.write(`MALIGN-AI server skeleton listening on ${String(port)}\n`);
});
