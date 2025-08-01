export interface BrainProjectHome {
    rooms: BrainRoom[];
    devices: BrainDevice[];
    recipes: BrainRecipe[];
}

export interface BrainRoom {
    id: string;
    name: string;
    recipes: BrainRecipe[];
    devices: BrainDevice[];
}

export interface BrainRecipe {
    id: string;
    name: string;
    type: string;
    power: string;
    deviceClass: string;
    roomName: string;
    deviceName: string;
    isTurnedOn: boolean;
}

export interface BrainDevice {
    id: string;
    name: string;
    type: string;
    roomName: string;
    capabilities?: {
        buttons?: string[];
        sliders?: string[];
    };
}
