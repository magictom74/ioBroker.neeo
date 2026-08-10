import io from 'socket.io-client';

export interface BrainEventHandlers {
    /** Socket connected - brain reachable. */
    onConnect: () => void;
    /** Socket disconnected - does not necessarily mean the brain is down. */
    onDisconnect: (reason: string) => void;
    /** Any activity event (recipe launched/powered off, availability change). */
    onActivity: (event: string, data: unknown) => void;
    /** Brain configuration changed (rooms/devices/recipes edited). */
    onProjectChanged: () => void;
}

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
export class BrainEvents {
    private socket: SocketIOClient.Socket | null = null;

    connect(brainIp: string, brainPort: number, handlers: BrainEventHandlers): void {
        this.close();
        this.socket = io(`http://${brainIp}:${brainPort}`, {
            transports: ['websocket'],
            reconnection: true,
            reconnectionDelay: 2000,
            reconnectionDelayMax: 60000,
        });

        this.socket.on('connect', () => handlers.onConnect());
        this.socket.on('disconnect', (reason: string) => handlers.onDisconnect(reason));
        for (const event of ACTIVITY_EVENTS) {
            this.socket.on(event, (data: unknown) => handlers.onActivity(event, data));
        }
        this.socket.on('projectchanged', () => handlers.onProjectChanged());
    }

    get connected(): boolean {
        return this.socket?.connected === true;
    }

    close(): void {
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.close();
            this.socket = null;
        }
    }
}
