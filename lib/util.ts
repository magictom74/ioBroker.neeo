import { AdapterInstance } from "@iobroker/adapter-core";

export function getApiBaseUrl(adapter: AdapterInstance): string {
    const ip = adapter.config.serverIp?.trim();
    const port = adapter.config.serverPort?.toString().trim();

    return `http://${ip}:${port}`;
}
