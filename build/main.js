"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const adapter_core_1 = require("@iobroker/adapter-core");
const brain_discovery_1 = require("./lib/brain-discovery");
const brain_client_1 = require("./lib/brain-client");
const brain_events_1 = require("./lib/brain-events");
const config_1 = require("./lib/config");
class NeeoAdapter extends adapter_core_1.Adapter {
    constructor(options = {}) {
        super({ ...options, name: "neeo" });
        this.client = null;
        this.events = new brain_events_1.BrainEvents();
        this.model = null;
        this.pollTimer = null;
        this.refreshTimer = null;
        this.resyncTimer = null;
        this.retryTimer = null;
        this.delayTimeouts = new Set();
        this.refreshRunning = false;
        this.on("ready", this.onReady.bind(this));
        this.on("unload", this.onUnload.bind(this));
        this.on("message", this.onMessage.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
    }
    capitalize(text) {
        return text.charAt(0).toUpperCase() + text.slice(1);
    }
    roomConfig(roomKey) {
        const rooms = this.config.rooms;
        return rooms?.find((r) => r.roomKey === roomKey);
    }
    // ------------------------------------------------------------------ start
    async onReady() {
        this.log.info("[main] Adapter started, connecting to NEEO Brain...");
        this.subscribeStates("*");
        await this.connectToBrain();
    }
    async connectToBrain() {
        const model = await (0, brain_discovery_1.fetchNeeoBrainModel)(this);
        if (!model) {
            this.log.warn("[main] Could not fetch NEEO Brain model, retrying in 60s (check IP/port in the adapter settings)");
            await this.setState(`${config_1.INFO}.connection`, false, true);
            this.retryTimer = setTimeout(() => void this.connectToBrain(), 60000);
            return;
        }
        this.model = model;
        this.client = new brain_client_1.BrainClient(model.brainIp, model.brainPort);
        this.log.info(`[main] Brain model loaded: ${model.rooms.length} rooms, ${model.devices.length} devices, ${model.recipes.length} recipes, ${model.scenarios.length} scenarios`);
        await this.syncObjects(model);
        await this.writeStaticStates(model);
        await this.setState(`${config_1.INFO}.brainIp`, model.brainIp, true);
        await this.setState(`${config_1.INFO}.brainPort`, model.brainPort, true);
        await this.setState(`${config_1.INFO}.connection`, true, true);
        await this.refreshActiveStates();
        this.startEvents(model.brainIp, model.brainPort);
        this.startFallbackPolling();
        await this.checkLegacyConfig();
    }
    // --------------------------------------------------------------- push/poll
    startEvents(brainIp, brainPort) {
        this.events.connect(brainIp, brainPort, {
            onConnect: () => {
                this.log.info("[events] Socket.IO connected to brain event stream");
                void this.setState(`${config_1.INFO}.connection`, true, true);
                this.scheduleRefresh();
            },
            onDisconnect: (reason) => {
                this.log.warn(`[events] Socket.IO disconnected: ${reason}`);
                void this.updateConnectionState();
            },
            onActivity: (event) => {
                this.log.debug(`[events] Activity event received: ${event}`);
                this.scheduleRefresh();
            },
            onProjectChanged: () => {
                this.log.info("[events] Brain configuration changed, scheduling model resync");
                this.scheduleResync();
            },
        });
    }
    startFallbackPolling() {
        const configured = Number(this.config.pollInterval ?? config_1.FALLBACK_POLL_INTERVAL);
        const intervalSec = Math.max(config_1.MIN_POLL_INTERVAL, configured || config_1.FALLBACK_POLL_INTERVAL);
        if (this.pollTimer)
            clearInterval(this.pollTimer);
        this.pollTimer = setInterval(() => {
            this.log.debug("[poll] Fallback poll tick");
            void this.updateConnectionState();
            this.scheduleRefresh();
        }, intervalSec * 1000);
        this.log.info(`[poll] Fallback polling every ${intervalSec}s (primary updates come via Socket.IO push)`);
    }
    async updateConnectionState() {
        if (!this.client)
            return;
        const online = this.events.connected || await this.client.isOnline();
        await this.setStateChangedAsync(`${config_1.INFO}.connection`, online, true);
    }
    /** Debounced refresh - collapses event storms (e.g. held volume buttons) into one poll. */
    scheduleRefresh() {
        if (this.refreshTimer)
            clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => void this.refreshActiveStates(), config_1.REFRESH_DEBOUNCE_MS);
    }
    scheduleResync() {
        if (this.resyncTimer)
            clearTimeout(this.resyncTimer);
        this.resyncTimer = setTimeout(() => void this.resyncModel(), config_1.RESYNC_DEBOUNCE_MS);
    }
    async resyncModel() {
        const model = await (0, brain_discovery_1.fetchNeeoBrainModel)(this);
        if (!model) {
            this.log.warn("[main] Model resync failed, keeping current object tree");
            return;
        }
        this.model = model;
        await this.syncObjects(model);
        await this.writeStaticStates(model);
        await this.refreshActiveStates();
        this.log.info("[main] Model resync completed");
    }
    /** Read the authoritative active flags from the brain and update all states. */
    async refreshActiveStates() {
        if (!this.client || !this.model || this.refreshRunning)
            return;
        this.refreshRunning = true;
        try {
            const roomActive = {};
            for (const recipe of this.model.recipes) {
                if (recipe.type !== "launch")
                    continue;
                let active = false;
                try {
                    active = await this.client.isRecipeActive(recipe.roomId, recipe.id);
                }
                catch (err) {
                    this.log.debug(`[poll] isactive failed for recipe ${recipe.name}: ${err.message}`);
                    continue;
                }
                await this.setStateChangedAsync(`${config_1.ROOMS}.${recipe.roomId}.${config_1.RECIPES}.${recipe.id}.${config_1.ISACTIVE}`, active, true);
                if (recipe.scenarioKey) {
                    await this.setStateChangedAsync(`${config_1.ROOMS}.${recipe.roomId}.${config_1.SCENARIOS}.${recipe.scenarioKey}.${config_1.ISACTIVE}`, active, true);
                }
                roomActive[recipe.roomId] = (roomActive[recipe.roomId] ?? false) || active;
            }
            for (const [roomId, active] of Object.entries(roomActive)) {
                await this.setStateChangedAsync(`${config_1.ROOMS}.${roomId}.${config_1.ISACTIVE}`, active, true);
            }
            const anyActive = Object.values(roomActive).some(Boolean);
            await this.setStateChangedAsync(`${config_1.INFO}.${config_1.ISACTIVE}`, anyActive, true);
            this.log.debug("[poll] Active states refreshed");
        }
        finally {
            this.refreshRunning = false;
        }
    }
    // ------------------------------------------------------------- object sync
    /**
     * Bring the object tree in line with the brain model without deleting and
     * recreating everything: create missing objects, update changed ones and
     * remove orphans. State values (and their history) survive restarts.
     */
    async syncObjects(model) {
        const desired = this.buildDesiredObjects(model);
        const existingRaw = await this.getAdapterObjectsAsync();
        const prefix = `${this.namespace}.`;
        const existing = {};
        for (const [fullId, obj] of Object.entries(existingRaw)) {
            existing[fullId.startsWith(prefix) ? fullId.slice(prefix.length) : fullId] = obj;
        }
        let created = 0, updated = 0, deleted = 0;
        for (const [id, want] of Object.entries(desired)) {
            const have = existing[id];
            if (!have) {
                await this.setObjectNotExistsAsync(id, want);
                created++;
            }
            else if (JSON.stringify(have.common) !== JSON.stringify({ ...have.common, ...want.common }) ||
                JSON.stringify(have.native) !== JSON.stringify(want.native)) {
                await this.extendObjectAsync(id, { common: want.common, native: want.native });
                updated++;
            }
        }
        // instanceObjects from io-package.json are managed by the controller
        const keep = new Set([config_1.INFO, `${config_1.INFO}.connection`]);
        const orphans = Object.keys(existing)
            .filter((id) => !desired[id] && !keep.has(id))
            .sort((a, b) => b.length - a.length);
        for (const id of orphans) {
            await this.delObjectAsync(id);
            deleted++;
        }
        this.log.info(`[sync] Object sync done: ${created} created, ${updated} updated, ${deleted} removed`);
    }
    buildDesiredObjects(model) {
        const desired = {};
        // ---- info states
        desired[`${config_1.INFO}.brainIp`] = {
            type: "state",
            common: { name: "Brain IP Address", type: "string", role: "text", read: true, write: false },
            native: {}
        };
        desired[`${config_1.INFO}.brainPort`] = {
            type: "state",
            common: { name: "Brain Port", type: "number", role: "value", read: true, write: false },
            native: {}
        };
        desired[`${config_1.INFO}.${config_1.ISACTIVE}`] = {
            type: "state",
            common: { name: "Global Active Status", type: "boolean", role: "indicator.status", read: true, write: false, def: false },
            native: {}
        };
        desired[`${config_1.INFO}.powerToggle`] = {
            type: "state",
            common: { name: "Global Power Toggle", type: "boolean", role: "button", read: false, write: true, def: false },
            native: {}
        };
        // ---- rooms
        for (const room of model.rooms) {
            const roomId = `${config_1.ROOMS}.${room.id}`;
            desired[roomId] = {
                type: "channel",
                common: { name: room.name },
                native: { roomKey: room.id, roomName: room.name }
            };
            desired[`${roomId}.${config_1.ISACTIVE}`] = {
                type: "state",
                common: { name: "Room Active Status", type: "boolean", role: "indicator.status", read: true, write: false, def: false },
                native: { roomKey: room.id }
            };
            desired[`${roomId}.powerToggle`] = {
                type: "state",
                common: { name: "Room Power Toggle", type: "boolean", role: "button", read: false, write: true, def: false },
                native: { roomKey: room.id }
            };
            desired[`${roomId}.volumeUp`] = {
                type: "state",
                common: { name: "Volume Up", type: "boolean", role: "button.volume.up", read: false, write: true, def: false },
                native: { roomKey: room.id }
            };
            desired[`${roomId}.volumeDown`] = {
                type: "state",
                common: { name: "Volume Down", type: "boolean", role: "button.volume.down", read: false, write: true, def: false },
                native: { roomKey: room.id }
            };
            if (room.devices.length > 0) {
                desired[`${roomId}.${config_1.DEVICES}`] = { type: "folder", common: { name: this.capitalize(config_1.DEVICES) }, native: {} };
            }
            if (room.recipes.length > 0) {
                desired[`${roomId}.${config_1.RECIPES}`] = { type: "folder", common: { name: this.capitalize(config_1.RECIPES) }, native: {} };
            }
            if (room.scenarios.length > 0) {
                desired[`${roomId}.${config_1.SCENARIOS}`] = { type: "folder", common: { name: this.capitalize(config_1.SCENARIOS) }, native: {} };
            }
        }
        // ---- devices, macros, commands
        for (const device of model.devices) {
            const devId = `${config_1.ROOMS}.${device.roomId}.${config_1.DEVICES}.${device.id}`;
            desired[devId] = {
                type: "channel",
                common: { name: device.name },
                native: { deviceKey: device.id, roomKey: device.roomId, type: device.type }
            };
            desired[`${devId}.manufacturer`] = {
                type: "state",
                common: { name: "Manufacturer", type: "string", role: "text", read: true, write: false },
                native: {}
            };
            desired[`${devId}.modelName`] = {
                type: "state",
                common: { name: "Model Name", type: "string", role: "text", read: true, write: false },
                native: {}
            };
            desired[`${devId}.deviceType`] = {
                type: "state",
                common: { name: "Device Type", type: "string", role: "text", read: true, write: false },
                native: {}
            };
            if (device.macros && device.macros.length > 0) {
                desired[`${devId}.${config_1.MACROS}`] = { type: "folder", common: { name: this.capitalize(config_1.MACROS) }, native: {} };
                for (const macro of device.macros) {
                    desired[`${devId}.${config_1.MACROS}.${macro.id}`] = {
                        type: "state",
                        common: { name: macro.label || macro.name, type: "boolean", role: "button", read: false, write: true, def: false },
                        native: { macroKey: macro.id, deviceKey: device.id, roomKey: device.roomId }
                    };
                }
            }
            if (device.genericMacros && device.genericMacros.length > 0) {
                desired[`${devId}.${config_1.COMMANDS}`] = { type: "folder", common: { name: this.capitalize(config_1.COMMANDS) }, native: {} };
                for (const command of device.genericMacros) {
                    const commandId = `${devId}.${config_1.COMMANDS}.${command.name.replace(/\s+/g, '_')}`;
                    desired[commandId] = {
                        type: "state",
                        common: { name: command.label || command.name, type: "boolean", role: "button", read: false, write: true, def: false },
                        native: { macroKey: command.id, deviceKey: device.id, roomKey: device.roomId }
                    };
                }
            }
        }
        // ---- recipes
        for (const recipe of model.recipes) {
            const recId = `${config_1.ROOMS}.${recipe.roomId}.${config_1.RECIPES}.${recipe.id}`;
            desired[recId] = {
                type: "channel",
                common: { name: recipe.name },
                native: {
                    recipeKey: recipe.id,
                    roomKey: recipe.roomId,
                    type: recipe.type,
                    scenarioKey: recipe.scenarioKey ?? null,
                    hidden: recipe.hidden === true
                }
            };
            desired[`${recId}.${config_1.ISACTIVE}`] = {
                type: "state",
                common: { name: "Active Status", type: "boolean", role: "indicator.status", read: true, write: false, def: false },
                native: { roomKey: recipe.roomId, recipeKey: recipe.id }
            };
            desired[`${recId}.${config_1.EXECUTE}`] = {
                type: "state",
                common: { name: "Execute Recipe", type: "boolean", role: "button", read: false, write: true, def: false },
                native: {
                    roomKey: recipe.roomId,
                    recipeKey: recipe.id,
                    type: recipe.type,
                    scenarioKey: recipe.scenarioKey ?? null
                }
            };
        }
        // ---- scenarios (launch/poweroff pairs)
        for (const { roomId, scenarioKey, launch, poweroff } of this.collectScenarioPairs(model)) {
            const scenId = `${config_1.ROOMS}.${roomId}.${config_1.SCENARIOS}.${scenarioKey}`;
            const scenNative = { roomKey: roomId, scenarioKey, launchId: launch.id, poweroffId: poweroff.id };
            desired[scenId] = {
                type: "channel",
                common: { name: launch.name.replace(/\s*-\s*launch$/i, '') || `Scenario ${scenarioKey}` },
                native: scenNative
            };
            desired[`${scenId}.launch`] = {
                type: "state",
                common: { name: "Recipe ID launch", type: "string", role: "text", read: true, write: false },
                native: {}
            };
            desired[`${scenId}.poweroff`] = {
                type: "state",
                common: { name: "Recipe ID poweroff", type: "string", role: "text", read: true, write: false },
                native: {}
            };
            desired[`${scenId}.${config_1.ISACTIVE}`] = {
                type: "state",
                common: { name: "Scenario Status", type: "boolean", role: "indicator.status", read: true, write: false, def: false },
                native: scenNative
            };
            desired[`${scenId}.powerToggle`] = {
                type: "state",
                common: { name: "Scenario Power Toggle", type: "boolean", role: "button", read: false, write: true, def: false },
                native: scenNative
            };
        }
        return desired;
    }
    collectScenarioPairs(model) {
        const map = {};
        for (const recipe of model.recipes) {
            if (!recipe.scenarioKey)
                continue;
            const key = `${recipe.roomId}|${recipe.scenarioKey}`;
            map[key] ?? (map[key] = { roomId: recipe.roomId, scenarioKey: recipe.scenarioKey });
            if (recipe.type === 'launch')
                map[key].launch = recipe;
            if (recipe.type === 'poweroff')
                map[key].poweroff = recipe;
        }
        return Object.values(map).filter((p) => !!p.launch && !!p.poweroff);
    }
    /** Legacy v1.x kept its room settings in 0_userdata - point the user at the new config. */
    async checkLegacyConfig() {
        try {
            const legacy = await this.getForeignObjectAsync(`${config_1.LEGACY_CUSTOM_PATH}.${this.instance}`);
            if (legacy) {
                this.log.warn(`[main] Legacy room settings found under ${config_1.LEGACY_CUSTOM_PATH}.${this.instance} - these are no longer used. Configure rooms in the adapter settings and delete the old objects.`);
            }
        }
        catch {
            // ignore - purely informational
        }
    }
    // ------------------------------------------------------------ state values
    /** Write static device info after object sync. */
    async writeStaticStates(model) {
        for (const device of model.devices) {
            const devId = `${config_1.ROOMS}.${device.roomId}.${config_1.DEVICES}.${device.id}`;
            const details = device.details || {};
            await this.setStateChangedAsync(`${devId}.manufacturer`, details.manufacturer ?? "", true);
            await this.setStateChangedAsync(`${devId}.modelName`, details.name ?? "", true);
            await this.setStateChangedAsync(`${devId}.deviceType`, details.type ?? "", true);
        }
        for (const pair of this.collectScenarioPairs(model)) {
            const scenId = `${config_1.ROOMS}.${pair.roomId}.${config_1.SCENARIOS}.${pair.scenarioKey}`;
            await this.setStateChangedAsync(`${scenId}.launch`, pair.launch.id, true);
            await this.setStateChangedAsync(`${scenId}.poweroff`, pair.poweroff.id, true);
        }
    }
    // -------------------------------------------------------------- messagebox
    /** Provide dropdown options for the admin room configuration (selectSendTo). */
    async onMessage(obj) {
        if (!obj?.command)
            return;
        this.log.debug(`[msg] Received command "${obj.command}" from ${obj.from}`);
        const model = this.model ?? await (0, brain_discovery_1.fetchNeeoBrainModel)(this);
        if (model && !this.model)
            this.model = model;
        const roomName = (roomId) => model?.rooms.find((r) => r.id === roomId)?.name ?? roomId;
        let options = [];
        switch (obj.command) {
            case "getRoomOptions":
                options = (model?.rooms ?? []).map((r) => ({ label: r.name, value: r.id }));
                break;
            case "getRecipeOptions":
                options = (model?.recipes ?? [])
                    .filter((r) => r.type === "launch")
                    .map((r) => ({
                    label: `${roomName(r.roomId)}: ${r.name.replace(/\s*-\s*launch$/i, '')}${r.hidden ? ' (hidden)' : ''}`,
                    value: r.id
                }));
                break;
            case "getDeviceOptions":
                options = (model?.devices ?? []).map((d) => ({ label: `${roomName(d.roomId)}: ${d.name}`, value: d.id }));
                break;
            case "getMacroOptions":
                options = (model?.devices ?? []).flatMap((d) => (d.macros ?? []).map((m) => ({
                    label: `${roomName(d.roomId)} / ${d.name}: ${m.label || m.name}`,
                    value: m.id
                })));
                break;
            default:
                this.log.debug(`[msg] Unknown command: ${obj.command}`);
                return;
        }
        options.sort((a, b) => a.label.localeCompare(b.label));
        this.log.debug(`[msg] Answering "${obj.command}" with ${options.length} options`);
        if (obj.callback)
            this.sendTo(obj.from, obj.command, options, obj.callback);
    }
    // ------------------------------------------------------------ state change
    async onStateChange(id, state) {
        if (!state || state.ack || state.val !== true || !this.client)
            return;
        const shortId = id.startsWith(`${this.namespace}.`) ? id.slice(this.namespace.length + 1) : id;
        const obj = await this.getObjectAsync(shortId);
        const native = obj?.native || {};
        try {
            if (shortId.endsWith(`.${config_1.EXECUTE}`) && shortId.includes(`.${config_1.RECIPES}.`)) {
                await this.handleRecipeExecute(native);
            }
            else if (shortId.includes(`.${config_1.MACROS}.`) || shortId.includes(`.${config_1.COMMANDS}.`)) {
                await this.handleMacroTrigger(native);
            }
            else if (shortId.endsWith(".powerToggle") && shortId.includes(`.${config_1.SCENARIOS}.`)) {
                await this.handleScenarioToggle(native);
            }
            else if (shortId.endsWith(".powerToggle") && shortId.startsWith(`${config_1.ROOMS}.`)) {
                await this.handleRoomToggle(native.roomKey);
            }
            else if (shortId === `${config_1.INFO}.powerToggle`) {
                await this.handleGlobalToggle();
            }
            else if ((shortId.endsWith(".volumeUp") || shortId.endsWith(".volumeDown")) && shortId.startsWith(`${config_1.ROOMS}.`)) {
                await this.handleVolume(native.roomKey, shortId.endsWith(".volumeUp"));
            }
            else {
                this.log.debug(`[state] Unhandled state change: ${shortId}`);
            }
        }
        catch (err) {
            this.log.error(`[state] Handling ${shortId} failed: ${err.message}`);
        }
    }
    async handleRecipeExecute(native) {
        const { roomKey, recipeKey, type, scenarioKey } = native;
        if (!roomKey || !recipeKey)
            return;
        await this.client.executeRecipe(roomKey, recipeKey);
        this.log.info(`[brain] Executed recipe ${recipeKey} (${type}) in room ${roomKey}`);
        // Optimistic feedback - the push event plus debounced refresh delivers the truth.
        const isLaunch = type === "launch";
        await this.setStateChangedAsync(`${config_1.ROOMS}.${roomKey}.${config_1.RECIPES}.${recipeKey}.${config_1.ISACTIVE}`, isLaunch, true);
        if (scenarioKey) {
            await this.setStateChangedAsync(`${config_1.ROOMS}.${roomKey}.${config_1.SCENARIOS}.${scenarioKey}.${config_1.ISACTIVE}`, isLaunch, true);
        }
        this.scheduleRefresh();
    }
    async handleMacroTrigger(native) {
        const { roomKey, deviceKey, macroKey } = native;
        if (!roomKey || !deviceKey || !macroKey) {
            this.log.warn(`[brain] Macro trigger skipped, incomplete native data`);
            return;
        }
        await this.client.triggerMacro(roomKey, deviceKey, macroKey);
        this.log.info(`[brain] Triggered macro ${macroKey} on device ${deviceKey} in room ${roomKey}`);
    }
    async handleScenarioToggle(native) {
        const { roomKey, scenarioKey, launchId, poweroffId } = native;
        if (!roomKey || !scenarioKey || !launchId || !poweroffId)
            return;
        const isActive = (await this.getStateAsync(`${config_1.ROOMS}.${roomKey}.${config_1.SCENARIOS}.${scenarioKey}.${config_1.ISACTIVE}`))?.val === true;
        const target = isActive ? poweroffId : launchId;
        await this.handleRecipeExecute({ roomKey, recipeKey: target, type: isActive ? "poweroff" : "launch", scenarioKey });
    }
    async handleRoomToggle(roomKey) {
        if (!roomKey || !this.model)
            return;
        const isActive = (await this.getStateAsync(`${config_1.ROOMS}.${roomKey}.${config_1.ISACTIVE}`))?.val === true;
        if (isActive) {
            // Power off whatever scenario is currently active in this room
            for (const pair of this.collectScenarioPairs(this.model).filter((p) => p.roomId === roomKey)) {
                const scenActive = (await this.getStateAsync(`${config_1.ROOMS}.${roomKey}.${config_1.SCENARIOS}.${pair.scenarioKey}.${config_1.ISACTIVE}`))?.val === true;
                if (scenActive) {
                    await this.handleRecipeExecute({ roomKey, recipeKey: pair.poweroff.id, type: "poweroff", scenarioKey: pair.scenarioKey });
                    return;
                }
            }
            this.log.warn(`[brain] Room ${roomKey} has no active scenario to power off`);
            return;
        }
        const cfg = this.roomConfig(roomKey);
        if (!cfg?.defaultRecipe) {
            this.log.warn(`[brain] No default recipe configured for room ${roomKey} (see adapter settings, tab Rooms)`);
            return;
        }
        const recipe = this.model.recipes.find((r) => r.id === cfg.defaultRecipe);
        const exec = async () => {
            try {
                await this.handleRecipeExecute({
                    roomKey,
                    recipeKey: cfg.defaultRecipe,
                    type: recipe?.type ?? "launch",
                    scenarioKey: recipe?.scenarioKey
                });
            }
            catch (err) {
                this.log.error(`[brain] Room power-on failed: ${err.message}`);
            }
        };
        const delayMs = Math.max(0, Number(cfg.delay ?? 0)) * 1000;
        if (delayMs > 0) {
            this.log.debug(`[brain] Room ${roomKey} power-on delayed by ${delayMs / 1000}s`);
            this.trackTimeout(exec, delayMs);
        }
        else {
            await exec();
        }
    }
    async handleGlobalToggle() {
        if (!this.model)
            return;
        const globalActive = (await this.getStateAsync(`${config_1.INFO}.${config_1.ISACTIVE}`))?.val === true;
        for (const room of this.model.rooms) {
            const roomActive = (await this.getStateAsync(`${config_1.ROOMS}.${room.id}.${config_1.ISACTIVE}`))?.val === true;
            if (globalActive) {
                // Switch everything off that is running
                if (roomActive) {
                    this.log.debug(`[brain] Global toggle: powering off room ${room.name}`);
                    await this.setState(`${config_1.ROOMS}.${room.id}.powerToggle`, true, false);
                }
                continue;
            }
            const cfg = this.roomConfig(room.id);
            if (!cfg?.includeGlobal || !cfg.defaultRecipe || roomActive)
                continue;
            const delayMs = Math.max(0, Number(cfg.delay ?? 0)) * 1000;
            const fire = () => {
                this.log.debug(`[brain] Global toggle: powering on room ${room.name}`);
                void this.setState(`${config_1.ROOMS}.${room.id}.powerToggle`, true, false);
            };
            if (delayMs > 0)
                this.trackTimeout(fire, delayMs);
            else
                fire();
        }
    }
    async handleVolume(roomKey, up) {
        const cfg = this.roomConfig(roomKey);
        const macroKey = up ? cfg?.volUp : cfg?.volDown;
        if (!cfg?.volDevice || !macroKey) {
            this.log.warn(`[brain] Volume ${up ? "up" : "down"} not configured for room ${roomKey} (see adapter settings, tab Rooms)`);
            return;
        }
        const repeat = Math.max(1, Math.min(20, Number(cfg.volRepeat) || 1));
        const delayMs = Math.max(0, Math.min(1000, Number(cfg.volDelay) || 0));
        this.log.info(`[brain] Volume ${up ? "up" : "down"} x${repeat} in room ${roomKey}`);
        for (let i = 0; i < repeat; i++) {
            try {
                await this.client.triggerMacro(roomKey, cfg.volDevice, macroKey);
            }
            catch (err) {
                this.log.warn(`[brain] Volume macro failed: ${err.message}`);
                break;
            }
            if (i < repeat - 1 && delayMs > 0) {
                await new Promise((res) => setTimeout(res, delayMs));
            }
        }
    }
    // ---------------------------------------------------------------- helpers
    trackTimeout(fn, ms) {
        const handle = setTimeout(() => {
            this.delayTimeouts.delete(handle);
            void fn();
        }, ms);
        this.delayTimeouts.add(handle);
    }
    onUnload(callback) {
        try {
            this.log.info("[main] Adapter is shutting down...");
            this.events.close();
            if (this.pollTimer)
                clearInterval(this.pollTimer);
            if (this.refreshTimer)
                clearTimeout(this.refreshTimer);
            if (this.resyncTimer)
                clearTimeout(this.resyncTimer);
            if (this.retryTimer)
                clearTimeout(this.retryTimer);
            for (const handle of this.delayTimeouts)
                clearTimeout(handle);
            this.delayTimeouts.clear();
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
