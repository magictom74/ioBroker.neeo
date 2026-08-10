import { Adapter, AdapterOptions } from '@iobroker/adapter-core';
import { fetchNeeoBrainModel } from './lib/brain-discovery';
import { BrainClient } from './lib/brain-client';
import { BrainEvents } from './lib/brain-events';
import { NeeoBrainModel, BrainRecipe } from './lib/brain-types';
import {
    ROOMS, INFO, DEVICES, RECIPES, SCENARIOS, MACROS, COMMANDS, EXECUTE, ISACTIVE,
    FALLBACK_POLL_INTERVAL, MIN_POLL_INTERVAL, REFRESH_DEBOUNCE_MS, RESYNC_DEBOUNCE_MS,
    LEGACY_CUSTOM_PATH
} from './lib/config';

interface RoomConfig {
    roomKey: string;
    defaultRecipe: string;
    delay: number;
    includeGlobal: boolean;
    volDevice: string;
    volUp: string;
    volDown: string;
    volRepeat: number;
    volDelay: number;
}

interface DesiredObject {
    type: ioBroker.ObjectType;
    common: Record<string, any>;
    native: Record<string, any>;
}

class NeeoAdapter extends Adapter {
    private client: BrainClient | null = null;
    private events = new BrainEvents();
    private model: NeeoBrainModel | null = null;

    private pollTimer: NodeJS.Timeout | null = null;
    private refreshTimer: NodeJS.Timeout | null = null;
    private resyncTimer: NodeJS.Timeout | null = null;
    private retryTimer: NodeJS.Timeout | null = null;
    private delayTimeouts = new Set<NodeJS.Timeout>();
    private refreshRunning = false;

    constructor(options: Partial<AdapterOptions> = {}) {
        super({ ...options, name: "neeo" });
        this.on("ready", this.onReady.bind(this));
        this.on("unload", this.onUnload.bind(this));
        this.on("message", this.onMessage.bind(this));
        (this as any).on("stateChange", this.onStateChange.bind(this));
    }

    private capitalize(text: string): string {
        return text.charAt(0).toUpperCase() + text.slice(1);
    }

    private roomConfig(roomKey: string): RoomConfig | undefined {
        const rooms = (this.config as any).rooms as RoomConfig[] | undefined;
        return rooms?.find((r) => r.roomKey === roomKey);
    }

    // ------------------------------------------------------------------ start

    private async onReady(): Promise<void> {
        this.log.info("[main] Adapter started, connecting to NEEO Brain...");
        this.subscribeStates("*");
        await this.connectToBrain();
    }

    private async connectToBrain(): Promise<void> {
        const model = await fetchNeeoBrainModel(this);
        if (!model) {
            this.log.warn("[main] Could not fetch NEEO Brain model, retrying in 60s (check IP/port in the adapter settings)");
            await this.setState(`${INFO}.connection`, false, true);
            this.retryTimer = setTimeout(() => void this.connectToBrain(), 60000);
            return;
        }

        this.model = model;
        this.client = new BrainClient(model.brainIp, model.brainPort);

        this.log.info(`[main] Brain model loaded: ${model.rooms.length} rooms, ${model.devices.length} devices, ${model.recipes.length} recipes, ${model.scenarios.length} scenarios`);

        await this.syncObjects(model);
        await this.writeStaticStates(model);
        await this.setState(`${INFO}.brainIp`, model.brainIp, true);
        await this.setState(`${INFO}.brainPort`, model.brainPort, true);
        await this.setState(`${INFO}.connection`, true, true);

        await this.refreshActiveStates();
        this.startEvents(model.brainIp, model.brainPort);
        this.startFallbackPolling();
        await this.checkLegacyConfig();
    }

    // --------------------------------------------------------------- push/poll

