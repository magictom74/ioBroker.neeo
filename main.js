"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const adapter_core_1 = require("@iobroker/adapter-core");
const brain_discovery_1 = require("./lib/brain-discovery");
const config_1 = require("./lib/config");
const axios_1 = __importDefault(require("axios"));
class NeeoAdapter extends adapter_core_1.Adapter {
    constructor(options = {}) {
        super({ ...options, name: "neeo" });
        this.brainIp = "";
        this.brainPort = 0;
        this.pollInterval = config_1.POLL_INTERVAL;
        this.pollHandle = null;
        this.roomPowerTimeout = null;
        this.on("ready", this.onReady.bind(this));
        this.on("unload", this.onUnload.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
    }
    // Capitalize Names
    capitalize(text) {
        return text.charAt(0).toUpperCase() + text.slice(1);
    }
    // Start adapter
    async onReady() {
        this.log.info("Adapter started, connecting to NEEO Brain...");
        // Subscribe to state
        this.subscribeStates("*");
        // Fetch Brain data
        const model = await (0, brain_discovery_1.fetchNeeoBrainModel)(this);
        if (!model) {
            this.log.error("Could not fetch NEEO Brain data. Check IP/Port in adapter settings.");
            return;
        }
        this.brainIp = model.brainIp ?? '';
        this.brainPort = model.brainPort ?? 0;
        this.pollInterval = Number(this.config?.pollInterval ?? config_1.POLL_INTERVAL);
        this.log.info(`Brain model loaded: ${model.rooms.length} rooms, ${model.devices.length} devices, ${model.recipes.length} recipes, ${model.scenarios.length} scenarios`);
        // Delete old objects
        await this.clearAllObjects();
        // Create Info folder
        await this.setObjectNotExistsAsync(config_1.INFO, {
            type: "folder",
            common: { name: "Adapter Info" },
            native: {}
        });
        // Create object brainIp
        await this.setObjectNotExistsAsync(`${config_1.INFO}.brainIp`, {
            type: "state",
            common: {
                name: "Brain IP Address",
                type: "string",
                role: "text",
                read: true,
                write: false
            },
            native: {}
        });
        await this.setState(`${config_1.INFO}.brainIp`, this.brainIp, true);
        // Create object brainPort
        await this.setObjectNotExistsAsync(`${config_1.INFO}.brainPort`, {
            type: "state",
            common: {
                name: "Brain Port",
                type: "number",
                role: "info",
                read: true,
                write: false
            },
            native: {}
        });
        await this.setState(`${config_1.INFO}.brainPort`, this.brainPort, true);
        // Create object pollInterval
        await this.setObjectNotExistsAsync(`${config_1.INFO}.pollInterval`, {
            type: "state",
            common: {
                name: "Brain Polling Interval (s)",
                type: "number",
                unit: "s",
                role: "value.interval",
                read: true,
                write: false
            },
            native: {}
        });
        await this.setState(`${config_1.INFO}.pollInterval`, this.pollInterval, true);
        // Create object connection
        await this.setObjectNotExistsAsync(`${config_1.INFO}.connection`, {
            type: "state",
            common: {
                name: "Brain Online Status",
                type: "boolean",
                role: "indicator.reachable",
                read: true,
                write: false
            },
            native: {}
        });
        await this.setState(`${config_1.INFO}.connection`, false, true);
        // Create Global isactive
        await this.setObjectNotExistsAsync(`${config_1.INFO}.isactive`, {
            type: "state",
            common: {
                name: "Global Active Status",
                type: "boolean",
                role: "indicator.status",
                read: true,
                write: false
            },
            native: {}
        });
        await this.setState(`${config_1.INFO}.isactive`, false, true);
        // Create Global powerToggle
        await this.setObjectNotExistsAsync(`${config_1.INFO}.powerToggle`, {
            type: "state",
            common: {
                name: "Global Power Toggle",
                type: "boolean",
                role: "button",
                read: false,
                write: true
            },
            native: {}
        });
        await this.setState(`${config_1.INFO}.powerToggle`, false, true);
        // Create rooms
        for (const room of model.rooms) {
            const roomId = `${config_1.ROOMS}.${room.id}`;
            await this.setObjectNotExistsAsync(roomId, {
                type: "channel",
                common: { name: room.name },
                native: room
            });
            // Create object isactive
            await this.setObjectNotExistsAsync(`${roomId}.isactive`, {
                type: "state",
                common: {
                    name: "Recipe Status",
                    type: "boolean",
                    role: "indicator.status",
                    read: true,
                    write: false,
                    def: false
                },
                native: { roomId: room.id }
            });
            // Create object powerToggle
            await this.setObjectNotExistsAsync(`${roomId}.powerToggle`, {
                type: "state",
                common: {
                    name: "Room Power Toggle",
                    type: "boolean",
                    role: "button",
                    read: false,
                    write: true,
                    def: false
                },
                native: { roomId: room.id }
            });
            // Create object volumeUp
            await this.setObjectNotExistsAsync(`${roomId}.volumeUp`, {
                type: "state",
                common: {
                    name: "Volume Up",
                    type: "boolean",
                    role: "button",
                    read: false,
                    write: true,
                    def: false
                },
                native: {
                    roomKey: room.id
                }
            });
            // Create object volumeDown
            await this.setObjectNotExistsAsync(`${roomId}.volumeDown`, {
                type: "state",
                common: {
                    name: "Volume Down",
                    type: "boolean",
                    role: "button",
                    read: false,
                    write: true,
                    def: false
                },
                native: {
                    roomKey: room.id
                }
            });
            // Create custom objects in 0_userdata.<instance>.<room-id>
            const instance = this.instance;
            const customPath = `${config_1.CUSTOM_PATH}.${instance}.${room.id}`;
            // Create object roomDefault
            await this.setForeignObjectNotExistsAsync(`${customPath}.roomDefault`, {
                type: "state",
                common: {
                    name: "Room Default recipe",
                    type: "string",
                    role: "text",
                    read: true,
                    write: true,
                },
                native: {}
            });
            // Create object roomDelay
            await this.setForeignObjectNotExistsAsync(`${customPath}.roomDelay`, {
                type: "state",
                common: {
                    name: "Room Power-On Delay (s)",
                    type: "number",
                    unit: "s",
                    role: "value.interval",
                    read: true,
                    write: true,
                    def: 0
                },
                native: {}
            });
            // Create object roomGlobal
            await this.setForeignObjectNotExistsAsync(`${customPath}.roomGlobal`, {
                type: "state",
                common: {
                    name: "Room included in Global Power Toggle",
                    type: "boolean",
                    role: "indicator.status",
                    read: false,
                    write: true,
                    def: false
                },
                native: {}
            });
            // Create object roomVolDevice
            await this.setForeignObjectNotExistsAsync(`${customPath}.roomVolDevice`, {
                type: "state",
                common: {
                    name: "Volume deviceKey",
                    type: "string",
                    role: "text",
                    read: true,
                    write: true
                },
                native: {}
            });
            // Create object roomVolUp
            await this.setForeignObjectNotExistsAsync(`${customPath}.roomVolUp`, {
                type: "state",
                common: {
                    name: "Volume Up macroKey",
                    type: "string",
                    role: "text",
                    read: true,
                    write: true
                },
                native: {}
            });
            // Create object roomVolDown
            await this.setForeignObjectNotExistsAsync(`${customPath}.roomVolDown`, {
                type: "state",
                common: {
                    name: "Volume Down macroKey",
                    type: "string",
                    role: "text",
                    read: true,
                    write: true
                },
                native: {}
                // Create object roomVolRepeat
            });
            await this.setForeignObjectNotExistsAsync(`${customPath}.roomVolRepeat`, {
                type: "state",
                common: {
                    name: "Volume repeats",
                    type: "number",
                    role: "level",
                    read: true,
                    write: true,
                    def: 5,
                    min: 1,
                    max: 10
                },
                native: {}
            });
            // Create object roomVolDelay
            await this.setForeignObjectNotExistsAsync(`${customPath}.roomVolDelay`, {
                type: "state",
                common: {
                    name: "Volume delay (ms)",
                    type: "number",
                    unit: "ms",
                    role: "value.interval",
                    read: true,
                    write: true,
                    def: 100,
                    min: 0,
                    max: 500
                },
                native: {}
            });
            this.log.debug(`Created room object: ${roomId}`);
            // Create device folder
            if (room.devices && room.devices.length > 0) {
                await this.setObjectNotExistsAsync(`${roomId}.${config_1.DEVICES}`, {
                    type: "folder",
                    common: { name: this.capitalize(config_1.DEVICES) },
                    native: {}
                });
            }
            // Create recipe folder
            if (room.recipes && room.recipes.length > 0) {
                await this.setObjectNotExistsAsync(`${roomId}.${config_1.RECIPES}`, {
                    type: "folder",
                    common: { name: this.capitalize(config_1.RECIPES) },
                    native: {}
                });
            }
            // Create scenario folder
            if (room.scenarios && room.scenarios.length > 0) {
                await this.setObjectNotExistsAsync(`${roomId}.${config_1.SCENARIOS}`, {
                    type: "folder",
                    common: { name: this.capitalize(config_1.SCENARIOS) },
                    native: {}
                });
            }
        }
        // Create devices
        for (const device of model.devices) {
            const roomPath = `${config_1.ROOMS}.${device.roomId}`;
            const devId = `${roomPath}.${config_1.DEVICES}.${device.id}`;
            await this.setObjectNotExistsAsync(devId, {
                type: "channel",
                common: { name: device.name },
                native: device
            });
            this.log.debug(`Created device object: ${devId}`);
            const details = device.details || {};
            // Create object manufacturer
            await this.setObjectNotExistsAsync(`${devId}.manufacturer`, {
                type: "state",
                common: {
                    name: "Manufacturer",
                    type: "string",
                    role: "text",
                    read: true,
                    write: false
                },
                native: {}
            });
            await this.setState(`${devId}.manufacturer`, details.manufacturer ?? "", true);
            // Create object modelName
            await this.setObjectNotExistsAsync(`${devId}.modelName`, {
                type: "state",
                common: {
                    name: "Model Name",
                    type: "string",
                    role: "text",
                    read: true,
                    write: false
                },
                native: {}
            });
            await this.setState(`${devId}.modelName`, details.name ?? "", true);
            // Create object deviceType
            await this.setObjectNotExistsAsync(`${devId}.deviceType`, {
                type: "state",
                common: {
                    name: "Device Type",
                    type: "string",
                    role: "text",
                    read: true,
                    write: false
                },
                native: {}
            });
            await this.setState(`${devId}.deviceType`, details.type ?? "", true);
            // Create macros if available
            if (device.macros && device.macros.length > 0) {
                await this.setObjectNotExistsAsync(`${devId}.${config_1.MACROS}`, {
                    type: "folder",
                    common: { name: this.capitalize(config_1.MACROS) },
                    native: {}
                });
                for (const macro of device.macros) {
                    const macroId = `${devId}.${config_1.MACROS}.${macro.id}`;
                    await this.setObjectNotExistsAsync(macroId, {
                        type: "state",
                        common: {
                            name: macro.label || macro.name,
                            type: "boolean",
                            role: "button",
                            read: false,
                            write: true,
                            def: false
                        },
                        native: {
                            macroKey: macro.id,
                            deviceKey: device.id,
                            roomKey: device.roomId
                        }
                    });
                    await this.setState(macroId, false, true);
                    this.log.debug(`Created macro: ${macroId}`);
                }
            }
            // Create commands if available
            if (device.genericMacros && device.genericMacros.length > 0) {
                await this.setObjectNotExistsAsync(`${devId}.${config_1.COMMANDS}`, {
                    type: "folder",
                    common: { name: this.capitalize(config_1.COMMANDS) },
                    native: {}
                });
                for (const command of device.genericMacros) {
                    const commandId = `${devId}.${config_1.COMMANDS}.${command.name.replace(/\s+/g, '_')}`;
                    await this.setObjectNotExistsAsync(commandId, {
                        type: "state",
                        common: {
                            name: command.label || command.name,
                            type: "boolean",
                            role: "button",
                            read: false,
                            write: true,
                            def: false
                        },
                        native: command
                    });
                    await this.setState(commandId, false, true);
                    this.log.debug(`Created command: ${commandId}`);
                }
            }
        }
        // Create recipes
        for (const recipe of model.recipes) {
            const recId = `${config_1.ROOMS}.${recipe.roomId}.${config_1.RECIPES}.${recipe.id}`;
            await this.setObjectNotExistsAsync(recId, {
                type: "channel",
                common: { name: recipe.name },
                native: recipe
            });
            // Create object isactive
            await this.setObjectNotExistsAsync(`${recId}.${config_1.ISACTIVE}`, {
                type: "state",
                common: {
                    name: "Active Status",
                    type: "boolean",
                    role: "indicator.status",
                    read: true,
                    write: false,
                    def: false
                },
                native: { roomKey: recipe.roomId, recipeKey: recipe.id }
            });
            // Create object execute
            await this.setObjectNotExistsAsync(`${recId}.${config_1.EXECUTE}`, {
                type: "state",
                common: {
                    name: "Execute Recipe",
                    type: "boolean",
                    role: "button",
                    read: false,
                    write: true,
                    def: false
                },
                native: { roomKey: recipe.roomId, recipeKey: recipe.id }
            });
            this.log.debug(`Created recipe object: ${recId}`);
        }
        // Create scenario objects for same room
        const scenarioMap = {};
        for (const recipe of model.recipes) {
            if (!recipe.scenarioKey)
                continue;
            const key = `${recipe.roomId}|${recipe.scenarioKey}`;
            if (!scenarioMap[key]) {
                scenarioMap[key] = { roomId: recipe.roomId, scenarioKey: recipe.scenarioKey };
            }
            if (recipe.type === 'launch')
                scenarioMap[key].launch = recipe;
            if (recipe.type === 'poweroff')
                scenarioMap[key].poweroff = recipe;
        }
        for (const { roomId, scenarioKey, launch, poweroff } of Object.values(scenarioMap)) {
            if (!launch || !poweroff)
                continue;
            // Use launch.name or fallback to scenarioKey
            const scenarioName = scenarioKey;
            const scenFolder = `${config_1.ROOMS}.${roomId}.${config_1.SCENARIOS}.${scenarioName}`;
            await this.setObjectNotExistsAsync(scenFolder, {
                type: "channel",
                common: { name: launch.name?.replace(/\s*-\s*launch$/i, '') || `Scenario ${scenarioKey}` },
                native: {
                    launchId: launch.id,
                    poweroffId: poweroff.id,
                    scenarioKey,
                    roomKey: roomId
                }
            });
            // Create object lanchId
            await this.setObjectNotExistsAsync(`${scenFolder}.launch`, {
                type: "state",
                common: { name: "Recipe ID launch", type: "string", role: "info.id", read: true, write: false },
                native: {}
            });
            await this.setState(`${scenFolder}.launch`, launch.id, true);
            // Create object poweroffId
            await this.setObjectNotExistsAsync(`${scenFolder}.poweroff`, {
                type: "state",
                common: { name: "Recipe ID poweroff", type: "string", role: "info.id", read: true, write: false },
                native: {}
            });
            await this.setState(`${scenFolder}.poweroff`, poweroff.id, true);
            // Create object isactive
            await this.setObjectNotExistsAsync(`${scenFolder}.${config_1.ISACTIVE}`, {
                type: "state",
                common: {
                    name: "Scenario Status",
                    type: "boolean",
                    role: "indicator.status",
                    read: true,
                    write: false,
                    def: false
                },
                native: {
                    roomKey: roomId,
                    recipeKey: launch.id,
                    scenarioKey: scenarioName
                }
            });
            // Create object powerToggle
            await this.setObjectNotExistsAsync(`${scenFolder}.powerToggle`, {
                type: "state",
                common: {
                    name: "Power Toggle Scenario",
                    type: "boolean",
                    role: "button",
                    read: false,
                    write: true,
                    def: false
                },
                native: {
                    roomKey: roomId,
                    launch: launch.id,
                    poweroff: poweroff.id,
                    scenarioKey: scenarioName
                }
            });
            this.log.debug(`Created scenario group: ${scenFolder}`);
        }
        // Start polling
        this.RecipePolling(model.recipes);
    }
    // Monitor state change
    async onStateChange(id, state) {
        if (!state || state.ack || state.val !== true)
            return;
        const obj = await this.getObjectAsync(id);
        const native = obj?.native || {};
        // Execute recipes
        if (id.endsWith(`.${config_1.EXECUTE}`)) {
            const recipeChannelId = id.replace(`.${config_1.EXECUTE}`, "");
            const recipeObj = await this.getObjectAsync(recipeChannelId);
            const recNative = recipeObj?.native;
            if (!recNative?.roomId || !recNative?.id)
                return;
            try {
                // Execute recipe
                await this.executeRecipe(recNative.roomId, recNative.id);
                // Change isactive state (recipe / scenario / room)
                const isLaunch = recNative.type === "launch";
                const roomPath = `${config_1.ROOMS}.${recNative.roomId}`;
                const recipePath = `${roomPath}.${config_1.RECIPES}.${recNative.id}.${config_1.ISACTIVE}`;
                await this.setState(recipePath, isLaunch, true);
                if (recNative.scenarioKey) {
                    const scenarioPath = `${roomPath}.${config_1.SCENARIOS}.${recNative.scenarioKey}.${config_1.ISACTIVE}`;
                    await this.setState(scenarioPath, isLaunch, true);
                }
                await this.setState(`${roomPath}.isactive`, isLaunch, true);
                await this.updateGlobalIsActive(recNative.roomId, isLaunch);
            }
            catch (err) {
                this.log.error(`Recipe execution failed: ${err.message}`);
            }
            return;
        }
        // Trigger macro / commands
        if ((id.includes(`.${config_1.MACROS}.`) || id.includes(`.${config_1.COMMANDS}.`)) && native.roomKey && native.deviceKey && native.macroKey) {
            try {
                await this.triggerMacro(native.roomKey, native.deviceKey, native.macroKey);
            }
            catch (err) {
                this.log.error(`Macro/command trigger failed: ${err.message}`);
            }
            return;
        }
        // Scenario power toggle
        if (id.endsWith(".powerToggle") && id.includes(`.${config_1.SCENARIOS}.`)) {
            const scenId = id.replace(".powerToggle", "");
            const scenObj = await this.getObjectAsync(scenId);
            const { roomKey, launchId, poweroffId, scenarioKey } = scenObj?.native || {};
            if (!roomKey || !launchId || !poweroffId || !scenarioKey)
                return;
            const isActivePath = `${config_1.ROOMS}.${roomKey}.${config_1.SCENARIOS}.${scenarioKey}.${config_1.ISACTIVE}`;
            const isCurrentlyActive = (await this.getStateAsync(isActivePath))?.val === true;
            const isLaunching = !isCurrentlyActive;
            const targetRecipe = isLaunching ? launchId : poweroffId;
            try {
                // Execute recipe
                await this.executeRecipe(roomKey, targetRecipe);
                // Change isactive state (recipe / scenario / room)
                const recipeStatePath = `${config_1.ROOMS}.${roomKey}.${config_1.RECIPES}.${targetRecipe}.${config_1.ISACTIVE}`;
                await this.setState(recipeStatePath, isLaunching, true);
                await this.setState(isActivePath, isLaunching, true);
                await this.setState(`${config_1.ROOMS}.${roomKey}.isactive`, isLaunching, true);
                await this.updateGlobalIsActive(roomKey, isLaunching);
            }
            catch (err) {
                this.log.error(`Scenario toggle failed: ${err.message}`);
            }
            return;
        }
        // Room power toggle
        if (id.endsWith(".powerToggle") && id.includes(`.${config_1.ROOMS}.`) && !id.includes(`.${config_1.SCENARIOS}.`)) {
            const roomId = id.split(".")[3];
            const roomPath = `${config_1.ROOMS}.${roomId}`;
            const isActive = (await this.getStateAsync(`${roomPath}.isactive`))?.val === true;
            if (isActive) {
                // Power off via active scenario
                const scenarioPrefix = `${this.namespace}.${config_1.ROOMS}.${roomId}.${config_1.SCENARIOS}.`;
                const allObjects = await this.getObjectViewAsync('system', 'channel', {
                    startkey: scenarioPrefix,
                    endkey: scenarioPrefix + '\u9999',
                });
                const scenarios = Object.values(allObjects.rows.map(r => r.value));
                for (const s of scenarios) {
                    const isActiveState = await this.getStateAsync(`${s._id}.${config_1.ISACTIVE}`);
                    if (isActiveState?.val === true) {
                        const poweroffId = s.native?.poweroffId;
                        if (!poweroffId) {
                            this.log.warn(`Scenario ${s._id} missing poweroffId`);
                            continue;
                        }
                        try {
                            // Execute recipe
                            await this.executeRecipe(roomId, poweroffId);
                            // Change isactive state (recipe / scenario / room)
                            await this.setState(`${roomPath}.${config_1.RECIPES}.${poweroffId}.${config_1.ISACTIVE}`, false, true);
                            await this.setState(`${s._id}.${config_1.ISACTIVE}`, false, true);
                            await this.setState(`${roomPath}.isactive`, false, true);
                            await this.updateGlobalIsActive(roomId, false);
                        }
                        catch (err) {
                            this.log.error(`Room powerToggle (off) failed: ${err.message}`);
                        }
                        return;
                    }
                }
                this.log.warn(`Room ${roomId} has no active scenario to power off`);
                return;
            }
            else {
                // Power on via roomDefault
                const customPath = `${config_1.CUSTOM_PATH}.${this.instance}.${roomId}`;
                const defaultId = (await this.getForeignStateAsync(`${customPath}.roomDefault`))?.val?.toString();
                const delay = Number((await this.getForeignStateAsync(`${customPath}.roomDelay`))?.val ?? 0) * 1000;
                if (!defaultId) {
                    this.log.warn(`No default recipe configured for room ${roomId}`);
                    return;
                }
                const exec = async () => {
                    try {
                        // Execute recipe
                        await this.executeRecipe(roomId, defaultId);
                        // Change isactive state (recipe / scenario / room)
                        await this.setState(`${roomPath}.${config_1.RECIPES}.${defaultId}.${config_1.ISACTIVE}`, true, true);
                        const recipeObj = await this.getObjectAsync(`${roomPath}.${config_1.RECIPES}.${defaultId}`);
                        const { scenarioKey, type } = recipeObj?.native || {};
                        if (scenarioKey && type === "launch") {
                            await this.setState(`${roomPath}.${config_1.SCENARIOS}.${scenarioKey}.${config_1.ISACTIVE}`, true, true);
                        }
                        await this.setState(`${roomPath}.isactive`, true, true);
                        await this.updateGlobalIsActive(roomId, false);
                    }
                    catch (err) {
                        this.log.error(`Room powerToggle (on) failed: ${err.message}`);
                    }
                };
                if (delay > 0) {
                    this.roomPowerTimeout = setTimeout(exec, delay);
                }
                else {
                    await exec();
                }
                return;
            }
        }
        // Global power toggle
        if (id === `${this.namespace}.${config_1.INFO}.powerToggle`) {
            try {
                const globalIsActive = (await this.getStateAsync(`${config_1.INFO}.isactive`))?.val === true;
                const allRooms = await this.getObjectViewAsync('system', 'channel', {
                    startkey: `${this.namespace}.${config_1.ROOMS}.`,
                    endkey: `${this.namespace}.${config_1.ROOMS}.\u9999`
                });
                const roomIds = [...new Set(allRooms.rows
                        .map(r => (r.value?._id ?? r.id))
                        .filter(Boolean)
                        .map(id => id.split('.'))
                        .filter(parts => parts.length === 4)
                        .map(parts => parts[3]))];
                for (const roomId of roomIds) {
                    const roomPath = `${config_1.ROOMS}.${roomId}`;
                    const customPath = `${config_1.CUSTOM_PATH}.${this.instance}.${roomId}`;
                    const isActive = (await this.getStateAsync(`${roomPath}.isactive`))?.val === true;
                    const roomGlobal = (await this.getForeignStateAsync(`${customPath}.roomGlobal`))?.val === true;
                    // Power rooms off if active
                    if (globalIsActive) {
                        if (isActive) {
                            this.log.debug(`Global powerToggle triggered for room: ${roomPath}`);
                            await this.setState(`${roomPath}.powerToggle`, true, false);
                        }
                        continue;
                    }
                    // Skip if room not enablen for global powerToggle
                    if (!roomGlobal) {
                        continue;
                    }
                    // Check for roomDefault recipe
                    const roomDefault = (await this.getForeignStateAsync(`${customPath}.roomDefault`))?.val?.toString() ?? "";
                    if (!roomDefault) {
                        this.log.debug(`Global powerToggle skipped for room ${roomPath}, as no default recipe is defined`);
                        continue;
                    }
                    // Power rooms on if roomDefault = true
                    if (!isActive) {
                        const roomDelay = (await this.getForeignStateAsync(`${customPath}.roomDelay`))?.val ?? 0;
                        const delay = Number(roomDelay) * 1000;
                        if (delay > 0) {
                            setTimeout(() => {
                                this.log.debug(`Global powerToggle triggered for room: ${roomPath} with ${roomDelay}s delay`);
                                this.setState(`${roomPath}.powerToggle`, true, false);
                            }, delay);
                        }
                        else {
                            this.log.debug(`Global powerToggle triggered for room: ${roomPath}`);
                            await this.setState(`${roomPath}.powerToggle`, true, false);
                        }
                    }
                }
            }
            catch (err) {
                this.log.error(`Global powerToggle failed: ${err.message}`);
            }
            return;
        }
        // Room volumeUp / volumeDown
        if ((id.endsWith(".volumeUp") || id.endsWith(".volumeDown")) && id.includes(`.${config_1.ROOMS}.`)) {
            const parts = id.split(".");
            const roomId = parts[3];
            const customPath = `${config_1.CUSTOM_PATH}.${this.instance}.${roomId}`;
            const roomKey = roomId;
            const deviceKey = (await this.getForeignStateAsync(`${customPath}.roomVolDevice`))?.val?.toString().trim();
            const repeat = Number((await this.getForeignStateAsync(`${customPath}.roomVolRepeat`))?.val ?? 3);
            const delayMs = Number((await this.getForeignStateAsync(`${customPath}.roomVolDelay`))?.val ?? 150);
            const macroKeyState = id.endsWith(".volumeUp") ? "roomVolUp" : "roomVolDown";
            const macroKey = (await this.getForeignStateAsync(`${customPath}.${macroKeyState}`))?.val?.toString().trim();
            if (!deviceKey || !macroKey) {
                return;
            }
            try {
                await this.volumeMacro(roomKey, deviceKey, macroKey, repeat, delayMs);
            }
            catch (err) {
                this.log.error(`VolumeMacro failed: ${err.message}`);
            }
            return;
        }
        this.log.warn(`Unhandled state change: ${id}`);
    }
    // Check and update global isactive status
    async updateGlobalIsActive(roomKey, isLaunching) {
        if (isLaunching) {
            const cur = await this.getStateAsync(`${config_1.INFO}.isactive`);
            if (cur?.val !== true)
                await this.setState(`${config_1.INFO}.isactive`, true, true);
            return;
        }
        const allRooms = await this.getObjectViewAsync('system', 'channel', {
            startkey: `${this.namespace}.${config_1.ROOMS}.`,
            endkey: `${this.namespace}.${config_1.ROOMS}.\u9999`,
        });
        let anyOtherActive = false;
        for (const roomObj of allRooms.rows.map(r => r.value)) {
            const rid = roomObj._id.split('.')[2];
            if (rid === roomKey)
                continue;
            const active = (await this.getStateAsync(`${config_1.ROOMS}.${rid}.isactive`))?.val === true;
            if (active) {
                anyOtherActive = true;
                break;
            }
        }
        if (!anyOtherActive) {
            const cur = await this.getStateAsync(`${config_1.INFO}.isactive`);
            if (cur?.val !== false)
                await this.setState(`${config_1.INFO}.isactive`, false, true);
        }
    }
    // Trigger macro
    async triggerMacro(roomKey, deviceKey, macroKey) {
        const url = `http://${this.brainIp}:${this.brainPort}/${config_1.API_BASE_URL}/rooms/${roomKey}/devices/${deviceKey}/macros/${macroKey}/${config_1.TRIGGER}`;
        try {
            await axios_1.default.get(url);
            this.log.info(`Triggered macro ${macroKey} on device ${deviceKey} in room ${roomKey}`);
        }
        catch (err) {
            this.log.error(`Failed to trigger macro: ${err.message}`);
        }
    }
    // Execute recipe
    async executeRecipe(roomKey, recipeKey) {
        const url = `http://${this.brainIp}:${this.brainPort}/${config_1.API_BASE_URL}/rooms/${roomKey}/recipes/${recipeKey}/${config_1.EXECUTE}`;
        try {
            await axios_1.default.get(url);
            this.log.info(`Executed recipe ${recipeKey} in room ${roomKey}`);
        }
        catch (err) {
            this.log.error(`Failed to execute recipe: ${err.message}`);
        }
    }
    // Volume macro
    async volumeMacro(roomKey, deviceKey, macroKey, repeat, delayMs) {
        repeat = Math.max(1, Math.min(100, Number(repeat) || 1));
        delayMs = Math.max(0, Math.min(5000, Number(delayMs) || 0));
        this.log.info(`Executed volume macro in room ${roomKey}`);
        for (let i = 0; i < repeat; i++) {
            try {
                await this.triggerMacro(roomKey, deviceKey, macroKey);
            }
            catch (err) {
                this.log.warn(`Failed to trigger volume macros: ${err.message}`);
                // optional: break
            }
            if (i < repeat - 1 && delayMs > 0) {
                await new Promise(res => setTimeout(res, delayMs));
            }
        }
    }
    // Update objects only if last update older than xxx
    async updateObjectIfOld(id, newValue) {
        try {
            const state = await this.getStateAsync(id);
            const threshold = config_1.POLL_THRESHOLD * 1000;
            const now = Date.now();
            // Check if object has changed
            if (state && state.val === newValue) {
                this.log.debug(`State ${id} unchanged → skipping`);
                return;
            }
            // Update only if older than POLL_THRESHOLD
            if (state?.ts && typeof state.ts === "number") {
                const age = now - state.ts;
                if (age < threshold) {
                    this.log.debug(`Skipping update for ${id}, age = ${age / 1000}s < ${threshold / 1000}s`);
                    return;
                }
            }
        }
        catch (err) {
        }
        await this.setState(id, newValue, true);
        this.log.debug(`Updated state: ${id} = ${newValue}`);
    }
    // Polling active state of recipes
    RecipePolling(recipes) {
        const intervalSec = Math.max(5, Number(this.pollInterval) || config_1.POLL_INTERVAL);
        const intervalMs = intervalSec * 1000;
        if (this.pollHandle)
            clearInterval(this.pollHandle);
        this.pollHandle = setInterval(async () => {
            var _a;
            const timestamp = new Date().toISOString();
            this.log.debug(`Polling recipes at ${timestamp}`);
            // Check if Brain is alive
            const brainReachable = await this.testBrainOnline();
            if (!brainReachable)
                return;
            const roomActiveMap = {};
            // Check all recipes
            for (const recipe of recipes) {
                const id = `${config_1.ROOMS}.${recipe.roomId}.${config_1.RECIPES}.${recipe.id}.${config_1.ISACTIVE}`;
                const url = `http://${this.brainIp}:${this.brainPort}/${config_1.API_BASE_URL}/${config_1.ROOMS}/${recipe.roomId}/${config_1.RECIPES}/${recipe.id}/${config_1.ISACTIVE}`;
                try {
                    const res = await axios_1.default.get(url);
                    const active = res.data?.active ?? false;
                    // Update recipe isactive status
                    await this.updateObjectIfOld(id, active);
                    if (!roomActiveMap[recipe.roomId]) {
                        roomActiveMap[recipe.roomId] = active;
                    }
                    else {
                        roomActiveMap[_a = recipe.roomId] || (roomActiveMap[_a] = active);
                    }
                    // Update scenario isactive status
                    if (recipe.type === "launch" && recipe.scenarioKey) {
                        const scenId = `${config_1.ROOMS}.${recipe.roomId}.${config_1.SCENARIOS}.${recipe.scenarioKey}.${config_1.ISACTIVE}`;
                        await this.updateObjectIfOld(scenId, active);
                    }
                    this.log.debug(`Polled recipe "${recipe.name}" [${recipe.id}] in room "${recipe.roomId}": active = ${active}`);
                }
                catch (err) {
                    this.log.warn(`Polling failed for recipe ${recipe.name}: ${err.message}`);
                }
            }
            // Update room isactive state
            for (const roomId in roomActiveMap) {
                const roomIsActive = roomActiveMap[roomId];
                await this.updateObjectIfOld(`${config_1.ROOMS}.${roomId}.isactive`, roomIsActive);
            }
            // Update global isactive state
            const isAnyActive = Object.values(roomActiveMap).some(active => active);
            await this.updateObjectIfOld(`${config_1.INFO}.isactive`, isAnyActive);
        }, intervalMs);
    }
    // Check if brain is online
    async testBrainOnline() {
        const url = `http://${this.brainIp}:${this.brainPort}/${config_1.API_BASE_URL}`;
        try {
            await axios_1.default.get(url, { timeout: 5000 });
            await this.setState('info.connection', true, true);
            return true;
        }
        catch {
            await this.setState('info.connection', false, true);
            return false;
        }
    }
    // Delete all objects
    async clearAllObjects() {
        const allObjects = await this.getAdapterObjectsAsync();
        let deleted = 0;
        for (const id in allObjects) {
            await this.delObjectAsync(id, { recursive: true });
            deleted++;
        }
        this.log.debug(`Deleted ${deleted} existing objects`);
    }
    // Shutdown adapter
    onUnload(callback) {
        try {
            this.log.info("Adapter is shutting down...");
            if (this.pollHandle)
                clearInterval(this.pollHandle);
            if (this.roomPowerTimeout)
                clearTimeout(this.roomPowerTimeout);
            callback();
        }
        catch {
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
