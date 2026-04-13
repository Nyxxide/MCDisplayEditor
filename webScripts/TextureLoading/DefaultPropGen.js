export function defaultMultipartPropsForBlock(blockId) {
    const id = (blockId || "").toLowerCase();

    if (
        id.includes("mushroom_stem") ||
        id.includes("red_mushroom_block") ||
        id.includes("brown_mushroom_block")
    ) {
        return {
            north: "true",
            south: "true",
            east: "true",
            west: "true",
            up: "true",
            down: "true"
        };
    }

    if (id.includes("chorus_plant")) {
        return {
            north: "false",
            south: "false",
            east: "false",
            west: "false",
            up: "false",
            down: "false"
        };
    }

    if (id.includes("pointed_dripstone")) {
        return {
            waterlogged: "false",
            vertical_direction: "up",
            thickness: "tip"
        }
    }

    if (id.includes("bars")){
        return {
            north: "false",
            south: "false",
            east: "false",
            west: "false",
            waterlogged: "false"
        };
    }

    if (id.includes("pane")){
        return {
            north: "false",
            south: "false",
            east: "false",
            west: "false",
            waterlogged: "false"
        };
    }

    if (id.includes("sea_pickle")) {
        return {
            waterlogged: "true",
            pickles: 1
        }
    }

    if (id.includes("turtle_egg")) {
        return {
            hatch: 0,
            eggs: 1
        }
    }

    if (id.includes("vine")) {
        return {
            north: "false",
            south: "false",
            west: "false",
            east: "false",
            up: "false",
        }
    }

    if (id.includes("glow_lichen")) {
        return {
            north: "false",
            south: "false",
            west: "false",
            east: "false",
            up: "false",
            down: "false",
            waterlogged: "false"
        }
    }

    if (id.includes("creaking_heart")) {
        return {
            creaking_heart_state: "uprooted",
            axis: "y"
        }
    }

    if (id.includes("dispenser") || id.includes("dropper")) {
        return {
            facing: "north"
        }
    }

    if (id.includes("command_block")) {
        return {
            conditional: "false",
            facing: "north"
        }
    }

    if (id.includes("piston")) {
        if (id.includes("head")){
            return {
                short: "false",
                type: "normal",
                facing: "north"
            }
        }
        else{
            return {
                extended: "false",
                facing: "north"
            }
        }
    }

    if (id.includes("tripwire_hook")) {
        return {
            powered: "false",
            attached: "false",
            facing: "north"
        }
    }

    if (id.includes("comparator")) {
        return {
            powered: "false",
            facing: "north",
            mode: "compare"
        }
    }

    if (id.includes("repeater")) {
        return {
            powered: "false",
            facing: "north",
            locked: "false",
            delay: 1
        }
    }

    if (id.includes("bell")) {
        return {
            attachment: "floor",
            facing: "north"
        }
    }

    if (id.includes("grindstone")) {
        return {
            face: "wall",
            facing: "north"
        }
    }

    if (id.includes("amethyst_bud") || id.includes("amethyst_cluster")) {
        return {
            waterlogged: "false",
            facing: "up"
        }
    }

    if (id.includes("lightning_rod")) {
        return {
            powered: "false",
            waterlogged: "false",
            facing: "up"
        }
    }

    if (id.includes("end_rod")) {
        return {
            facing: "up"
        }
    }

    if (id.includes("rail")) {
        if (id.includes("powered") || id.includes("activator") || id.includes("detector")) {
            return {
                waterlogged: "false",
                shape: "north_south",
                powered: "false"
            }
        }
        else {
            return {
                waterlogged: "false",
                shape: "north_south"
            }
        }
    }

    if (id.includes("test_block") || id.includes("test_instance_block")) {
        return {
            mode: "start"
        }
    }

    if (id.includes("observer")) {
        return {
            facing: "south",
            powered: false
        }
    }

    if (id.includes("crafter")) {
        return {
            orientation: "north_up",
            triggered: "false",
            crafting: "false"
        }
    }

    if (id.includes("redstone_torch")) {
        return {
            lit: "true"
        };
    }

    if (id.includes("redstone_wall_torch") || id.includes("campfire") || id.includes("soul_campfire")) {
        return {
            lit: "true",
            facing: "north"
        }
    }

    if (id.includes("wall")) {
        return {
            north: "false",
            south: "false",
            east: "false",
            west: "false",
            up: "false"
        };
    }

    if (id.includes("shelf")) {
        return {
            facing: "north",
        };
    }

    return null;
}