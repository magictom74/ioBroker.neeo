"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchNeeoBrainModel = fetchNeeoBrainModel;
const axios_1 = __importDefault(require("axios"));
const bonjour_1 = __importDefault(require("bonjour"));
const config_1 = require("./config");
// Brain discovery
async function discoverNeeoBrain() {
    return new Promise((resolve) => {
        const browser = (0, bonjour_1.default)().find({ type: "neeo" }, (service) => {
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
async function fetchNeeoBrainModel(adapter) {
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
        }
        else {
            adapter.log.warn("NEEO Brain discovery failed.");
            return null;
        }
    }
    const baseUrl = `http://${ip}:${port}/${config_1.API_BASE_URL}`;
    if (adapter.config.debugMode)
        adapter.log.debug(`Fetching Brain model from ${baseUrl}`);
    try {
        const response = await axios_1.default.get(baseUrl);
        const data = response.data;
        const rooms = [];
        const devices = [];
        const recipes = [];
        const scenarios = [];
        // Rooms
        for (const roomKey of Object.keys(data.rooms || {})) {
            const roomData = data.rooms[roomKey];
            if (!roomData || typeof roomData !== "object")
                continue;
            const roomId = roomData.key;
            const hasDevices = roomData.devices && Object.keys(roomData.devices).length > 0;
            const hasRecipes = roomData.recipes && Object.keys(roomData.recipes).length > 0;
            const hasScenarios = roomData.scenarios && Object.keys(roomData.scenarios).length > 0;
            // Check if room has content
            if (!hasDevices && !hasRecipes && !hasScenarios) {
                if (adapter.config.debugMode)
                    adapter.log.debug(`Skipping room ${roomData.name} (${roomId}) - empty content`);
                continue;
            }
            const room = {
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
                    const localMacros = Object.values(device.macros || {}).map((macro) => ({
                        id: macro.key,
                        name: macro.name,
                        label: macro.label
                    }));
                    const globalCommands = Object.values(data.buttons || {})
                        .filter((btn) => btn.deviceKey === device.key)
                        .map((btn) => ({ id: btn.key, name: btn.name, label: btn.label }));
                    const brainDevice = {
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
                    const brainRecipe = {
                        id: recipe.key,
                        name: `${recipe.name} - ${recipe.type}`,
                        type: recipe.type,
                        roomId,
                        deviceName: recipe.deviceName ?? "",
                        deviceClass: recipe.mainDeviceType ?? "",
                        power: recipe.steps?.find((s) => s.componentName)?.componentName ?? "",
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
                    const brainScenario = {
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
    }
    catch (error) {
        const err = error;
        adapter.log.error(`Failed to fetch NEEO Brain: ${err.message}`);
        return null;
    }
}
