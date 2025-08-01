import { Adapter, AdapterOptions } from "@iobroker/adapter-core";
import { fetchNeeoBrainModel, AdapterConfig } from "./lib/brain-discovery";
import { BrainDevice, BrainRecipe, BrainRoom } from "./lib/brain-types";

class NeeoAdapter extends Adapter {
    constructor(options: Partial<AdapterOptions> = {}) {
        super({
            ...options,
            name: "neeo",
        });

        this.on("ready", this.onReady.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }

    private async onReady(): Promise<void> {
        this.log.info("Adapter started, connecting to NEEO Brain...");

        const model = await fetchNeeoBrainModel(this);
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

    private async clearAllObjects(): Promise<void> {
        const states = await this.getStatesAsync("*");
        for (const id of Object.keys(states)) {
            if (!id.startsWith(this.namespace)) continue;
            await this.delObjectAsync(id.replace(this.namespace + ".", ""), { recursive: true });
        }
    }

    private onUnload(callback: () => void): void {
        try {
            this.log.info("Adapter is shutting down...");
            callback();
        } catch (e) {
            callback();
        }
    }
}

// @ts-ignore because ioBroker expects the adapter instance to be exported like this
if (require.main !== module) {
    module.exports = (options: Partial<AdapterOptions> | undefined) => new NeeoAdapter(options);
} else {
    new NeeoAdapter();
}