    private startEvents(brainIp: string, brainPort: number): void {
        this.events.connect(brainIp, brainPort, {
            onConnect: () => {
                this.log.info("[events] Socket.IO connected to brain event stream");
                void this.setState(`${INFO}.connection`, true, true);
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

    private startFallbackPolling(): void {
        const configured = Number((this.config as any).pollInterval ?? FALLBACK_POLL_INTERVAL);
        const intervalSec = Math.max(MIN_POLL_INTERVAL, configured || FALLBACK_POLL_INTERVAL);
        if (this.pollTimer) clearInterval(this.pollTimer);
        this.pollTimer = setInterval(() => {
            this.log.debug("[poll] Fallback poll tick");
            void this.updateConnectionState();
            this.scheduleRefresh();
        }, intervalSec * 1000);
        this.log.info(`[poll] Fallback polling every ${intervalSec}s (primary updates come via Socket.IO push)`);
    }

    private async updateConnectionState(): Promise<void> {
        if (!this.client) return;
        const online = this.events.connected || await this.client.isOnline();
        await this.setStateChangedAsync(`${INFO}.connection`, online, true);
    }

    /** Debounced refresh - collapses event storms (e.g. held volume buttons) into one poll. */
    private scheduleRefresh(): void {
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => void this.refreshActiveStates(), REFRESH_DEBOUNCE_MS);
    }

    private scheduleResync(): void {
        if (this.resyncTimer) clearTimeout(this.resyncTimer);
        this.resyncTimer = setTimeout(() => void this.resyncModel(), RESYNC_DEBOUNCE_MS);
    }

    private async resyncModel(): Promise<void> {
        const model = await fetchNeeoBrainModel(this);
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
    private async refreshActiveStates(): Promise<void> {
        if (!this.client || !this.model || this.refreshRunning) return;
        this.refreshRunning = true;
        try {
            const roomActive: Record<string, boolean> = {};
            for (const recipe of this.model.recipes) {
                if (recipe.type !== "launch") continue;
                let active = false;
                try {
                    active = await this.client.isRecipeActive(recipe.roomId, recipe.id);
                } catch (err: any) {
                    this.log.debug(`[poll] isactive failed for recipe ${recipe.name}: ${err.message}`);
                    continue;
                }
                await this.setStateChangedAsync(`${ROOMS}.${recipe.roomId}.${RECIPES}.${recipe.id}.${ISACTIVE}`, active, true);
                if (recipe.scenarioKey) {
                    await this.setStateChangedAsync(`${ROOMS}.${recipe.roomId}.${SCENARIOS}.${recipe.scenarioKey}.${ISACTIVE}`, active, true);
                }
                roomActive[recipe.roomId] = (roomActive[recipe.roomId] ?? false) || active;
            }
            for (const [roomId, active] of Object.entries(roomActive)) {
                await this.setStateChangedAsync(`${ROOMS}.${roomId}.${ISACTIVE}`, active, true);
            }
            const anyActive = Object.values(roomActive).some(Boolean);
            await this.setStateChangedAsync(`${INFO}.${ISACTIVE}`, anyActive, true);
            this.log.debug("[poll] Active states refreshed");
        } finally {
            this.refreshRunning = false;
        }
    }

    // ------------------------------------------------------------- object sync

    /**
     * Bring the object tree in line with the brain model without deleting and
     * recreating everything: create missing objects, update changed ones and
     * remove orphans. State values (and their history) survive restarts.
     */
    private async syncObjects(model: NeeoBrainModel): Promise<void> {
        const desired = this.buildDesiredObjects(model);

        const existingRaw = await this.getAdapterObjectsAsync();
        const prefix = `${this.namespace}.`;
        const existing: Record<string, ioBroker.Object> = {};
        for (const [fullId, obj] of Object.entries(existingRaw)) {
            existing[fullId.startsWith(prefix) ? fullId.slice(prefix.length) : fullId] = obj as ioBroker.Object;
        }

        let created = 0, updated = 0, deleted = 0;

        for (const [id, want] of Object.entries(desired)) {
            const have = existing[id];
            if (!have) {
                await this.setObjectNotExistsAsync(id, want as any);
                created++;
            } else if (
                JSON.stringify(have.common) !== JSON.stringify({ ...have.common, ...want.common }) ||
                JSON.stringify(have.native) !== JSON.stringify(want.native)
            ) {
                await this.extendObjectAsync(id, { common: want.common, native: want.native } as any);
                updated++;
            }
        }

        // instanceObjects from io-package.json are managed by the controller
        const keep = new Set([INFO, `${INFO}.connection`]);
        const orphans = Object.keys(existing)
            .filter((id) => !desired[id] && !keep.has(id))
            .sort((a, b) => b.length - a.length);
        for (const id of orphans) {
            await this.delObjectAsync(id);
            deleted++;
        }

        this.log.info(`[sync] Object sync done: ${created} created, ${updated} updated, ${deleted} removed`);
    }

    private buildDesiredObjects(model: NeeoBrainModel): Record<string, DesiredObject> {
        const desired: Record<string, DesiredObject> = {};

        // ---- info states
        desired[`${INFO}.brainIp`] = {
            type: "state",
            common: { name: "Brain IP Address", type: "string", role: "text", read: true, write: false },
            native: {}
        };
        desired[`${INFO}.brainPort`] = {
            type: "state",
            common: { name: "Brain Port", type: "number", role: "value", read: true, write: false },
            native: {}
        };
        desired[`${INFO}.${ISACTIVE}`] = {
            type: "state",
            common: { name: "Global Active Status", type: "boolean", role: "indicator.status", read: true, write: false, def: false },
            native: {}
        };
        desired[`${INFO}.powerToggle`] = {
            type: "state",
            common: { name: "Global Power Toggle", type: "boolean", role: "button", read: false, write: true, def: false },
            native: {}
        };

        // ---- rooms
        for (const room of model.rooms) {
            const roomId = `${ROOMS}.${room.id}`;
            desired[roomId] = {
                type: "channel",
                common: { name: room.name },
                native: { roomKey: room.id, roomName: room.name }
            };
            desired[`${roomId}.${ISACTIVE}`] = {
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
                desired[`${roomId}.${DEVICES}`] = { type: "folder", common: { name: this.capitalize(DEVICES) }, native: {} };
            }
            if (room.recipes.length > 0) {
                desired[`${roomId}.${RECIPES}`] = { type: "folder", common: { name: this.capitalize(RECIPES) }, native: {} };
            }
            if (room.scenarios.length > 0) {
                desired[`${roomId}.${SCENARIOS}`] = { type: "folder", common: { name: this.capitalize(SCENARIOS) }, native: {} };
            }
        }

        // ---- devices, macros, commands
        for (const device of model.devices) {
            const devId = `${ROOMS}.${device.roomId}.${DEVICES}.${device.id}`;
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
                desired[`${devId}.${MACROS}`] = { type: "folder", common: { name: this.capitalize(MACROS) }, native: {} };
                for (const macro of device.macros) {
                    desired[`${devId}.${MACROS}.${macro.id}`] = {
                        type: "state",
                        common: { name: macro.label || macro.name, type: "boolean", role: "button", read: false, write: true, def: false },
                        native: { macroKey: macro.id, deviceKey: device.id, roomKey: device.roomId }
                    };
                }
            }

            if (device.genericMacros && device.genericMacros.length > 0) {
                desired[`${devId}.${COMMANDS}`] = { type: "folder", common: { name: this.capitalize(COMMANDS) }, native: {} };
                for (const command of device.genericMacros) {
                    const commandId = `${devId}.${COMMANDS}.${command.name.replace(/\s+/g, '_')}`;
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
            const recId = `${ROOMS}.${recipe.roomId}.${RECIPES}.${recipe.id}`;
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
            desired[`${recId}.${ISACTIVE}`] = {
                type: "state",
                common: { name: "Active Status", type: "boolean", role: "indicator.status", read: true, write: false, def: false },
                native: { roomKey: recipe.roomId, recipeKey: recipe.id }
            };
            desired[`${recId}.${EXECUTE}`] = {
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
            const scenId = `${ROOMS}.${roomId}.${SCENARIOS}.${scenarioKey}`;
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
            desired[`${scenId}.${ISACTIVE}`] = {
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

    private collectScenarioPairs(model: NeeoBrainModel): Array<{ roomId: string; scenarioKey: string; launch: BrainRecipe; poweroff: BrainRecipe }> {
        const map: Record<string, { roomId: string; scenarioKey: string; launch?: BrainRecipe; poweroff?: BrainRecipe }> = {};
        for (const recipe of model.recipes) {
            if (!recipe.scenarioKey) continue;
            const key = `${recipe.roomId}|${recipe.scenarioKey}`;
            map[key] ??= { roomId: recipe.roomId, scenarioKey: recipe.scenarioKey };
            if (recipe.type === 'launch') map[key].launch = recipe;
            if (recipe.type === 'poweroff') map[key].poweroff = recipe;
        }
        return Object.values(map).filter((p): p is { roomId: string; scenarioKey: string; launch: BrainRecipe; poweroff: BrainRecipe } =>
            !!p.launch && !!p.poweroff);
    }

    /** Legacy v1.x kept its room settings in 0_userdata - point the user at the new config. */
    private async checkLegacyConfig(): Promise<void> {
        try {
            const legacy = await this.getForeignObjectAsync(`${LEGACY_CUSTOM_PATH}.${this.instance}`);
            if (legacy) {
                this.log.warn(`[main] Legacy room settings found under ${LEGACY_CUSTOM_PATH}.${this.instance} - these are no longer used. Configure rooms in the adapter settings and delete the old objects.`);
            }
        } catch {
            // ignore - purely informational
        }
    }

    // ------------------------------------------------------------ state values

    /** Write static device info after object sync. */
    private async writeStaticStates(model: NeeoBrainModel): Promise<void> {
        for (const device of model.devices) {
            const devId = `${ROOMS}.${device.roomId}.${DEVICES}.${device.id}`;
            const details = device.details || {};
            await this.setStateChangedAsync(`${devId}.manufacturer`, details.manufacturer ?? "", true);
            await this.setStateChangedAsync(`${devId}.modelName`, details.name ?? "", true);
            await this.setStateChangedAsync(`${devId}.deviceType`, details.type ?? "", true);
        }
        for (const pair of this.collectScenarioPairs(model)) {
            const scenId = `${ROOMS}.${pair.roomId}.${SCENARIOS}.${pair.scenarioKey}`;
            await this.setStateChangedAsync(`${scenId}.launch`, pair.launch.id, true);
            await this.setStateChangedAsync(`${scenId}.poweroff`, pair.poweroff.id, true);
        }
    }

    // -------------------------------------------------------------- messagebox

    /** Provide dropdown options for the admin room configuration (selectSendTo). */
    private async onMessage(obj: ioBroker.Message): Promise<void> {
        if (!obj?.command) return;
        this.log.debug(`[msg] Received command "${obj.command}" from ${obj.from}`);

        const model = this.model ?? await fetchNeeoBrainModel(this);
        if (model && !this.model) this.model = model;

        const roomName = (roomId: string): string => model?.rooms.find((r) => r.id === roomId)?.name ?? roomId;
        let options: Array<{ label: string; value: string }> = [];

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
                options = (model?.devices ?? []).flatMap((d) =>
                    (d.macros ?? []).map((m) => ({
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
        if (obj.callback) this.sendTo(obj.from, obj.command, options, obj.callback);
    }

    // ------------------------------------------------------------ state change

    private async onStateChange(id: string, state: ioBroker.State | null): Promise<void> {
        if (!state || state.ack || state.val !== true || !this.client) return;

        const shortId = id.startsWith(`${this.namespace}.`) ? id.slice(this.namespace.length + 1) : id;
        const obj = await this.getObjectAsync(shortId);
        const native = obj?.native || {};

        try {
            if (shortId.endsWith(`.${EXECUTE}`) && shortId.includes(`.${RECIPES}.`)) {
                await this.handleRecipeExecute(native);
            } else if (shortId.includes(`.${MACROS}.`) || shortId.includes(`.${COMMANDS}.`)) {
                await this.handleMacroTrigger(native);
            } else if (shortId.endsWith(".powerToggle") && shortId.includes(`.${SCENARIOS}.`)) {
                await this.handleScenarioToggle(native);
            } else if (shortId.endsWith(".powerToggle") && shortId.startsWith(`${ROOMS}.`)) {
                await this.handleRoomToggle(native.roomKey);
            } else if (shortId === `${INFO}.powerToggle`) {
                await this.handleGlobalToggle();
            } else if ((shortId.endsWith(".volumeUp") || shortId.endsWith(".volumeDown")) && shortId.startsWith(`${ROOMS}.`)) {
                await this.handleVolume(native.roomKey, shortId.endsWith(".volumeUp"));
            } else {
                this.log.debug(`[state] Unhandled state change: ${shortId}`);
            }
        } catch (err: any) {
            this.log.error(`[state] Handling ${shortId} failed: ${err.message}`);
        }
    }

    private async handleRecipeExecute(native: Record<string, any>): Promise<void> {
        const { roomKey, recipeKey, type, scenarioKey } = native;
        if (!roomKey || !recipeKey) return;

        await this.client!.executeRecipe(roomKey, recipeKey);
        this.log.info(`[brain] Executed recipe ${recipeKey} (${type}) in room ${roomKey}`);

        // Optimistic feedback - the push event plus debounced refresh delivers the truth.
        const isLaunch = type === "launch";
        await this.setStateChangedAsync(`${ROOMS}.${roomKey}.${RECIPES}.${recipeKey}.${ISACTIVE}`, isLaunch, true);
        if (scenarioKey) {
            await this.setStateChangedAsync(`${ROOMS}.${roomKey}.${SCENARIOS}.${scenarioKey}.${ISACTIVE}`, isLaunch, true);
        }
        this.scheduleRefresh();
    }

    private async handleMacroTrigger(native: Record<string, any>): Promise<void> {
        const { roomKey, deviceKey, macroKey } = native;
        if (!roomKey || !deviceKey || !macroKey) {
            this.log.warn(`[brain] Macro trigger skipped, incomplete native data`);
            return;
        }
        await this.client!.triggerMacro(roomKey, deviceKey, macroKey);
        this.log.info(`[brain] Triggered macro ${macroKey} on device ${deviceKey} in room ${roomKey}`);
    }

    private async handleScenarioToggle(native: Record<string, any>): Promise<void> {
        const { roomKey, scenarioKey, launchId, poweroffId } = native;
        if (!roomKey || !scenarioKey || !launchId || !poweroffId) return;

        const isActive = (await this.getStateAsync(`${ROOMS}.${roomKey}.${SCENARIOS}.${scenarioKey}.${ISACTIVE}`))?.val === true;
        const target = isActive ? poweroffId : launchId;
        await this.handleRecipeExecute({ roomKey, recipeKey: target, type: isActive ? "poweroff" : "launch", scenarioKey });
    }

    private async handleRoomToggle(roomKey: string): Promise<void> {
        if (!roomKey || !this.model) return;
        const isActive = (await this.getStateAsync(`${ROOMS}.${roomKey}.${ISACTIVE}`))?.val === true;

        if (isActive) {
            // Power off whatever scenario is currently active in this room
            for (const pair of this.collectScenarioPairs(this.model).filter((p) => p.roomId === roomKey)) {
                const scenActive = (await this.getStateAsync(`${ROOMS}.${roomKey}.${SCENARIOS}.${pair.scenarioKey}.${ISACTIVE}`))?.val === true;
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
        const exec = async (): Promise<void> => {
            try {
                await this.handleRecipeExecute({
                    roomKey,
                    recipeKey: cfg.defaultRecipe,
                    type: recipe?.type ?? "launch",
                    scenarioKey: recipe?.scenarioKey
                });
            } catch (err: any) {
                this.log.error(`[brain] Room power-on failed: ${err.message}`);
            }
        };

        const delayMs = Math.max(0, Number(cfg.delay ?? 0)) * 1000;
        if (delayMs > 0) {
            this.log.debug(`[brain] Room ${roomKey} power-on delayed by ${delayMs / 1000}s`);
            this.trackTimeout(exec, delayMs);
        } else {
            await exec();
        }
    }

    private async handleGlobalToggle(): Promise<void> {
        if (!this.model) return;
        const globalActive = (await this.getStateAsync(`${INFO}.${ISACTIVE}`))?.val === true;

        for (const room of this.model.rooms) {
            const roomActive = (await this.getStateAsync(`${ROOMS}.${room.id}.${ISACTIVE}`))?.val === true;

            if (globalActive) {
                // Switch everything off that is running
                if (roomActive) {
                    this.log.debug(`[brain] Global toggle: powering off room ${room.name}`);
                    await this.setState(`${ROOMS}.${room.id}.powerToggle`, true, false);
                }
                continue;
            }

            const cfg = this.roomConfig(room.id);
            if (!cfg?.includeGlobal || !cfg.defaultRecipe || roomActive) continue;

            const delayMs = Math.max(0, Number(cfg.delay ?? 0)) * 1000;
            const fire = (): void => {
                this.log.debug(`[brain] Global toggle: powering on room ${room.name}`);
                void this.setState(`${ROOMS}.${room.id}.powerToggle`, true, false);
            };
            if (delayMs > 0) this.trackTimeout(fire, delayMs);
            else fire();
        }
    }

    private async handleVolume(roomKey: string, up: boolean): Promise<void> {
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
                await this.client!.triggerMacro(roomKey, cfg.volDevice, macroKey);
            } catch (err: any) {
                this.log.warn(`[brain] Volume macro failed: ${err.message}`);
                break;
            }
            if (i < repeat - 1 && delayMs > 0) {
                await new Promise((res) => setTimeout(res, delayMs));
            }
        }
    }

    // ---------------------------------------------------------------- helpers

    private trackTimeout(fn: () => void | Promise<void>, ms: number): void {
        const handle = setTimeout(() => {
            this.delayTimeouts.delete(handle);
            void fn();
        }, ms);
        this.delayTimeouts.add(handle);
    }

    private onUnload(callback: () => void): void {
        try {
            this.log.info("[main] Adapter is shutting down...");
            this.events.close();
            if (this.pollTimer) clearInterval(this.pollTimer);
            if (this.refreshTimer) clearTimeout(this.refreshTimer);
            if (this.resyncTimer) clearTimeout(this.resyncTimer);
            if (this.retryTimer) clearTimeout(this.retryTimer);
            for (const handle of this.delayTimeouts) clearTimeout(handle);
            this.delayTimeouts.clear();
            callback();
        } catch {
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
