"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getApiBaseUrl = getApiBaseUrl;
function getApiBaseUrl(adapter) {
    const ip = adapter.config.serverIp?.trim();
    const port = adapter.config.serverPort?.toString().trim();
    return `http://${ip}:${port}`;
}
