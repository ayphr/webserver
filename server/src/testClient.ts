import net from 'node:net';
import { pack } from './lib/packet';
import { createLogger } from './lib/logger';

const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || '127.0.0.1';
const log = createLogger('test-client');

function sendBinary(serial: number, temp: number, humidity: number, airPressure: number) {
  const pkt = pack({ type: 1, temperature: temp, humidity, airPressure, serial });
  const client = net.createConnection(PORT, HOST, () => {
    client.write(Buffer.from(pkt));
    log.info({ serial, temp, humidity, airPressure }, 'sent binary packet');
    client.end();
  });
  client.on('error', (error) => log.error({ error }, 'binary client error'));
}

(async () => {
  for (let i = 0; i < 3; i++) {
    sendBinary(1000 + i, 20 + i, 40 + i, 1000 + i);
    await new Promise((r) => setTimeout(r, 200));
  }
  log.info('done sending test packets');
})();
