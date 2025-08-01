"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const adapter_core_1 = require("@iobroker/adapter-core");
const brain_discovery_1 = require("./lib/brain-discovery");
class NeeoAdapter extends adapter_core_1.Adapter {
    constructor(options = {}) {
        super({
            ...options,
            name: "neeo",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }
    async onReady() {
        this.log.info("Adapter started, connecting to NEEO Brain...");
        const model = await (0, brain_discovery_1.fetchNeeoBrainModel)(this);
        if (!model) {
            this.log.error("Could not fetch NEEO Brain data. Check IP/Port in adapter settings.");
            return;
        }
        this.log.info(`Brain model loaded: ${model.rooms.length} rooms, ${model.devices.length} devices, ${model.recipes.length} recipes`);
        // Clear old states (optional)
        await this.clearAllObjects();
        // Rooms
        for (const room of model.rooms) {
            const id = `rooms.${room.id}`;
            await this.setObjectNotExistsAsync(id, {
                type: "channel",
                common: { name: room.name },
                native: room
            });
        }
        // Devices
        for (const device of model.devices) {
            const id = `devices.${device.id}`;
            await this.setObjectNotExistsAsync(id, {
                type: "channel",
                common: { name: device.name },
                native: device
            });
        }
        // Recipes
        for (const recipe of model.recipes) {
            const id = `recipes.${recipe.id}`;
            await this.setObjectNotExistsAsync(id, {
                type: "channel",
                common: { name: recipe.name },
                native: recipe
            });
        }
    }
    async clearAllObjects() {
        const states = await this.getStatesAsync("*");
        for (const id of Object.keys(states)) {
            if (!id.startsWith(this.namespace))
                continue;
            await this.delObjectAsync(id.replace(this.namespace + ".", ""), { recursive: true });
        }
    }
    onUnload(callback) {
        try {
            this.log.info("Adapter is shutting down...");
            callback();
        }
        catch (e) {
            callback();
        }
    }
}
// @ts-ignore because ioBroker expects the adapter instance to be exported like this
if (require.main !== module) {
    module.exports = (options) => new NeeoAdapter(options);
}
else {
    new NeeoAdapter();
}
