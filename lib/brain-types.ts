export interface NeeoBrainModel  {
  brainIp: string;
  brainPort: number;
  rooms: BrainRoom[];
  devices: BrainDevice[];
  recipes: BrainRecipe[];
  scenarios: BrainScenario[];
}

export interface BrainRoom {
  id: string;
  name: string;
  devices: BrainDevice[];
  recipes: BrainRecipe[];
  scenarios: BrainScenario[];
}

export interface BrainDevice {
  id: string;
  name: string;
  type: string;
  roomId: string;
  capabilities?: { buttons?: string[]; sliders?: string[]; };
  macros?: BrainMacro[];
  genericMacros?: BrainMacro[];
  details?: { manufacturer?: string; name?: string; type?: string; };
}

export interface BrainRecipe {
  id: string;
  name: string;
  type: string;
  roomId: string;
  deviceName: string;
  deviceClass?: string;
  power?: string;
  isTurnedOn?: boolean;
  scenarioKey?: string;
}

export interface BrainMacro {
  id: string;
  name: string;
  label: string;
}

export interface BrainScenario {
  id: string;
  name: string;
  type?: string;
}
