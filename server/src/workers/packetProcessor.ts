import { PacketType } from '../lib/constants';
import { unpack, validatePacket } from '../lib/packet';
import { createLogger } from '../lib/logger';
import type { TelemetryRecord } from '../lib/telemetry';
import { getDeviceBySerial, updateDeviceLastBroadcast } from './dbWriter';

const log = createLogger('packet-worker');

export async function handlePacketMessage(message: Uint8Array, emit: (payload: unknown) => void) {
  try {
    const packet = unpack(message);
    if (packet && packet.valid && packet.type === PacketType.SENSOR && validatePacket(packet)) {
      const serial = packet.serial;

      const device = await getDeviceBySerial(serial);
      if (!device) {
        emit({ action: 'error', error: `unregistered device ${serial}`, serial });
        return;
      }

      void updateDeviceLastBroadcast(serial, new Date());

      const record: TelemetryRecord = {
        deviceId: packet.serial,
        timestamp: new Date(),
        temperature: packet.temperature,
        humidity: packet.humidity,
        airPressure: packet.airPressure
      };
      if (device.location && Array.isArray(device.location.coordinates)) {
        const [lon, lat] = device.location.coordinates;
        record.location = { lat, lon };
      }
      emit({ action: 'record', record });
    }
  } catch (error) {
    log.error({ error }, 'failed to process packet');
    emit({ action: 'error', error: String(error) });
  }
}
