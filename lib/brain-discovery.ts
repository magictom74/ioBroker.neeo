import { BrainRoom, BrainRecipe, BrainDevice } from './brain-types';
import { AxiosError } from "axios";
import axios from "axios";
import bonjour from "bonjour";
import { Adapter } from "@iobroker/adapter-core";

export interface AdapterConfig {
    serverIp: string;
    serverPort: number;
}

type NeeoAdapterInstance = InstanceType<typeof Adapter>;

interface BrainModel {
    rooms: BrainRoom[];
    devices: BrainDevice[];
    recipes: BrainRecipe[];
}

async function discoverNeeoBrain(): Promise<{ ip: string; port: number } | null> {
    return new Promise((resolve) => {
        const browser = bonjour().find({ type: "neeo" }, (service) => {
            if (service.referer && service.port) {
                const ip = service.referer.address;
                const port = service.port;
                browser.stop();
                resolve({ ip, port });
            }
        });

        // Timeout if nothing is found
        setTimeout(() => {
            browser.stop();
            resolve(null);
        }, 5000);
    });
}

export async function fetchNeeoBrainModel(adapter: NeeoAdapterInstance): Promise<BrainModel | null> {
    const config = adapter.config as AdapterConfig;
    let ip = config.serverIp;
    let port = config.serverPort;

    if (!ip || !port) {
        adapter.log.info("No IP or Port configured, trying discovery...");
        const result = await discoverNeeoBrain();
        if (result) {
            ip = result.ip;
            port = result.port;
            adapter.log.info(`Discovered NEEO Brain at ${ip}:${port}`);
        } else {
            adapter.log.warn("NEEO Brain discovery failed.");
            return null;
        }
    }

    const url = `http://${ip}:${port}/v1/projects/home`;

    try {
        adapter.log.debug(`Fetching Brain model from ${url}`);
        const response = await axios.get(url);
        const data = response.data;

        const rooms: BrainRoom[] = [];
        const recipes: BrainRecipe[] = [];
        const devices: BrainDevice[] = [];

        for (const room of data.rooms || []) {
            rooms.push({
                id: room.name.toLowerCase().replace(/\s+/g, "_"),
                name: room.name,
                recipes: [],
                devices: [],
            });

            for (const recipe of room.recipes || []) {
                recipes.push({
                    id: recipe.recipeId,
                    name: recipe.name,
                    type: recipe.type,
                    power: recipe.powerKey,
                    deviceClass: recipe.deviceClass,
                    roomName: room.name,
                    deviceName: recipe.deviceName,
                    isTurnedOn: recipe.enabled || false
                });
            }

            for (const device of room.devices || []) {
                devices.push({
                    id: device.uniqueDeviceId,
                    name: device.name,
                    type: device.type,
                    roomName: room.name,
                    capabilities: {
                        buttons: device.buttons || [],
                        sliders: device.sliders || []
                    }
                });
            }
        }

        return { rooms, devices, recipes };
    } catch (error) {
        const err = error as AxiosError;
        adapter.log.error(`Failed to fetch NEEO Brain: ${err.message}`);
        return null;
    }
}
