import axios, { AxiosInstance } from 'axios';
import { API_BASE_URL, ROOMS, RECIPES, MACROS, DEVICES, EXECUTE, ISACTIVE, TRIGGER, HTTP_TIMEOUT_MS } from './config';

/**
 * Thin HTTP client for the NEEO Brain REST API.
 * All calls share one axios instance with a hard timeout so a dead brain
 * can never block the adapter.
 */
export class BrainClient {
    private http: AxiosInstance;
    private baseUrl: string;

    constructor(brainIp: string, brainPort: number) {
        this.baseUrl = `http://${brainIp}:${brainPort}`;
        this.http = axios.create({ timeout: HTTP_TIMEOUT_MS });
    }

    /** Execute a recipe (launch or poweroff, depending on the recipe type). */
    async executeRecipe(roomKey: string, recipeKey: string): Promise<void> {
        const url = `${this.baseUrl}/${API_BASE_URL}/${ROOMS}/${roomKey}/${RECIPES}/${recipeKey}/${EXECUTE}`;
        await this.http.get(url);
    }

    /** Trigger a device macro (button press). */
    async triggerMacro(roomKey: string, deviceKey: string, macroKey: string): Promise<void> {
        const url = `${this.baseUrl}/${API_BASE_URL}/${ROOMS}/${roomKey}/${DEVICES}/${deviceKey}/${MACROS}/${macroKey}/${TRIGGER}`;
        await this.http.get(url);
    }

    /** Poll the active flag of a recipe. */
    async isRecipeActive(roomKey: string, recipeKey: string): Promise<boolean> {
        const url = `${this.baseUrl}/${API_BASE_URL}/${ROOMS}/${roomKey}/${RECIPES}/${recipeKey}/${ISACTIVE}`;
        const res = await this.http.get(url);
        return res.data?.active === true;
    }

    /** Quick reachability check against the project root. */
    async isOnline(): Promise<boolean> {
        try {
            await this.http.get(`${this.baseUrl}/${API_BASE_URL}`);
            return true;
        } catch {
            return false;
        }
    }
}
