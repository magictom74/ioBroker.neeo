"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrainClient = void 0;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("./config");
/**
 * Thin HTTP client for the NEEO Brain REST API.
 * All calls share one axios instance with a hard timeout so a dead brain
 * can never block the adapter.
 */
class BrainClient {
    constructor(brainIp, brainPort) {
        this.baseUrl = `http://${brainIp}:${brainPort}`;
        this.http = axios_1.default.create({ timeout: config_1.HTTP_TIMEOUT_MS });
    }
    /** Execute a recipe (launch or poweroff, depending on the recipe type). */
    async executeRecipe(roomKey, recipeKey) {
        const url = `${this.baseUrl}/${config_1.API_BASE_URL}/${config_1.ROOMS}/${roomKey}/${config_1.RECIPES}/${recipeKey}/${config_1.EXECUTE}`;
        await this.http.get(url);
    }
    /** Trigger a device macro (button press). */
    async triggerMacro(roomKey, deviceKey, macroKey) {
        const url = `${this.baseUrl}/${config_1.API_BASE_URL}/${config_1.ROOMS}/${roomKey}/${config_1.DEVICES}/${deviceKey}/${config_1.MACROS}/${macroKey}/${config_1.TRIGGER}`;
        await this.http.get(url);
    }
    /** Poll the active flag of a recipe. */
    async isRecipeActive(roomKey, recipeKey) {
        const url = `${this.baseUrl}/${config_1.API_BASE_URL}/${config_1.ROOMS}/${roomKey}/${config_1.RECIPES}/${recipeKey}/${config_1.ISACTIVE}`;
        const res = await this.http.get(url);
        return res.data?.active === true;
    }
    /** Quick reachability check against the project root. */
    async isOnline() {
        try {
            await this.http.get(`${this.baseUrl}/${config_1.API_BASE_URL}`);
            return true;
        }
        catch {
            return false;
        }
    }
}
exports.BrainClient = BrainClient;
