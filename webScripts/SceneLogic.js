// SceneLogic.js
// -------------
// Builds the Three.js scene/camera/renderer, grids, outline pass, orbit controls, compass labels, etc.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutlinePass } from "three/addons/postprocessing/OutlinePass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import {loadAtlas} from "./TextureLoad.js";

const GRID_COLOR = 0x8a8a8a;
const gridFine = new THREE.GridHelper(40, 160, GRID_COLOR, GRID_COLOR);
const gridCoarse = new THREE.GridHelper(40, 40, GRID_COLOR, GRID_COLOR);

export async function initScene(state) {
    const scene = new THREE.Scene();

    const atlas = await loadAtlas("../Data/atlas/blocks_atlas.png", "../Data/atlas/blocks_atlas.json");

    state.atlas = atlas;

    scene.background = new THREE.Color(0x111111);

    const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 200);
    camera.position.set(6, 6, 10);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    // color/tone
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;

    document.body.appendChild(renderer.domElement);

    // separate scene for gizmos
    const gizmoScene = new THREE.Scene();

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
    gridFine.position.y = 0.002;
    gridFine.visible = false;
    scene.add(gridFine);

    gridCoarse.position.y = 0.001;
    scene.add(gridCoarse);

    // axes + lighting
    scene.add(new THREE.AxesHelper(2));
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

    // origin marker
    const originMarker = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
            color: 0xff8c1a,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.85,
        })
    );
    originMarker.rotation.x = -Math.PI / 2;
    originMarker.position.set(-0.5, 0.001, -0.5);
    scene.add(originMarker);

    // ground tint plane
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(40, 40),
        new THREE.MeshBasicMaterial({
            color: 0x141414,
            transparent: true,
            opacity: 0.45,
            side: THREE.DoubleSide,
        })
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

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
    N.position.set(0, 0.002, -compassRadius);
    S.position.set(0, 0.002, compassRadius);
    E.position.set(compassRadius, 0.002, 0);
    W.position.set(-compassRadius, 0.002, 0);
    scene.add(N, E, S, W);

    // store
    state.scene = scene;
    state.camera = camera;
    state.renderer = renderer;
    state.composer = composer;
    state.orbit = orbit;
    state.gizmoScene = gizmoScene;
    state.post.outlinePass = outlinePass;
    state.selectionRig = selectionRig;

    // resize handler
    window.addEventListener("resize", () => {
        camera.aspect = innerWidth / innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(innerWidth, innerHeight);
        composer.setSize(innerWidth, innerHeight);
        outlinePass.setSize(innerWidth, innerHeight);
    });
}

function makeLabelPlane(text) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = 256;
    canvas.height = 256;

    ctx.clearRect(0, 0, 256, 256);
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(32, 64, 192, 128);

    ctx.font = "bold 140px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "white";
    ctx.fillText(text, 128, 140);

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;

    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = 0.002;
    return plane;
}

export { gridFine, gridCoarse }