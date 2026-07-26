import { STX, ETX, PacketType } from "./constants";
import { PacketHandlingError } from "./errors";

export type SensorPacket = {
  /**
   * Packet type: internally a 4-bit unsigned integer
   */
  type: PacketType;

  /**
   * Temperature in Celsius, from -150.00 to 150.00 with 0.01 precision
   */
  temperature: number;

  /**
   * Humidity percentage, from 0.0 to 100.0 with 0.1 precision
   */
  humidity: number;

  /**
   * Air pressure in hectopascals, from 300 to 1100 hPa with 1 hPa precision
   */
  airPressure: number;

  /**
   * Serial number, a numeric identifier for the telemetry sensor, up to 32-bit unsigned integer limit
   */
  serial: number;
};

/**
 * Validates a SensorPacket object to ensure all fields are within their specified ranges.
 * @param packet The SensorPacket to validate
 * @throws PacketHandlingError if any field is out of its valid range
 */
export function validatePacket(packet: SensorPacket): void {
  if (packet.type < 0 || packet.type > 15) {
    throw new PacketHandlingError("Packet type must be between 0 and 15");
  }
  if (packet.temperature < -150 || packet.temperature > 150) {
    throw new PacketHandlingError("Packet temperature must be between -150 and 150 °C");
  }
  if (packet.humidity < 0 || packet.humidity > 100) {
    throw new PacketHandlingError("Packet humidity must be between 0 and 100 %");
  }
  if (!Number.isInteger(packet.airPressure) || packet.airPressure < 300 || packet.airPressure > 1100) {
    throw new PacketHandlingError("Packet air pressure must be between 300 and 1100 hPa");
  }
  if (packet.serial < 0 || packet.serial > 0xFFFFFFFF) {
    throw new PacketHandlingError("Packet serial number must be a valid unsigned 32-bit integer");
  }
}

/**
 * Counts the number of set bits (1s) in a bigint value, used for parity checking.
 * @param value The bigint value to count bits in
 * @returns The number of set bits in the value
 */
function countBits(value: bigint): number {
  let count = 0;
  for (let current = value; current !== 0n; current &= current - 1n) count++;
  return count;
}

/**
 * Packs a SensorPacket into a Uint8Array for transmission.
 * @param packet The SensorPacket to pack
 * @returns A Uint8Array containing the packed packet
 */
export function pack(packet: SensorPacket): Uint8Array {
  validatePacket(packet);

  const tScaled = Math.round((packet.temperature + 150) * 100);
  const hScaled = Math.round(packet.humidity * 10);
  const pScaled = packet.airPressure - 300;

  let raw = 0n;
  raw |= BigInt(packet.type & 0x0f) << 0n;
  raw |= BigInt(tScaled & 0x7fff) << 4n;
  raw |= BigInt(hScaled & 0x03ff) << 19n;
  raw |= BigInt(pScaled & 0x03ff) << 29n;
  raw |= BigInt(packet.serial >>> 0) << 95n;

  if (countBits(raw) % 2 !== 0) {
    raw |= 1n << 127n;
  }

  const high = (raw >> 64n) & 0xffffffffffffffffn;
  const low = raw & 0xffffffffffffffffn;

  const buf = new Uint8Array(18);
  buf[0] = STX;

  const view = new DataView(buf.buffer);
  view.setBigUint64(1, high, false);
  view.setBigUint64(9, low, false);

  buf[17] = ETX;
  return buf;
}

/**
 * Unpacks a Uint8Array into a SensorPacket object.
 * @param raw The Uint8Array to unpack
 * @returns A SensorPacket object if the array is valid, null otherwise
 */
export function unpack(raw: Uint8Array): (SensorPacket & { valid: boolean }) | null {
  if (raw.length !== 18 || raw[0] !== STX || raw[raw.length - 1] !== ETX) return null;

  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const high = view.getBigUint64(1, false);
  const low = view.getBigUint64(9, false);
  const tel = (high << 64n) | low;

  // Parity check
  const count = countBits(tel);

  const type = Number(tel & 0x0fn);
  const temperature = Number((Number((tel >> 4n) & 0x7fffn) / 100 - 150).toFixed(2));
  const humidity = Number((Number((tel >> 19n) & 0x03ffn) / 10).toFixed(1));
  const airPressure = Number((tel >> 29n) & 0x03ffn) + 300;
  const serial = Number((tel >> 95n) & 0xffffffffn);

  return {
    type,
    temperature,
    humidity,
    airPressure,
    serial,
    valid: (count % 2 === 0)
  };
}
