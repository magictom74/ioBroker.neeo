import axios from "axios";
import bonjour from "bonjour";
import { AdapterInstance } from "@iobroker/adapter-core";
import { NeeoBrainModel, BrainDevice, BrainRecipe, BrainRoom, BrainMacro, BrainScenario } from "./brain-types";
import { API_BASE_URL } from "./config";

interface DiscoveryResult {
    ip: string;
    port: number;
}

export interface AdapterConfig {
    brainIp: string;
    brainPort: number;
    pollInterval: number;
}

// Brain discovery
async function discoverNeeoBrain(): Promise<DiscoveryResult | null> {
    return new Promise((resolve) => {
        const browser = bonjour().find({ type: "neeo" }, (service) => {
            if (service.referer && service.port) {
                const ip = service.referer.address;
                const port = service.port;
                browser.stop();
                resolve({ ip, port });
            }
        });

        setTimeout(() => {
            browser.stop();
            resolve(null);
        }, 5000);
    });
}

// Brain connection and API request
export async function fetchNeeoBrainModel(adapter: AdapterInstance): Promise<NeeoBrainModel | null> {
    const config = adapter.config;
    let ip = config.brainIp?.trim();
    let port = config.brainPort?.toString().trim();

    if (!ip || !port) {
        adapter.log.info("No IP or Port configured, trying discovery...");
        const result = await discoverNeeoBrain();
        if (result) {
            ip = result.ip;
            port = String(result.port);
            adapter.log.info(`Discovered NEEO Brain at ${ip}:${port}`);
        } else {
            adapter.log.warn("NEEO Brain discovery failed.");
            return null;
        }
    }

    const baseUrl = `http://${ip}:${port}/${API_BASE_URL}`;
    if (adapter.config.debugMode) adapter.log.debug(`Fetching Brain model from ${baseUrl}`);

    try {

        const response = await axios.get(baseUrl);
        const data = response.data;

        const rooms: BrainRoom[] = [];
        const devices: BrainDevice[] = [];
        const recipes: BrainRecipe[] = [];
        const scenarios: BrainScenario[] = [];

        // Rooms
        for (const roomKey of Object.keys(data.rooms || {})) {
            const roomData = data.rooms[roomKey];
            if (!roomData || typeof roomData !== "object") continue;

            const roomId = roomData.key;
            const hasDevices = roomData.devices && Object.keys(roomData.devices).length > 0;
            const hasRecipes = roomData.recipes && Object.keys(roomData.recipes).length > 0;
            const hasScenarios = roomData.scenarios && Object.keys(roomData.scenarios).length > 0;

            // Check if room has content
            if (!hasDevices && !hasRecipes && !hasScenarios) {
                if (adapter.config.debugMode) adapter.log.debug(`Skipping room ${roomData.name} (${roomId}) - empty content`);
                continue;
            }

            const room: BrainRoom = {
                id: roomId,
                name: roomData.name,
                devices: [],
                recipes: [],
                scenarios: []
            };

            // Devices
            if (hasDevices) {
                for (const devKey of Object.keys(roomData.devices)) {
                    const device = roomData.devices[devKey];

                    const localMacros: BrainMacro[] = Object.values(device.macros || {}).map((macro: any) => ({
                        id: macro.key,
                        name: macro.name,
                        label: macro.label
                    }));
                    
                    const globalCommands: BrainMacro[] = Object.values(data.buttons || {})
                        .filter((btn: any) => btn.deviceKey === device.key)
                        .map((btn: any) => ({ id: btn.key, name: btn.name, label: btn.label }));

                    const brainDevice: BrainDevice = {
                        id: device.key,
                        name: device.name,
                        type: device.type ?? "",
                        roomId,
                        capabilities: {
                            buttons: device.buttons ? Object.keys(device.buttons) : [],
                            sliders: device.sliders ? Object.keys(device.sliders) : []
                        },
                        macros: localMacros,
                        genericMacros: globalCommands,
                        details: device.details ?? {}
                    };

                    room.devices.push(brainDevice);
                    devices.push(brainDevice);
                }
            }

            // Recipes
            if (hasRecipes) {
                for (const recKey of Object.keys(roomData.recipes)) {
                    const recipe = roomData.recipes[recKey];
                    const brainRecipe: BrainRecipe = {
                        id: recipe.key,
                        name: `${recipe.name} - ${recipe.type}`,
                        type: recipe.type,
                        roomId,
                        deviceName: recipe.deviceName ?? "",
                        deviceClass: recipe.mainDeviceType ?? "",
                        power: recipe.steps?.find((s: any) => s.componentName)?.componentName ?? "",
                        isTurnedOn: recipe.enabled ?? false,
                        scenarioKey: recipe.scenarioKey ?? undefined
                    };

                    room.recipes.push(brainRecipe);
                    recipes.push(brainRecipe);
                }
            }

            // Scenarios
            if (hasScenarios) {
                for (const scnKey of Object.keys(roomData.scenarios)) {
                    const scenario = roomData.scenarios[scnKey];
                    const brainScenario: BrainScenario = {
                        id: scenario.key,
                        name: scenario.name,
                        type: scenario.type
                    };

                    room.scenarios.push(brainScenario);
                    scenarios.push(brainScenario);
                }
            }

            rooms.push(room);
        }
        
        return {
            rooms,
            devices,
            recipes,
            scenarios,
            brainIp: ip,
            brainPort: Number(port)
        };

    } catch (error) {
        const err = error as Error;
        adapter.log.error(`Failed to fetch NEEO Brain: ${err.message}`);
        return null;
    }
}
