import axios from "axios";

export interface NeeoRoom {
  id: string;
  name: string;
}

export interface NeeoRecipe {
  id: string;
  name: string;
  roomName: string;
}

export interface NeeoDevice {
  id: string;
  name: string;
  roomName: string;
}

export interface NeeoBrainData {
  rooms: NeeoRoom[];
  recipes: NeeoRecipe[];
  devices: NeeoDevice[];
}

export async function fetchNeeoBrainData(brainUrl: string): Promise<NeeoBrainData> {
  const response = await axios.get(`${brainUrl}/v1/projects/home`);
  const { rooms, recipes, devices } = response.data;
  return { rooms, recipes, devices };
}
