"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchNeeoBrainModel = fetchNeeoBrainModel;
const axios_1 = __importDefault(require("axios"));
const bonjour_1 = __importDefault(require("bonjour"));
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
        // Timeout if nothing is found
        setTimeout(() => {
            browser.stop();
            resolve(null);
        }, 5000);
    });
}
async function fetchNeeoBrainModel(adapter) {
    const config = adapter.config;
    let ip = config.serverIp;
    let port = config.serverPort;
    if (!ip || !port) {
        adapter.log.info("No IP or Port configured, trying discovery...");
        const result = await discoverNeeoBrain();
        if (result) {
            ip = result.ip;
            port = result.port;
            adapter.log.info(`Discovered NEEO Brain at ${ip}:${port}`);
        }
        else {
            adapter.log.warn("NEEO Brain discovery failed.");
            return null;
        }
    }
    const url = `http://${ip}:${port}/v1/projects/home`;
    try {
        adapter.log.debug(`Fetching Brain model from ${url}`);
        const response = await axios_1.default.get(url);
        const data = response.data;
        const rooms = [];
        const recipes = [];
        const devices = [];
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
    }
    catch (error) {
        const err = error;
        adapter.log.error(`Failed to fetch NEEO Brain: ${err.message}`);
        return null;
    }
}
