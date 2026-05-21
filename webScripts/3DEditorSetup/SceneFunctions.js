// SceneFunctions.js
// -------------
// Builds the Three.js scene/camera/renderer, grids, outline pass, orbit controls, compass labels, etc.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutlinePass } from "three/addons/postprocessing/OutlinePass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { loadAtlas } from "../TextureLoading/TextureLoad.js";

const GRID_COLOR = 0x8a8a8a;
const gridFine = new THREE.GridHelper(1001, 4004, GRID_COLOR, GRID_COLOR);
const gridCoarse = new THREE.GridHelper(1001, 1001, GRID_COLOR, GRID_COLOR);

gridFine.material.transparent = true;
gridFine.material.opacity = 0.28;

gridCoarse.material.transparent = true;
gridCoarse.material.opacity = 0.45;

export async function initScene(state) {
    const scene = new THREE.Scene();

    const atlas = await loadAtlas("../Data/atlas/blocks_atlas.png", "../Data/atlas/blocks_atlas.json");

    state.atlas = atlas;

    scene.background = new THREE.Color(0x111111);
    scene.fog = new THREE.Fog(0x111111, 80, 350);

    const viewportEl = document.getElementById("viewport3d");
    if (!viewportEl) throw new Error("Missing #viewport3d container");

    const camera = new THREE.PerspectiveCamera(
        60,
        Math.max(1, viewportEl.clientWidth) / Math.max(1, viewportEl.clientHeight),
        0.25,
        600
    );
    camera.position.set(6, 6, 10);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    viewportEl.appendChild(renderer.domElement);

    // separate scene for gizmos
    const gizmoScene = new THREE.Scene();

    const floorOriginRoot = new THREE.Group();
    floorOriginRoot.name = "floorOriginRoot";
    floorOriginRoot.position.set(-0.5, 0, -0.5);
    scene.add(floorOriginRoot);

    // postprocessing outline
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    const outlinePass = new OutlinePass(new THREE.Vector2(innerWidth, innerHeight), scene, camera);
    outlinePass.visibleEdgeColor.set(0xffffff);
    outlinePass.hiddenEdgeColor.set(0xffffff);
    outlinePass.edgeStrength = 3.0;
    outlinePass.edgeThickness = 1.0;
    outlinePass.edgeGlow = 0.0;
    outlinePass.pulsePeriod = 0.0;
    composer.addPass(outlinePass);

    composer.addPass(new OutputPass());

    // grids
    gridFine.position.y = 0.006;
    gridFine.visible = false;
    floorOriginRoot.add(gridFine);

    gridCoarse.position.y = 0.001;
    floorOriginRoot.add(gridCoarse);

    // axes + lighting
    // scene.add(new THREE.AxesHelper(2));
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 0.7);
    dir.position.set(8, 14, 6);
    scene.add(dir);

    // extra brightness tweak
    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    dir.intensity = 1.0;

    // orbit
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.target.set(-0.5, 0, -0.5);
    orbit.update();


    // ground tint plane
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(10000, 10000),
        new THREE.MeshBasicMaterial({
            color: 0x141414,
            transparent: true,
            opacity: 0.45,
            side: THREE.DoubleSide,
        })
    );
    ground.rotation.x = -Math.PI / 2;
    floorOriginRoot.add(ground);

    // selection rig (blocks/groups multiselect)
    const selectionRig = new THREE.Group();
    selectionRig.name = "selectionRig";
    const selectionScaleNode = new THREE.Group();
    selectionScaleNode.name = "selectionRig:scale";
    selectionRig.add(selectionScaleNode);
    selectionRig.userData.scaleNode = selectionScaleNode;
    scene.add(selectionRig);

    // compass labels
    const compassRadius = 6.0;
    const N = makeLabelPlane("N");
    const E = makeLabelPlane("E");
    const S = makeLabelPlane("S");
    const W = makeLabelPlane("W");
    N.name = "compass:N";
    E.name = "compass:E";
    S.name = "compass:S";
    W.name = "compass:W";

    N.position.set(0, 0.08, -compassRadius);
    S.position.set(0, 0.08, compassRadius);
    E.position.set(compassRadius, 0.08, 0);
    W.position.set(-compassRadius, 0.08, 0);
    floorOriginRoot.add(N, E, S, W);

    // store
    state.scene = scene;
    state.camera = camera;
    state.renderer = renderer;
    state.composer = composer;
    state.orbit = orbit;
    state.gizmoScene = gizmoScene;
    state.floorOriginRoot = floorOriginRoot;
    state.post.outlinePass = outlinePass;
    state.selectionRig = selectionRig;
    state.debug.floorCompassLabels = [N, E, S, W];

    state.api.updateInfiniteGrid = () => {
        const target = orbit.target;

        const snapFine = 0.25;
        const snapCoarse = 1.0;

        gridFine.position.x =
            Math.floor(target.x / snapFine) * snapFine;

        gridFine.position.z =
            Math.floor(target.z / snapFine) * snapFine;

        gridCoarse.position.x =
            Math.floor(target.x / snapCoarse) * snapCoarse;

        gridCoarse.position.z =
            Math.floor(target.z / snapCoarse) * snapCoarse;

        ground.position.x = target.x;
        ground.position.y = -0.015;
        ground.position.z = target.z;
    };

    // resize handler
    function resizeRendererToViewport() {
        const width = Math.max(1, viewportEl.clientWidth);
        const height = Math.max(1, viewportEl.clientHeight);

        camera.aspect = width / height;
        camera.updateProjectionMatrix();

        renderer.setSize(width, height, false);
        composer.setSize(width, height);
        outlinePass.setSize(width, height);
    }

    resizeRendererToViewport();

    const viewportResizeObserver = new ResizeObserver(() => {
        resizeRendererToViewport();
    });
    viewportResizeObserver.observe(viewportEl);

    window.addEventListener("resize", resizeRendererToViewport);
}

function makeLabelPlane(text) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = 256;
    canvas.height = 256;

    ctx.clearRect(0, 0, 256, 256);
    ctx.fillStyle = "rgba(0,0,0,0)";
    ctx.fillRect(32, 64, 192, 128);

    ctx.font = "bold 140px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "white";
    ctx.fillText(text, 128, 140);

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;

    const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        depthTest: true,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = 0.08;
    plane.renderOrder = 50;
    return plane;
}

export { gridFine, gridCoarse }