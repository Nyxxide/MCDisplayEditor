export const BLOCK_PROPERTY_OPTIONS = [
    {
        match: (id) => id.includes("hanging_sign") && !id.includes("wall_hanging_sign"),
        properties: {
            attached: { label: "Attached", values: ["false", "true"], default: "false" },
        },
    },

    {
        match: (id) => id.includes("wall_sign"),
        properties: {
            facing: { label: "Facing", values: ["north", "south", "east", "west"], default: "north" },
        },
    },

    {
        match: (id) => id.includes("wall_banner"),
        properties: {
            facing: { label: "Facing", values: ["north", "south", "east", "west"], default: "north" },
        },
    },

    {
        match: (id) =>
            id.includes("mushroom_stem") ||
            id.includes("red_mushroom_block") ||
            id.includes("brown_mushroom_block"),
        properties: {
            north: { label: "North", values: ["true", "false"], default: "true" },
            south: { label: "South", values: ["true", "false"], default: "true" },
            east:  { label: "East",  values: ["true", "false"], default: "true" },
            west:  { label: "West",  values: ["true", "false"], default: "true" },
            up:    { label: "Up",    values: ["true", "false"], default: "true" },
            down:  { label: "Down",  values: ["true", "false"], default: "true" },
        },
    },

    {
        match: (id) => id.includes("chorus_plant"),
        properties: {
            north: { label: "North", values: ["false", "true"], default: "false" },
            south: { label: "South", values: ["false", "true"], default: "false" },
            east:  { label: "East",  values: ["false", "true"], default: "false" },
            west:  { label: "West",  values: ["false", "true"], default: "false" },
            up:    { label: "Up",    values: ["false", "true"], default: "false" },
            down:  { label: "Down",  values: ["false", "true"], default: "false" },
        },
    },

    {
        match: (id) => id.includes("pointed_dripstone"),
        properties: {
            waterlogged: { label: "Waterlogged", values: ["false", "true"], default: "false" },
            vertical_direction: { label: "Vertical Direction", values: ["up", "down"], default: "up" },
            thickness: { label: "Thickness", values: ["tip", "tip_merge", "frustum", "middle", "base"], default: "tip" },
        },
    },

    {
        match: (id) => id.includes("bars"),
        properties: {
            north: { label: "North", values: ["false", "true"], default: "false" },
            south: { label: "South", values: ["false", "true"], default: "false" },
            east:  { label: "East",  values: ["false", "true"], default: "false" },
            west:  { label: "West",  values: ["false", "true"], default: "false" },
            waterlogged: { label: "Waterlogged", values: ["false", "true"], default: "false" },
        },
    },

    {
        match: (id) => id.includes("pane"),
        properties: {
            north: { label: "North", values: ["false", "true"], default: "false" },
            south: { label: "South", values: ["false", "true"], default: "false" },
            east:  { label: "East",  values: ["false", "true"], default: "false" },
            west:  { label: "West",  values: ["false", "true"], default: "false" },
            waterlogged: { label: "Waterlogged", values: ["false", "true"], default: "false" },
        },
    },

    {
        match: (id) => id.includes("sea_pickle"),
        properties: {
            waterlogged: { label: "Waterlogged", values: ["true", "false"], default: "true" },
            pickles: { label: "Pickles", values: ["1", "2", "3", "4"], default: "1" },
        },
    },

    {
        match: (id) => id.includes("turtle_egg"),
        properties: {
            hatch: { label: "Hatch", values: ["0", "1", "2"], default: "0" },
            eggs: { label: "Eggs", values: ["1", "2", "3", "4"], default: "1" },
        },
    },

    {
        match: (id) => id.includes("glow_lichen") || id.includes("sculk_vein"),
        properties: {
            north: { label: "North", values: ["false", "true"], default: "false" },
            south: { label: "South", values: ["false", "true"], default: "false" },
            east:  { label: "East",  values: ["false", "true"], default: "false" },
            west:  { label: "West",  values: ["false", "true"], default: "false" },
            up:    { label: "Up",    values: ["false", "true"], default: "false" },
            down:  { label: "Down",  values: ["false", "true"], default: "false" },
            waterlogged: { label: "Waterlogged", values: ["false", "true"], default: "false" },
        },
    },

    {
        match: (id) => id.includes("vine") && !id.includes("glow_lichen"),
        properties: {
            north: { label: "North", values: ["false", "true"], default: "false" },
            south: { label: "South", values: ["false", "true"], default: "false" },
            east:  { label: "East",  values: ["false", "true"], default: "false" },
            west:  { label: "West",  values: ["false", "true"], default: "false" },
            up:    { label: "Up",    values: ["false", "true"], default: "false" },
        },
    },

    {
        match: (id) => id.includes("creaking_heart"),
        properties: {
            creaking_heart_state: { label: "Heart State", values: ["uprooted", "dormant", "awake"], default: "uprooted" },
            axis: { label: "Axis", values: ["x", "y", "z"], default: "y" },
        },
    },

    {
        match: (id) => id.includes("dispenser") || id.includes("dropper"),
        properties: {
            facing: { label: "Facing", values: ["north", "south", "east", "west", "up", "down"], default: "north" },
        },
    },

    {
        match: (id) => id.includes("command_block"),
        properties: {
            conditional: { label: "Conditional", values: ["false", "true"], default: "false" },
            facing: { label: "Facing", values: ["north", "south", "east", "west", "up", "down"], default: "north" },
        },
    },

    {
        match: (id) => id.includes("piston_head"),
        properties: {
            short: { label: "Short", values: ["false", "true"], default: "false" },
            type: { label: "Type", values: ["normal", "sticky"], default: "normal" },
            facing: { label: "Facing", values: ["north", "south", "east", "west", "up", "down"], default: "north" },
        },
    },

    {
        match: (id) => id.includes("piston") && !id.includes("piston_head"),
        properties: {
            extended: { label: "Extended", values: ["false", "true"], default: "false" },
            facing: { label: "Facing", values: ["north", "south", "east", "west", "up", "down"], default: "north" },
        },
    },

    {
        match: (id) => id.includes("tripwire_hook"),
        properties: {
            powered: { label: "Powered", values: ["false", "true"], default: "false" },
            attached: { label: "Attached", values: ["false", "true"], default: "false" },
            facing: { label: "Facing", values: ["north", "south", "east", "west"], default: "north" },
        },
    },

    {
        match: (id) => id.includes("comparator"),
        properties: {
            powered: { label: "Powered", values: ["false", "true"], default: "false" },
            facing: { label: "Facing", values: ["north", "south", "east", "west"], default: "north" },
            mode: { label: "Mode", values: ["compare", "subtract"], default: "compare" },
        },
    },

    {
        match: (id) => id.includes("repeater"),
        properties: {
            powered: { label: "Powered", values: ["false", "true"], default: "false" },
            facing: { label: "Facing", values: ["north", "south", "east", "west"], default: "north" },
            locked: { label: "Locked", values: ["false", "true"], default: "false" },
            delay: { label: "Delay", values: ["1", "2", "3", "4"], default: "1" },
        },
    },

    {
        match: (id) => id.includes("bell"),
        properties: {
            attachment: { label: "Attachment", values: ["floor", "ceiling", "single_wall", "double_wall"], default: "floor" },
            facing: { label: "Facing", values: ["north", "south", "east", "west"], default: "north" },
        },
    },

    {
        match: (id) => id.includes("grindstone"),
        properties: {
            face: { label: "Face", values: ["wall", "floor", "ceiling"], default: "wall" },
            facing: { label: "Facing", values: ["north", "south", "east", "west"], default: "north" },
        },
    },

    {
        match: (id) => id.includes("amethyst_bud") || id.includes("amethyst_cluster"),
        properties: {
            waterlogged: { label: "Waterlogged", values: ["false", "true"], default: "false" },
            facing: { label: "Facing", values: ["up", "down", "north", "south", "east", "west"], default: "up" },
        },
    },

    {
        match: (id) => id.includes("lightning_rod"),
        properties: {
            powered: { label: "Powered", values: ["false", "true"], default: "false" },
            waterlogged: { label: "Waterlogged", values: ["false", "true"], default: "false" },
            facing: { label: "Facing", values: ["up", "down", "north", "south", "east", "west"], default: "up" },
        },
    },

    {
        match: (id) => id.includes("end_rod"),
        properties: {
            facing: { label: "Facing", values: ["up", "down", "north", "south", "east", "west"], default: "up" },
        },
    },

    {
        match: (id) =>
            id.includes("powered_rail") ||
            id.includes("activator_rail") ||
            id.includes("detector_rail"),
        properties: {
            waterlogged: { label: "Waterlogged", values: ["false", "true"], default: "false" },
            shape: {
                label: "Shape",
                values: ["north_south", "east_west", "ascending_east", "ascending_west", "ascending_north", "ascending_south"],
                default: "north_south",
            },
            powered: { label: "Powered", values: ["false", "true"], default: "false" },
        },
    },

    {
        match: (id) =>
            id.includes("rail") &&
            !id.includes("powered_rail") &&
            !id.includes("activator_rail") &&
            !id.includes("detector_rail"),
        properties: {
            waterlogged: { label: "Waterlogged", values: ["false", "true"], default: "false" },
            shape: {
                label: "Shape",
                values: [
                    "north_south",
                    "east_west",
                    "ascending_east",
                    "ascending_west",
                    "ascending_north",
                    "ascending_south",
                    "south_east",
                    "south_west",
                    "north_west",
                    "north_east",
                ],
                default: "north_south",
            },
        },
    },

    {
        match: (id) => id.includes("test_block") && !id.includes("test_instance_block"),
        properties: {
            mode: { label: "Mode", values: ["start", "log", "fail", "accept"], default: "start" },
        },
    },

    {
        match: (id) => id.includes("observer"),
        properties: {
            facing: { label: "Facing", values: ["north", "south", "east", "west", "up", "down"], default: "south" },
            powered: { label: "Powered", values: ["false", "true"], default: "false" },
        },
    },

    {
        match: (id) => id.includes("crafter"),
        properties: {
            orientation: { label: "Orientation", values: ["north_up", "south_up", "east_up", "west_up"], default: "north_up" },
            triggered: { label: "Triggered", values: ["false", "true"], default: "false" },
            crafting: { label: "Crafting", values: ["false", "true"], default: "false" },
        },
    },

    {
        match: (id) => id.includes("redstone_wall_torch"),
        properties: {
            lit: { label: "Lit", values: ["true", "false"], default: "true" },
            facing: { label: "Facing", values: ["north", "south", "east", "west"], default: "north" },
        },
    },

    {
        match: (id) => id.includes("redstone_torch") && !id.includes("redstone_wall_torch"),
        properties: {
            lit: { label: "Lit", values: ["true", "false"], default: "true" },
        },
    },

    {
        match: (id) =>
            id.includes("fire") &&
            !id.includes("soul_fire") &&
            !id.includes("campfire") &&
            !id.includes("soul_campfire"),
        properties: {
            age: {
                label: "Age",
                values: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"],
                default: "0",
            },
            north: { label: "North", values: ["true", "false"], default: "false" },
            south: { label: "South", values: ["true", "false"], default: "false" },
            east:  { label: "East",  values: ["true", "false"], default: "false" },
            west:  { label: "West",  values: ["true", "false"], default: "false" },
            up:    { label: "Up",    values: ["true", "false"], default: "false" },
        },
    },

    {
        match: (id) => id.includes("campfire") || id.includes("soul_campfire"),
        properties: {
            lit: { label: "Lit", values: ["true", "false"], default: "true" },
            facing: { label: "Facing", values: ["north", "south", "east", "west"], default: "north" },
        },
    },

    {
        match: (id) => id.includes("wall"),
        properties: {
            north: { label: "North", values: ["false", "low", "tall"], default: "false" },
            south: { label: "South", values: ["false", "low", "tall"], default: "false" },
            east:  { label: "East",  values: ["false", "low", "tall"], default: "false" },
            west:  { label: "West",  values: ["false", "low", "tall"], default: "false" },
            up:    { label: "Up",    values: ["false", "true"], default: "false" },
        },
    },

    {
        match: (id) => id.includes("shelf"),
        properties: {
            facing: { label: "Facing", values: ["north", "south", "east", "west"], default: "north" },
        },
    },

    {
        match: (id) =>
            id.includes("wheat") ||
            id.includes("carrots") ||
            id.includes("potatoes"),
        properties: {
            age: {
                label: "Age",
                values: ["0", "1", "2", "3", "4", "5", "6", "7"],
                default: "0",
            },
        },
    },

    {
        match: (id) => id.includes("beetroots"),
        properties: {
            age: {
                label: "Age",
                values: ["0", "1", "2", "3"],
                default: "0",
            },
        },
    },

    {
        match: (id) => id.includes("nether_wart"),
        properties: {
            age: {
                label: "Age",
                values: ["0", "1", "2", "3"],
                default: "0",
            },
        },
    },

    {
        match: (id) =>
            (id.includes("melon_stem") ||
            id.includes("pumpkin_stem")) &&
            !(id.includes("attached_melon_stem") ||
            id.includes("attached_pumpkin_stem")),
        properties: {
            age: {
                label: "Age",
                values: ["0", "1", "2", "3", "4", "5", "6", "7"],
                default: "0",
            },
        },
    },

    {
        match: (id) => id.includes("cocoa"),
        properties: {
            age: {
                label: "Age",
                values: ["0", "1", "2"],
                default: "0",
            },
            facing: {
                label: "Facing",
                values: ["north", "south", "east", "west"],
                default: "north",
            },
        },
    },

    {
        match: (id) => id.includes("sweet_berry_bush"),
        properties: {
            age: {
                label: "Age",
                values: ["0", "1", "2", "3"],
                default: "0",
            },
        },
    },

    {
        match: (id) => id.includes("torchflower_crop"),
        properties: {
            age: {
                label: "Age",
                values: ["0", "1"],
                default: "0",
            },
        },
    },

    {
        match: (id) => id.includes("pitcher_crop"),
        properties: {
            age: {
                label: "Age",
                values: ["0", "1", "2", "3", "4"],
                default: "0",
                valuesWhen: (props) =>
                    props?.half === "upper"
                        ? ["3", "4"]
                        : ["0", "1", "2", "3", "4"],
            },
            half: {
                label: "Half",
                values: ["lower", "upper"],
                default: "lower",
            },
        },
    },

    {
        match: (id) => id.includes("pitcher_plant"),
        properties: {
            half: {
                label: "Half",
                values: ["lower", "upper"],
                default: "lower",
            },
        },
    },

    {
        match: (id) =>
            id.includes("pink_petals") ||
            id.includes("wildflowers"),
        properties: {
            flower_amount: {
                label: "Amount",
                values: ["1", "2", "3", "4"],
                default: "1",
            },
            facing: {
                label: "Facing",
                values: ["north", "south", "east", "west"],
                default: "north",
            },
        },
    },

    {
        match: (id) => id.includes("leaf_litter"),
        properties: {
            segment_amount: {
                label: "Amount",
                values: ["1", "2", "3", "4"],
                default: "1",
            },
            facing: {
                label: "Facing",
                values: ["north", "south", "east", "west"],
                default: "north",
            },
        },
    },

    {
        match: (id) => id.includes("_door"),
        properties: {
            half: {
                label: "Half",
                values: ["lower", "upper"],
                default: "lower"
            },
            hinge: {
                label: "Hinge",
                values: ["left", "right"],
                default: "left"
            },
            powered: {
                label: "Powered",
                values: ["true", "false"],
                default: "false"
            },
            facing: {
                label: "Facing",
                values: ["north", "south", "east", "west"],
                default: "north"
            },
            open: {
                label: "Open",
                values: ["true", "false"],
                default: "false"
            },
        },
    },

    {
        match: (id) => id.includes("_gate") && !id.includes("_gateway"),
        properties: {
            in_wall:{
                label: "In Wall",
                values: ["true", "false"],
                default: "false"
            },
            powered: {
                label: "Powered",
                values: ["true", "false"],
                default: "false"
            },
            facing: {
                label: "Facing",
                values: ["north", "south", "east", "west"],
                default: "north"
            },
            open: {
                label: "Open",
                values: ["true", "false"],
                default: "false"
            },
        },
    },

    {
        match: (id) => id.includes("_bed"),
        properties: {
            part: {
                label: "Part",
                values: ["head", "foot"],
                default: "foot",
            },
        },
    },

    {
        match: (id) => id.includes("redstone_wire"),
        properties: {
            power: {
                label: "Power",
                values: [
                    "0", "1", "2", "3", "4",
                    "5", "6", "7", "8", "9",
                    "10", "11", "12", "13", "14", "15"
                ],
                default: "0",
            },

            north: {
                label: "North",
                values: ["none", "side", "up"],
                default: "none",
            },

            south: {
                label: "South",
                values: ["none", "side", "up"],
                default: "none",
            },

            east: {
                label: "East",
                values: ["none", "side", "up"],
                default: "none",
            },

            west: {
                label: "West",
                values: ["none", "side", "up"],
                default: "none",
            },
        },
    },

    {
        match: (id) => id.includes("_fence") && !id.includes("_gate"),
        properties: {
            north: {
                label: "North",
                values: ["true", "false"],
                default: "false",
            },
            south: {
                label: "South",
                values: ["true", "false"],
                default: "false",
            },
            east: {
                label: "East",
                values: ["true", "false"],
                default: "false",
            },
            west: {
                label: "West",
                values: ["true", "false"],
                default: "false",
            },
            waterlogged: {
                label: "Waterlogged",
                values: ["true", "false"],
                default: "false",
            },
        },
    },

    {
        match: (id) => id.includes("respawn_anchor"),
        properties: {
            charges: {
                label: "Charges",
                values: ["0", "1", "2", "3", "4"],
                default: "0",
            },
        },
    },

    {
        match: (id) => id.includes("farmland"),
        properties: {
            moisture: {
                label: "Moisture",
                values: ["0", "1", "2", "3", "4", "5", "6", "7"],
                default: "0",
            },
        },
    },

    {
        match: (id) => id.includes("_stairs"),
        properties: {
            waterlogged: {
                label: "Waterlogged",
                values: ["true", "false"],
                default: "false",
            },
            half: {
                label: "Half",
                values: ["top", "bottom"],
                default: "bottom",
            },
            shape: {
                label: "Shape",
                values: ["straight", "inner_left", "inner_right", "outer_left", "outer_right"],
                default: "straight",
            },
            facing: {
                label: "Facing",
                values: ["north", "south", "east", "west"],
                default: "north",
            },
        },
    },

    {
        match: (id) => id.includes("furnace") || id.includes("smoker"),
        properties: {
            lit: {
                label: "Lit",
                values: ["true", "false"],
                default: "false",
            },
            facing: {
                label: "Facing",
                values: ["north", "south", "east", "west"],
                default: "north",
            },
        },
    },

    {
        match: (id) => id.includes("bone_block") || id.includes("_log") || id.includes("_froglight"),
        properties: {
            axis: {
                label: "Axis",
                values: ["x", "y", "z"],
                default: "y",
            },
        },
    },

    {
        match: (id) => id.includes("_trapdoor"),
        properties: {
            waterlogged: {
                label: "Waterlogged",
                values: ["true", "false"],
                default: "false",
            },
            half: {
                label: "Half",
                values: ["bottom", "top"],
                default: "bottom",
            },
            powered: {
                label: "Powered",
                values: ["true", "false"],
                default: "false",
            },
            facing: {
                label: "Facing",
                values: ["north", "south", "east", "west"],
                default: "north",
            },
            open: {
                label: "Open",
                values: ["true", "false"],
                default: "false",
            },
        },
    },

    {
        match: (id) => id.includes("_candle") && !id.includes("_cake"),
        properties: {
            waterlogged: {
                label: "Waterlogged",
                values: ["true", "false"],
                default: "false",
            },
            lit: {
                label: "Lit",
                values: ["true", "false"],
                default: "false",
            },
            candles: {
                label: "Candles",
                values: ["1", "2", "3", "4"],
                default: "1",
            },
        },
    },

    {
        match: (id) => id.includes("candle_cake"),
        properties: {
            lit: {
                label: "Lit",
                values: ["true", "false"],
                default: "false"
            },
        },
    },

    {
        match: (id) => id.includes("_button"),
        properties: {
            face: {
                label: "Face",
                values: ["wall", "floor", "ceiling"],
                default: "wall"
            },
            facing: {
                label: "Facing",
                values: ["north", "south", "east", "west"],
                default: "north"
            },
            powered: {
                label: "Powered",
                values: ["true", "false"],
                default: "false"
            },
        },
    },

    {
        match: (id) => id.includes("grass_block"),
        properties: {
            snowy: {
                label: "Snowy",
                values: ["true", "false"],
                default: "false"
            },
        },
    },

    {
        match: (id) => id.includes("tripwire"),
        properties: {
            disarmed: {
                label: "Disarmed",
                values: ["true", "false"],
                default: "false"
            },
            powered: {
                label: "Powered",
                values: ["true", "false"],
                default: "false"
            },
            north: {
                label: "North",
                values: ["true", "false"],
                default: "false"
            },
            east: {
                label: "East",
                values: ["true", "false"],
                default: "false"
            },
            west: {
                label: "West",
                values: ["true", "false"],
                default: "false"
            },
            south: {
                label: "South",
                values: ["true", "false"],
                default: "false"
            },
            attached: {
                label: "Attached",
                values: ["true", "false"],
                default: "false"
            },
        },
    },

    {
        match: (id) => (id.includes("snow") && !(id.includes("powder") || id.includes("block"))),
        properties: {
            layers: {
                label: "layers",
                values: ["1", "2", "3", "4", "5", "6", "7", "8"],
                default: "1"
            },
        },
    },

];


