"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchNeeoBrainData = fetchNeeoBrainData;
const axios_1 = __importDefault(require("axios"));
async function fetchNeeoBrainData(brainUrl) {
    const response = await axios_1.default.get(`${brainUrl}/v1/projects/home`);
    const { rooms, recipes, devices } = response.data;
    return { rooms, recipes, devices };
}
