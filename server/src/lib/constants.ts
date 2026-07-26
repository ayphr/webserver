// ==================================
// Byte Constants
// ==================================

/**
 * STX (Start of Text) indicates the beginning of a packet
 */
export const STX = 0x02;

/**
 * ETX (End of Text) indicates the end of a packet
 */
export const ETX = 0x03;

// ==================================
// Packet Type Constants
// ==================================

export enum PacketType {
  /**
   * SENSOR packet type for transmitting sensor data (see `SensorPacket`)
   */
  SENSOR = 1,
}
