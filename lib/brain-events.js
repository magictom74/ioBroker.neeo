"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrainEvents = void 0;
const socket_io_client_1 = __importDefault(require("socket.io-client"));
// Events observed on firmware 0.53.9 (see NEEO_API_NOTES.md)
const ACTIVITY_EVENTS = ['active-now-changed', 'active-scenario', 'active-scenarios', 'fw:availabilitychanged'];
/**
 * Socket.IO subscription to the NEEO Brain event stream.
 *
 * The brain runs a Socket.IO 2.x server (Engine.IO v3), so this module pins
 * socket.io-client v2. Payloads are meager (mostly bare timestamps or key
 * lists), therefore consumers should treat every event only as a trigger to
 * re-read the authoritative state via REST.
 */
class BrainEvents {
    constructor() {
        this.socket = null;
    }
    connect(brainIp, brainPort, handlers) {
        this.close();
        this.socket = (0, socket_io_client_1.default)(`http://${brainIp}:${brainPort}`, {
            transports: ['websocket'],
            reconnection: true,
            reconnectionDelay: 2000,
            reconnectionDelayMax: 60000,
        });
        this.socket.on('connect', () => handlers.onConnect());
        this.socket.on('disconnect', (reason) => handlers.onDisconnect(reason));
        for (const event of ACTIVITY_EVENTS) {
            this.socket.on(event, (data) => handlers.onActivity(event, data));
        }
        this.socket.on('projectchanged', () => handlers.onProjectChanged());
    }
    get connected() {
        return this.socket?.connected === true;
    }
    close() {
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.close();
            this.socket = null;
        }
    }
}
exports.BrainEvents = BrainEvents;
