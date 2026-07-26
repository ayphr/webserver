/**
 * Error class for handling packet-related errors
 */
export class PacketHandlingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PacketHandlingError';
    Object.setPrototypeOf(this, PacketHandlingError.prototype);
  }
}