export function getBlockPropertyConfig(blockId) {
    const id = String(blockId || "").toLowerCase();
    return BLOCK_PROPERTY_OPTIONS.find((entry) => entry.match(id)) || null;
}

export function getDefaultPropertiesForBlock(blockId) {
    const cfg = getBlockPropertyConfig(blockId);
    if (!cfg) return null;

    const out = {};
    for (const [key, def] of Object.entries(cfg.properties || {})) {
        out[key] = String(def.default ?? def.values?.[0] ?? "");
    }

    return Object.keys(out).length ? out : null;
}

export function getEditablePropertyEntries(blockId) {
    const cfg = getBlockPropertyConfig(blockId);
    if (!cfg) return null;

    const entries = Object.entries(cfg.properties || {})
        .filter(([, def]) => def.expose !== false);

    return entries.length ? Object.fromEntries(entries) : null;
}

export function getEffectivePropertiesForBlock(blockId, props = null) {
    const defaults = getDefaultPropertiesForBlock(blockId);
    if (!defaults && !props) return null;

    return {
        ...(defaults || {}),
        ...(props || {}),
    };
}

export function getNonDefaultPropertiesForBlock(blockId, props) {
    if (!props || typeof props !== "object") return null;

    const defaults = getDefaultPropertiesForBlock(blockId);
    if (!defaults) return Object.keys(props).length ? props : null;

    const out = {};

    for (const [key, value] of Object.entries(props)) {
        const cur = String(value);
        const def = defaults[key];

        if (def === undefined || cur !== String(def)) {
            out[key] = cur;
        }
    }

    return Object.keys(out).length ? out : null;
}