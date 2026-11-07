import { createFirebaseMultiplayer } from "./firebase-multiplayer.js";

// ============================================================================
// RỪNG NHỎ — KHU TRẠI CHỮA LÀNH (3D ANIME EXPLORATION & SIGHTSEEING)
// Phong cách: Cel-Shading, Anime Genshin 1/10, Thư Giãn, Chụp Ảnh & Ngắm Cảnh
// ============================================================================

const PROFILE_KEY = "rung-nho-profile-v1";
const CHAT_KEY = "rung-nho-chat-v1";
const DISCOVERY_KEY = "rung-nho-discoveries-v1";
const CHARACTER_FOOT_OFFSET = 0.69;
const PLAYER_COLLISION_RADIUS = 0.48;
const PLAYER_MODEL_FACING_OFFSET = Math.PI;
const defaultCharacter = { name: "Lá Nhỏ", color: "#e78b62", style: "hiker", gender: "female" };

function readStorage(key, fallback) {
    try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : fallback;
    } catch (error) {
        console.warn(`Không thể đọc dữ liệu ${key}:`, error);
        return fallback;
    }
}

function saveStorage(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.warn(`Không thể lưu dữ liệu ${key}:`, error);
    }
}

let character = { ...defaultCharacter, ...readStorage(PROFILE_KEY, {}) };
let localPlayerColor = new THREE.Color(character.color).getHex();
let localPlayerMesh;
let localPos = { x: 5, z: 5 };
let isSitting = false;
let isPhotoMode = false;
let currentTimeMode = "day"; // "day" | "sunset" | "night"
let isRaining = false;
let gameStarted = false;

const tarotMessages = [
    "Đôi khi nghỉ ngơi một chút chính là bước tiến xa nhất bạn có thể làm hôm nay.",
    "Bạn không cần phải hoàn hảo để được yêu thương. Chỉ cần là chính mình.",
    "Hãy để những muộn phiền cuốn trôi theo dòng nước. Ngày mai mặt trời sẽ lại mọc.",
    "Ngay cả những vì sao cũng cần bóng tối để tỏa sáng. Đừng sợ những khoảng lặng.",
    "Mỗi cơn mưa đều mang theo mầm sống mới. Hãy kiên nhẫn chờ đợi.",
    "Bạn đang làm rất tốt, dù đôi khi bạn không nhận ra điều đó.",
    "Hít một hơi thật sâu. Thở ra những lo âu. Bạn đang an toàn ở đây.",
    "Những điều tốt đẹp thường đến vào lúc bạn ít mong đợi nhất."
];

// ============================================================================
// THREE.JS SCENE SETUP
// ============================================================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.FogExp2(0xa6d9e8, 0.0032);

const camera = new THREE.PerspectiveCamera(56, window.innerWidth / window.innerHeight, 0.1, 600);
camera.position.set(0, 10, 16);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.85));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
document.getElementById("canvas-container").appendChild(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxPolarAngle = Math.PI / 2 - 0.04;
controls.minDistance = 4;
controls.maxDistance = 40;
controls.target.set(0, 1, 0);

// ============================================================================
// ANIME SHADERS & CEL-SHADING RAMP
// ============================================================================
// Gradient ramp 4-tone cho phong cách anime toon shading
const animeLightRamp = new THREE.DataTexture(
    new Uint8Array([
        68, 70, 92, 255,     // Bóng tối anime
        138, 142, 170, 255,  // Vùng chuyển tiếp
        210, 212, 226, 255,  // Tone trung tính
        255, 255, 255, 255   // Ánh sáng rực rỡ
    ]),
    4,
    1,
    THREE.RGBAFormat
);
animeLightRamp.magFilter = THREE.NearestFilter;
animeLightRamp.minFilter = THREE.NearestFilter;
animeLightRamp.generateMipmaps = false;
animeLightRamp.needsUpdate = true;

// Tạo vật liệu phong cách anime với viền sáng Fresnel Rim Light
function makeAnimeMaterial(color, options = {}) {
    const flat = options.flatShading !== undefined ? options.flatShading : false;
    const material = new THREE.MeshToonMaterial({
        color: color,
        gradientMap: animeLightRamp,
        flatShading: flat,
        transparent: options.transparent || false,
        opacity: options.opacity !== undefined ? options.opacity : 1.0,
        side: options.side || THREE.FrontSide
    });

    if (options.rimLight !== false) {
        material.onBeforeCompile = (shader) => {
            shader.vertexShader = shader.vertexShader.replace(
                '#include <common>',
                `#include <common>
                varying vec3 vAnimeWorldNormal;
                varying vec3 vAnimeViewDir;`
            );
            shader.vertexShader = shader.vertexShader.replace(
                '#include <worldpos_vertex>',
                `#include <worldpos_vertex>
                vAnimeWorldNormal = normalize(mat3(modelMatrix) * normal);
                vAnimeViewDir = normalize(cameraPosition - (modelMatrix * vec4(position, 1.0)).xyz);`
            );
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <common>',
                `#include <common>
                varying vec3 vAnimeWorldNormal;
                varying vec3 vAnimeViewDir;`
            );
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <dithering_fragment>',
                `#include <dithering_fragment>
                float rim = 1.0 - max(dot(normalize(vAnimeViewDir), normalize(vAnimeWorldNormal)), 0.0);
                rim = smoothstep(0.62, 0.96, rim);
                gl_FragColor.rgb += rim * vec3(1.0, 0.94, 0.82) * 0.35;`
            );
        };
    }
    return material;
}

// ============================================================================
// LIGHTING & ATMOSPHERE (DAY / SUNSET / NIGHT)
// ============================================================================
const hemiLight = new THREE.HemisphereLight(0xdff6ff, 0x537a4d, 0.55);
scene.add(hemiLight);

const sun = new THREE.DirectionalLight(0xfff1d2, 0.75);
sun.position.set(-30, 48, 22);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.00015;
sun.shadow.camera.left = -120;
sun.shadow.camera.right = 120;
sun.shadow.camera.top = 120;
sun.shadow.camera.bottom = -120;
sun.shadow.camera.far = 280;
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun);

const moonLight = new THREE.DirectionalLight(0x7da4d9, 0.0);
moonLight.position.set(30, 45, -20);
scene.add(moonLight);

// ============================================================================
// DYNAMIC SKY DOME & TIME MODES
// ============================================================================
let skyMesh, sunDisc, sunHalo, moonDisc, starField;
const animatedClouds = [];

function createSky() {
    const geometry = new THREE.SphereGeometry(440, 48, 28);
    const positions = geometry.attributes.position;
    const colors = [];
    const top = new THREE.Color(0x3298df);
    const middle = new THREE.Color(0x79c4ed);
    const horizon = new THREE.Color(0xd8f3f5);

    for (let i = 0; i < positions.count; i++) {
        const height = positions.getY(i) / 440;
        const color = height > 0
            ? horizon.clone()
                .lerp(middle, THREE.MathUtils.smoothstep(height, 0, 0.44))
                .lerp(top, THREE.MathUtils.smoothstep(height, 0.35, 0.88))
            : horizon.clone().lerp(new THREE.Color(0xb9e8ef), THREE.MathUtils.smoothstep(-height, 0, 0.5));
        colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    
    skyMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false
    }));
    skyMesh.frustumCulled = false;
    scene.add(skyMesh);

    // Mặt trời
    sunDisc = new THREE.Mesh(
        new THREE.SphereGeometry(5.8, 20, 16),
        new THREE.MeshBasicMaterial({ color: 0xffe0a2, fog: false })
    );
    sunDisc.position.set(-80, 52, -150);
    scene.add(sunDisc);

    // Quầng sáng hào quang mặt trời
    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = 128;
    glowCanvas.height = 128;
    const ctx = glowCanvas.getContext("2d");
    const glow = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    glow.addColorStop(0, "rgba(255,230,170,0.85)");
    glow.addColorStop(0.35, "rgba(255,200,140,0.32)");
    glow.addColorStop(1, "rgba(255,190,130,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 128, 128);

    sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(glowCanvas),
        transparent: true,
        depthWrite: false,
        fog: false
    }));
    sunHalo.position.copy(sunDisc.position);
    sunHalo.scale.set(65, 65, 1);
    scene.add(sunHalo);

    // Mặt trăng cho ban đêm
    const moonCanvas = document.createElement("canvas");
    moonCanvas.width = 128;
    moonCanvas.height = 128;
    const mctx = moonCanvas.getContext("2d");
    const mglow = mctx.createRadialGradient(64, 64, 6, 64, 64, 64);
    mglow.addColorStop(0, "rgba(235,245,255,0.95)");
    mglow.addColorStop(0.4, "rgba(180,210,255,0.45)");
    mglow.addColorStop(1, "rgba(150,190,255,0)");
    mctx.fillStyle = mglow;
    mctx.fillRect(0, 0, 128, 128);

    moonDisc = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(moonCanvas),
        transparent: true,
        depthWrite: false,
        fog: false
    }));
    moonDisc.position.set(80, 55, 150);
    moonDisc.scale.set(50, 50, 1);
    moonDisc.visible = false;
    scene.add(moonDisc);

    // Dải ngân hà & các vì sao ban đêm
    const starCount = 1200;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(Math.random() * 0.95);
        const radius = 410;
        starPositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
        starPositions[i * 3 + 1] = radius * Math.cos(phi) + 15;
        starPositions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    starField = new THREE.Points(
        starGeometry,
        new THREE.PointsMaterial({ color: 0xffffff, size: 1.4, transparent: true, opacity: 0, fog: false })
    );
    scene.add(starField);

    // Mây bồng bềnh phong cách Anime
    const cloudMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.78, depthWrite: false, fog: false });
    for (let i = 0; i < 14; i++) {
        const cloud = new THREE.Group();
        const puffs = 3 + Math.floor(Math.random() * 4);
        for (let puff = 0; puff < puffs; puff++) {
            const shape = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2, 1), cloudMaterial);
            shape.position.set((puff - (puffs - 1) / 2) * 1.35, Math.sin(puff * 1.5) * 0.28, Math.random() * 0.4);
            shape.scale.set(1.4 + Math.random() * 0.7, 0.45 + Math.random() * 0.3, 0.7);
            cloud.add(shape);
        }
        cloud.position.set((Math.random() - 0.5) * 260, 32 + Math.random() * 20, (Math.random() - 0.5) * 220);
        cloud.scale.setScalar(2.0 + Math.random() * 2.8);
        scene.add(cloud);
        animatedClouds.push(cloud);
    }
}

// Chuyển đổi bầu trời & ánh sáng theo 3 chế độ: Ngày / Hoàng hôn / Đêm
function setEnvironmentTime(mode) {
    currentTimeMode = mode;
    const colors = skyMesh.geometry.attributes.color;
    const positions = skyMesh.geometry.attributes.position;
    
    let top, middle, horizon, sunColor, hemiSky, hemiGround, fogColor, sunInt, moonInt;

    if (mode === "sunset") {
        top = new THREE.Color(0x3e3562);
        middle = new THREE.Color(0xd65d4b);
        horizon = new THREE.Color(0xf6af62);
        sunColor = 0xff7b39;
        hemiSky = 0xff9a76;
        hemiGround = 0x5a4436;
        fogColor = 0xe08b68;
        sunInt = 0.85;
        moonInt = 0.05;
        sunDisc.position.set(-110, 22, -140);
        sunDisc.visible = true;
        sunHalo.visible = true;
        moonDisc.visible = false;
        starField.material.opacity = 0.25;
    } else if (mode === "night") {
        top = new THREE.Color(0x0a1026);
        middle = new THREE.Color(0x131f42);
        horizon = new THREE.Color(0x1d2c52);
        sunColor = 0x223355;
        hemiSky = 0x203254;
        hemiGround = 0x121d1b;
        fogColor = 0x0f182c;
        sunInt = 0.05;
        moonInt = 0.45;
        sunDisc.visible = false;
        sunHalo.visible = false;
        moonDisc.visible = true;
        starField.material.opacity = 0.85;
    } else {
        // "day"
        top = new THREE.Color(0x3298df);
        middle = new THREE.Color(0x79c4ed);
        horizon = new THREE.Color(0xd8f3f5);
        sunColor = 0xfff1d2;
        hemiSky = 0xdff6ff;
        hemiGround = 0x537a4d;
        fogColor = 0xa6d9e8;
        sunInt = 0.75;
        moonInt = 0.0;
        sunDisc.position.set(-80, 52, -150);
        sunDisc.visible = true;
        sunHalo.visible = true;
        moonDisc.visible = false;
        starField.material.opacity = 0.0;
    }

    sunHalo.position.copy(sunDisc.position);
    sun.color.setHex(sunColor);
    sun.intensity = sunInt;
    moonLight.intensity = moonInt;
    hemiLight.color.set(hemiSky);
    hemiLight.groundColor.set(hemiGround);
    scene.fog.color.set(fogColor);
    scene.background.set(fogColor);

    for (let i = 0; i < positions.count; i++) {
        const height = positions.getY(i) / 440;
        const color = height > 0
            ? horizon.clone().lerp(middle, THREE.MathUtils.smoothstep(height, 0, 0.44)).lerp(top, THREE.MathUtils.smoothstep(height, 0.35, 0.88))
            : horizon.clone().lerp(middle, THREE.MathUtils.smoothstep(-height, 0, 0.5));
        colors.setXYZ(i, color.r, color.g, color.b);
    }
    colors.needsUpdate = true;

    // Cập nhật nhãn nút UI
    const timeIcon = document.getElementById("time-icon");
    const timeText = document.getElementById("time-text");
    if (timeIcon && timeText) {
        if (mode === "sunset") {
            timeIcon.textContent = "🌅";
            timeText.textContent = "Hoàng Hôn";
        } else if (mode === "night") {
            timeIcon.textContent = "🌌";
            timeText.textContent = "Đêm Sao";
        } else {
            timeIcon.textContent = "☀️";
            timeText.textContent = "Ban Ngày";
        }
    }
}

// ============================================================================
// TERRAIN & NATURE LANDSCAPE
// ============================================================================
const animatedTrees = [];
const pondRipples = [];
const pondSites = [
    { x: -24, z: -18, radius: 8.5 },
    { x: 34, z: -35, radius: 5.2 }
];
const campPathRoutes = [
    [[0, 2], [-3, -3], [-9, -8], [-16, -14]],
    [[1, 0], [5, -5], [12, -9], [16, -17]],
    [[0, -1], [6, 4], [16, 13], [25, 27]]
];

function terrainHeight(x, z) {
    const distance = Math.hypot(x, z);
    const clearing = THREE.MathUtils.smoothstep(distance, 13, 23);
    let height = (Math.sin(x * 0.065 + Math.cos(z * 0.07)) * 1.75
        + Math.cos(z * 0.058 - x * 0.025) * 1.4
        + Math.sin((x + z) * 0.11) * 0.55) * clearing;
    const pondBasin = pondSites.reduce((deepest, pond) => {
        const d = Math.hypot(x - pond.x, z - pond.z);
        return Math.max(deepest, 1 - THREE.MathUtils.smoothstep(d, pond.radius * 0.8, pond.radius * 2));
    }, 0);
    height = THREE.MathUtils.lerp(height, -0.5, pondBasin);
    return height;
}

function isNearPond(x, z, margin = 0) {
    return pondSites.some(pond => Math.hypot(x - pond.x, z - pond.z) < pond.radius + margin);
}

function isNearPath(x, z, margin = 2.6) {
    for (const route of campPathRoutes) {
        for (let i = 0; i < route.length - 1; i++) {
            const [ax, az] = route[i];
            const [bx, bz] = route[i + 1];
            const dx = bx - ax;
            const dz = bz - az;
            const t = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
            if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < margin) return true;
        }
    }
    return false;
}

function createTrail(route) {
    const curve = new THREE.CatmullRomCurve3(route.map(([x, z]) => new THREE.Vector3(x, 0, z)));
    const segments = 120;
    const positions = [];
    const colors = [];
    const indices = [];
    const edgeColor = new THREE.Color(0xc6a66f);
    const centerColor = new THREE.Color(0xe4c98d);
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const point = curve.getPointAt(t);
        const tangent = curve.getTangentAt(t);
        const halfWidth = 1.15 + Math.sin(t * Math.PI) * 0.25;
        const normalX = -tangent.z;
        const normalZ = tangent.x;
        for (let side = -1; side <= 1; side++) {
            const edge = Math.abs(side);
            positions.push(
                point.x + normalX * halfWidth * side,
                terrainHeight(point.x + normalX * halfWidth * side, point.z + normalZ * halfWidth * side) + 0.045,
                point.z + normalZ * halfWidth * side
            );
            const color = edge ? edgeColor : centerColor;
            colors.push(color.r, color.g, color.b);
        }
    }
    for (let i = 0; i < segments; i++) {
        const row = i * 3;
        const next = row + 3;
        indices.push(row, row + 1, next, row + 1, next + 1, next);
        indices.push(row + 1, row + 2, next + 1, row + 2, next + 2, next + 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const trail = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
    trail.receiveShadow = true;
    scene.add(trail);
}

function createDistantHills() {
    const colors = [0x668eb0, 0x79a4b9, 0x8db6bc];
    for (let i = 0; i < 20; i++) {
        const angle = (i / 20) * Math.PI * 2 + Math.random() * 0.12;
        const radius = 135 + Math.random() * 20;
        const height = 24 + Math.random() * 26;
        const width = 24 + Math.random() * 18;
        const hill = new THREE.Mesh(
            new THREE.ConeGeometry(width, height, 8),
            makeAnimeMaterial(colors[i % colors.length], { flatShading: true })
        );
        hill.position.set(Math.cos(angle) * radius, height * 0.18 - 2, Math.sin(angle) * radius);
        hill.rotation.y = Math.random() * Math.PI;
        hill.receiveShadow = true;
        scene.add(hill);
    }
}

// Cỏ xanh ngát đung đưa theo gió
let instancedGrass;
function createGroundCover() {
    const grassGeometry = new THREE.BufferGeometry();
    const grassPositions = [];
    const grassIndices = [];
    for (let blade = 0; blade < 3; blade++) {
        const angle = (blade / 3) * Math.PI * 2;
        const width = 0.08;
        const height = 0.44 + (blade % 2) * 0.09;
        const base = blade * 4;
        grassPositions.push(
            0, 0, 0,
            -Math.sin(angle) * width, height * 0.48, Math.cos(angle) * width,
            Math.sin(angle + 0.18) * 0.03, height, -Math.cos(angle + 0.18) * 0.03,
            Math.sin(angle) * width, height * 0.48, -Math.cos(angle) * width
        );
        grassIndices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    grassGeometry.setAttribute("position", new THREE.Float32BufferAttribute(grassPositions, 3));
    grassGeometry.setIndex(grassIndices);
    grassGeometry.computeVertexNormals();

    instancedGrass = new THREE.InstancedMesh(
        grassGeometry,
        makeAnimeMaterial(0xffffff, { side: THREE.DoubleSide }),
        16000
    );
    instancedGrass.receiveShadow = true;
    const dummy = new THREE.Object3D();
    const grassPalette = [0x4ea844, 0x6bc44e, 0x8cd65a, 0x3d9456, 0xb6e262];
    let count = 0;
    let attempts = 0;
    while (count < 16000 && attempts < 40000) {
        attempts++;
        const x = (Math.random() - 0.5) * 175;
        const z = (Math.random() - 0.5) * 175;
        if (Math.hypot(x, z) < 5.5 || isNearPath(x, z, 1.1) || isNearPond(x, z, 2.2)) continue;
        dummy.position.set(x, terrainHeight(x, z), z);
        dummy.rotation.set(0, Math.random() * Math.PI, (Math.random() - 0.5) * 0.15);
        dummy.scale.set(0.7 + Math.random() * 1.2, 0.7 + Math.random() * 1.1, 0.7 + Math.random() * 1.2);
        dummy.updateMatrix();
        instancedGrass.setMatrixAt(count, dummy.matrix);
        instancedGrass.setColorAt(count, new THREE.Color(grassPalette[Math.floor(Math.random() * grassPalette.length)]));
        count++;
    }
    instancedGrass.count = count;
    instancedGrass.instanceMatrix.needsUpdate = true;
    if (instancedGrass.instanceColor) instancedGrass.instanceColor.needsUpdate = true;
    scene.add(instancedGrass);
}

function createWildflowers() {
    const flowerCount = 850;
    const petal = new THREE.InstancedMesh(
        new THREE.SphereGeometry(0.18, 7, 5),
        makeAnimeMaterial(0xffffff),
        flowerCount * 5
    );
    const center = new THREE.InstancedMesh(
        new THREE.SphereGeometry(0.1, 7, 5),
        makeAnimeMaterial(0xffdf8d),
        flowerCount
    );
    const dummy = new THREE.Object3D();
    const palette = [0xff99c2, 0xffeb8e, 0xffffff, 0xf6a6e2, 0xc8a8ff, 0x79d7ff];
    for (let i = 0; i < flowerCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 12 + Math.random() * 58;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        if (isNearPath(x, z, 2.2) || isNearPond(x, z, 1.5)) {
            i--;
            continue;
        }
        const y = terrainHeight(x, z) + 0.38 + Math.random() * 0.24;
        const flowerColor = new THREE.Color(palette[Math.floor(Math.random() * palette.length)]);
        for (let petalIndex = 0; petalIndex < 5; petalIndex++) {
            const petalAngle = (petalIndex / 5) * Math.PI * 2;
            dummy.position.set(x + Math.cos(petalAngle) * 0.18, y, z + Math.sin(petalAngle) * 0.18);
            dummy.rotation.set(0, -petalAngle, 0.28);
            dummy.scale.set(1, 0.58, 1);
            dummy.updateMatrix();
            const instance = i * 5 + petalIndex;
            petal.setMatrixAt(instance, dummy.matrix);
            petal.setColorAt(instance, flowerColor);
        }
        dummy.position.set(x, y + 0.02, z);
        dummy.scale.setScalar(1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        center.setMatrixAt(i, dummy.matrix);
    }
    petal.instanceMatrix.needsUpdate = true;
    center.instanceMatrix.needsUpdate = true;
    if (petal.instanceColor) petal.instanceColor.needsUpdate = true;
    petal.receiveShadow = true;
    center.receiveShadow = true;
    scene.add(petal, center);
}

// Bếp lửa trại bập bùng
const fireParticles = [];
function createFire() {
    const group = new THREE.Group();
    const logMaterial = makeAnimeMaterial(0x563a28, { flatShading: true });
    for (const angle of [Math.PI / 4, -Math.PI / 4]) {
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 2.2, 7), logMaterial);
        log.rotation.z = Math.PI / 2;
        log.rotation.y = angle;
        log.position.y = 0.22;
        log.castShadow = true;
        group.add(log);
    }
    const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.68, 1.6, 8),
        new THREE.MeshBasicMaterial({ color: 0xff7b22, transparent: true, opacity: 0.9 })
    );
    flame.position.y = 0.88;
    group.add(flame);

    const light = new THREE.PointLight(0xff9933, 2.4, 18);
    light.position.y = 1.1;
    light.castShadow = true;
    group.add(light);

    for (let i = 0; i < 28; i++) {
        const particle = new THREE.Mesh(
            new THREE.SphereGeometry(0.06, 6, 4),
            new THREE.MeshBasicMaterial({ color: 0xffb844, transparent: true, opacity: 0.85 })
        );
        particle.position.set((Math.random() - 0.5) * 0.7, Math.random() * 1.5, (Math.random() - 0.5) * 0.7);
        group.add(particle);
        fireParticles.push({ mesh: particle, speed: 0.8 + Math.random() * 0.9, maxH: 1.8 + Math.random() * 1.2 });
    }
    group.position.set(0, terrainHeight(0, 0), 0);
    scene.add(group);
    return { group, flame, light };
}

function dressCampfire() {
    const seatMaterial = makeAnimeMaterial(0x6e4932, { flatShading: true });
    for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2 + 0.35;
        const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.54, 0.58, 8), seatMaterial);
        seat.position.set(Math.cos(angle) * 3.4, terrainHeight(Math.cos(angle) * 3.4, Math.sin(angle) * 3.4) + 0.29, Math.sin(angle) * 3.4);
        seat.castShadow = true;
        seat.receiveShadow = true;
        scene.add(seat);
    }
}

function mergeMeshGeometry(meshes) {
    let vertexCount = 0;
    let indexCount = 0;
    meshes.forEach(mesh => {
        const geom = mesh.geometry;
        vertexCount += geom.attributes.position.count;
        indexCount += geom.index ? geom.index.count : geom.attributes.position.count;
    });
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const indices = [];
    let vertexOffset = 0;
    const normalMatrix = new THREE.Matrix3();

    meshes.forEach(mesh => {
        mesh.updateMatrix();
        normalMatrix.getNormalMatrix(mesh.matrix);
        const geom = mesh.geometry.clone();
        const pos = geom.attributes.position;
        const norm = geom.attributes.normal;
        for (let i = 0; i < pos.count; i++) {
            const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrix);
            positions[(vertexOffset + i) * 3] = v.x;
            positions[(vertexOffset + i) * 3 + 1] = v.y;
            positions[(vertexOffset + i) * 3 + 2] = v.z;
            const n = new THREE.Vector3().fromBufferAttribute(norm, i).applyMatrix3(normalMatrix).normalize();
            normals[(vertexOffset + i) * 3] = n.x;
            normals[(vertexOffset + i) * 3 + 1] = n.y;
            normals[(vertexOffset + i) * 3 + 2] = n.z;
        }
        if (geom.index) {
            for (let i = 0; i < geom.index.count; i++) indices.push(geom.index.getX(i) + vertexOffset);
        } else {
            for (let i = 0; i < pos.count; i++) indices.push(vertexOffset + i);
        }
        vertexOffset += pos.count;
    });
    const merged = new THREE.BufferGeometry();
    merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    merged.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    merged.setIndex(indices);
    return merged;
}

// Cây cối phong cách Anime (gồm cây xanh và cây hoa anh đào rực rỡ)
function createTree(x, z, broadleaf, cherryBlossom = false) {
    const tree = new THREE.Group();
    const trunkMaterial = makeAnimeMaterial(0x69432e, { flatShading: true });
    const trunkMeshes = [new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.4, broadleaf ? 2.5 : 3.6, 6),
        trunkMaterial
    )];
    const canopyMeshes = [];
    const addCanopy = (geometry, material, position, rotation = new THREE.Euler()) => {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(position);
        mesh.rotation.copy(rotation);
        canopyMeshes.push(mesh);
    };
    const trunk = trunkMeshes[0];
    trunk.position.y = broadleaf ? 1.25 : 1.8;

    const leafColors = broadleaf
        ? cherryBlossom
            ? [0xf799c2, 0xffbad3, 0xee85b4, 0xffd4e4]
            : [0x5fad58, 0x7ecb62, 0x4fa25e, 0x9fd26e]
        : [0x287a52, 0x36945b, 0x24704f, 0x50a66a];

    const leafMaterial = makeAnimeMaterial(leafColors[Math.floor(Math.random() * leafColors.length)]);

    if (broadleaf) {
        const crownSize = 1.2 + Math.random() * 0.55;
        const clusters = 5;
        for (let i = 0; i < clusters; i++) {
            const size = i === 0 ? crownSize * 1.15 : crownSize * (0.65 + Math.random() * 0.25);
            const angle = (i / clusters) * Math.PI * 2;
            const crownPosition = new THREE.Vector3(
                Math.cos(angle) * (i === 0 ? 0 : 0.8),
                i === 0 ? 3.4 : 2.8 + Math.random() * 0.7,
                Math.sin(angle) * (i === 0 ? 0 : 0.8)
            );
            addCanopy(
                new THREE.IcosahedronGeometry(size, 1),
                leafMaterial,
                crownPosition,
                new THREE.Euler(Math.random() * 0.2, Math.random() * Math.PI, Math.random() * 0.2)
            );
        }
    } else {
        const width = 1.6 + Math.random() * 0.45;
        for (let i = 0; i < 5; i++) {
            addCanopy(
                new THREE.ConeGeometry(width * (1 - i * 0.17), 2.2, 7),
                leafMaterial,
                new THREE.Vector3(0, 1.9 + i * 0.72, 0),
                new THREE.Euler(0, Math.random() * 0.5, 0)
            );
        }
    }
    const trunkMesh = new THREE.Mesh(mergeMeshGeometry(trunkMeshes), trunkMaterial);
    trunkMesh.castShadow = true;
    trunkMesh.receiveShadow = true;
    tree.add(trunkMesh);

    const canopy = new THREE.Mesh(mergeMeshGeometry(canopyMeshes), leafMaterial);
    canopy.castShadow = true;
    canopy.receiveShadow = true;
    tree.add(canopy);

    tree.position.set(x, terrainHeight(x, z), z);
    tree.scale.setScalar(0.75 + Math.random() * 0.7);
    tree.rotation.y = Math.random() * Math.PI;
    tree.userData.windOffset = Math.random() * 30;
    scene.add(tree);
    animatedTrees.push(tree);
    return tree;
}

function createTent(x, z, color) {
    const tent = new THREE.Group();
    const canvasMaterial = makeAnimeMaterial(color);
    const body = new THREE.Mesh(new THREE.ConeGeometry(2.4, 2.7, 4), canvasMaterial);
    body.position.y = 1.35;
    body.rotation.y = Math.PI / 4;
    body.castShadow = true;
    body.receiveShadow = true;
    tent.add(body);
    tent.position.set(x, terrainHeight(x, z), z);
    scene.add(tent);
}

function createLantern(x, z) {
    const lantern = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.3, 6), makeAnimeMaterial(0x4a3224, { flatShading: true }));
    post.position.y = 1.15;
    post.castShadow = true;
    lantern.add(post);

    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.14, 0.38, 6), new THREE.MeshBasicMaterial({ color: 0xffe2a4 }));
    glass.position.set(0.3, 1.85, 0);
    lantern.add(glass);

    const light = new THREE.PointLight(0xffb844, 1.2, 7);
    light.position.copy(glass.position);
    lantern.add(light);

    lantern.position.set(x, terrainHeight(x, z), z);
    scene.add(lantern);
}

function createPond({ x, z, radius }) {
    const waterY = terrainHeight(x, z) + 0.16;
    const water = new THREE.Mesh(
        new THREE.CircleGeometry(radius, 48),
        new THREE.MeshStandardMaterial({
            color: 0x64b8c4,
            roughness: 0.15,
            metalness: 0.1,
            transparent: true,
            opacity: 0.88
        })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(x, waterY, z);
    scene.add(water);

    const shore = new THREE.Mesh(
        new THREE.TorusGeometry(radius + 0.12, 0.32, 7, 48),
        makeAnimeMaterial(0x92b87f)
    );
    shore.rotation.x = Math.PI / 2;
    shore.position.set(x, waterY - 0.08, z);
    scene.add(shore);

    for (let i = 0; i < 3; i++) {
        const ripple = new THREE.Mesh(
            new THREE.TorusGeometry(1, 0.03, 4, 36),
            new THREE.MeshBasicMaterial({ color: 0xd6f4e6, transparent: true, opacity: 0.28, depthWrite: false })
        );
        ripple.rotation.x = Math.PI / 2;
        ripple.position.set(x + (i - 1) * radius * 0.25, waterY + 0.025 + i * 0.002, z + (i % 2) * radius * 0.18);
        scene.add(ripple);
        pondRipples.push({ mesh: ripple, phase: i * 2.1 + x });
    }

    // Hoa súng nở trên mặt hồ
    const lilyCount = radius > 6 ? 6 : 3;
    for (let i = 0; i < lilyCount; i++) {
        const angle = i * 2.3 + x;
        const distance = radius * (0.28 + (i % 2) * 0.28);
        const lx = x + Math.cos(angle) * distance;
        const lz = z + Math.sin(angle) * distance;
        const leaf = new THREE.Mesh(
            new THREE.CircleGeometry(0.48, 9, 0.35, Math.PI * 1.8),
            makeAnimeMaterial(i % 2 ? 0x68a850 : 0x559648, { side: THREE.DoubleSide })
        );
        leaf.rotation.set(-Math.PI / 2, 0, angle);
        leaf.position.set(lx, waterY + 0.07, lz);
        scene.add(leaf);

        const blossom = new THREE.Mesh(
            new THREE.SphereGeometry(0.13, 8, 6),
            makeAnimeMaterial(i % 2 ? 0xffdf8d : 0xffb8d0)
        );
        blossom.position.set(lx, waterY + 0.16, lz);
        scene.add(blossom);
    }
}

// Bến cầu gỗ bên hồ nước để ngắm cảnh
function createPier(x, z, angle) {
    const pier = new THREE.Group();
    const wood = makeAnimeMaterial(0x825c40, { flatShading: true });
    for (let i = 0; i < 6; i++) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.45), wood);
        plank.position.set(0, 0.35, i * 0.48);
        plank.castShadow = true;
        plank.receiveShadow = true;
        pier.add(plank);
        if (i % 2 === 0) {
            const pillarL = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.2, 6), wood);
            pillarL.position.set(-0.7, -0.2, i * 0.48);
            pier.add(pillarL);
            const pillarR = pillarL.clone();
            pillarR.position.x = 0.7;
            pier.add(pillarR);
        }
    }
    pier.position.set(x, terrainHeight(x, z), z);
    pier.rotation.y = angle;
    scene.add(pier);
}

// ============================================================================
// CÁNH HOA ANH ĐÀO (SAKURA DRIFT) & ĐOM ĐÓM (FIREFLIES)
// ============================================================================
let sakuraMesh;
const SAKURA_COUNT = 450;
const sakuraData = [];

function createSakuraPetals() {
    const petalShape = new THREE.BufferGeometry();
    const verts = new Float32Array([
        0, 0, 0,
        -0.08, 0.14, 0.04,
        0, 0.28, 0.02,
        0.08, 0.14, 0.04
    ]);
    const indices = [0, 1, 2, 0, 2, 3];
    petalShape.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    petalShape.setIndex(indices);
    petalShape.computeVertexNormals();

    const petalMat = new THREE.MeshBasicMaterial({
        color: 0xffb4cb,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.88,
        depthWrite: false
    });

    sakuraMesh = new THREE.InstancedMesh(petalShape, petalMat, SAKURA_COUNT);
    const dummy = new THREE.Object3D();

    for (let i = 0; i < SAKURA_COUNT; i++) {
        const x = (Math.random() - 0.5) * 160;
        const y = 8 + Math.random() * 26;
        const z = (Math.random() - 0.5) * 160;
        dummy.position.set(x, y, z);
        dummy.scale.setScalar(0.7 + Math.random() * 0.7);
        dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        dummy.updateMatrix();
        sakuraMesh.setMatrixAt(i, dummy.matrix);

        sakuraData.push({
            x, y, z,
            scale: dummy.scale.x,
            speedY: 0.9 + Math.random() * 1.3,
            rotSpeedX: 0.8 + Math.random() * 1.5,
            rotSpeedY: 0.6 + Math.random() * 1.2,
            swayPhase: Math.random() * Math.PI * 2
        });
    }
    sakuraMesh.instanceMatrix.needsUpdate = true;
    scene.add(sakuraMesh);
}

// Đom đóm lấp lánh (Fireflies / Anemo Wisps)
let fireflyMesh;
const FIREFLY_COUNT = 140;
const fireflyData = [];

function createFireflies() {
    const geom = new THREE.SphereGeometry(0.14, 6, 6);
    const mat = new THREE.MeshBasicMaterial({
        color: 0xfff28a,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    fireflyMesh = new THREE.InstancedMesh(geom, mat, FIREFLY_COUNT);
    const dummy = new THREE.Object3D();

    for (let i = 0; i < FIREFLY_COUNT; i++) {
        const x = (Math.random() - 0.5) * 120;
        const z = (Math.random() - 0.5) * 120;
        const y = terrainHeight(x, z) + 0.8 + Math.random() * 2.8;
        dummy.position.set(x, y, z);
        dummy.updateMatrix();
        fireflyMesh.setMatrixAt(i, dummy.matrix);

        fireflyData.push({
            originX: x,
            originZ: z,
            baseY: y,
            freq: 0.7 + Math.random() * 1.1,
            phase: Math.random() * Math.PI * 2,
            radius: 1.5 + Math.random() * 3.5
        });
    }
    fireflyMesh.instanceMatrix.needsUpdate = true;
    scene.add(fireflyMesh);
}

// Hệ thống mưa
const rainCount = 1200;
const rainPositions = new Float32Array(rainCount * 3);
for (let i = 0; i < rainCount; i++) {
    rainPositions[i * 3] = (Math.random() - 0.5) * 110;
    rainPositions[i * 3 + 1] = Math.random() * 45;
    rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 110;
}
const rainGeometry = new THREE.BufferGeometry();
rainGeometry.setAttribute("position", new THREE.BufferAttribute(rainPositions, 3));
const rainSystem = new THREE.Points(
    rainGeometry,
    new THREE.PointsMaterial({ color: 0xe1f4ff, size: 0.12, transparent: true, opacity: 0.7 })
);
rainSystem.visible = false;
scene.add(rainSystem);

// ============================================================================
// NHÂN VẬT 3D ANIME DỄ THƯƠNG (GENSHIN 1/10 CHIBI ADVENTURER)
// ============================================================================
// Tạo kết cấu mặt anime (Mắt to long lanh có highlight, mi cong và má hồng đào)
function createAnimeFaceTexture(eyeColorHex = "#6c79bd") {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");

    // Nền da anime trắng hồng mịn màng
    ctx.fillStyle = "#fff1e8";
    ctx.fillRect(0, 0, 512, 512);

    // Vẽ má hồng đào dễ thương 2 bên
    const drawBlush = (cx, cy) => {
        const blush = ctx.createRadialGradient(cx, cy, 2, cx, cy, 48);
        blush.addColorStop(0, "rgba(255, 130, 140, 0.55)");
        blush.addColorStop(0.5, "rgba(255, 160, 170, 0.28)");
        blush.addColorStop(1, "rgba(255, 190, 190, 0)");
        ctx.fillStyle = blush;
        ctx.beginPath();
        ctx.arc(cx, cy, 48, 0, Math.PI * 2);
        ctx.fill();
    };
    drawBlush(150, 310);
    drawBlush(362, 310);

    // Vẽ mắt anime long lanh hai bên
    const drawEye = (cx, cy, isLeft) => {
        ctx.save();
        ctx.translate(cx, cy);

        // Lòng trắng mắt (Sclera)
        ctx.beginPath();
        ctx.ellipse(0, 0, 52, 68, 0, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();

        // Lòng đen gradient anime (Iris)
        const irisGrad = ctx.createLinearGradient(0, -60, 0, 60);
        irisGrad.addColorStop(0, "#2a2238");
        irisGrad.addColorStop(0.35, eyeColorHex);
        irisGrad.addColorStop(1, "#a8c0ff");
        ctx.beginPath();
        ctx.ellipse(0, 6, 36, 54, 0, 0, Math.PI * 2);
        ctx.fillStyle = irisGrad;
        ctx.fill();

        // Con ngươi sâu thẳm
        ctx.beginPath();
        ctx.ellipse(0, 6, 17, 26, 0, 0, Math.PI * 2);
        ctx.fillStyle = "#161022";
        ctx.fill();

        // Điểm phản quang sáng lấp lánh (Catchlights/Highlights)
        // Highlight lớn
        ctx.beginPath();
        ctx.ellipse(isLeft ? -10 : -8, -18, 12, 17, -0.3, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        // Highlight nhỏ hình ngôi sao/chấm lấp lánh góc dưới
        ctx.beginPath();
        ctx.arc(isLeft ? 12 : 10, 24, 6, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        ctx.fill();

        // Mi mắt trên dày kiểu anime (Eyelash)
        ctx.lineWidth = 11;
        ctx.strokeStyle = "#382835";
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(0, -12, 54, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();

        // Đuôi mắt cong vút nhẹ
        ctx.lineWidth = 5;
        ctx.beginPath();
        if (isLeft) {
            ctx.moveTo(-45, -28);
            ctx.lineTo(-58, -34);
        } else {
            ctx.moveTo(45, -28);
            ctx.lineTo(58, -34);
        }
        ctx.stroke();

        ctx.restore();
    };
    drawEye(185, 240, true);
    drawEye(327, 240, false);

    // Chân mày anime thanh mảnh
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#4d3942";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(185, 175, 42, Math.PI * 1.25, Math.PI * 1.75);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(327, 175, 42, Math.PI * 1.25, Math.PI * 1.75);
    ctx.stroke();

    // Mũi nhỏ nhắn xinh xắn
    ctx.fillStyle = "#d89679";
    ctx.beginPath();
    ctx.arc(256, 320, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Miệng cười chúm chím dễ thương
    ctx.lineWidth = 4.5;
    ctx.strokeStyle = "#9c575d";
    ctx.beginPath();
    ctx.arc(256, 360, 22, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    texture.encoding = THREE.sRGBEncoding;
    return texture;
}

// Tạo hình nhân vật Anime 3D Chibi (Genshin Adventurer)
function createCharacter(config) {
    const group = new THREE.Group();
    const feminine = config.gender === "female";
    const skinMat = makeAnimeMaterial(0xffecd9);
    const outfitColor = new THREE.Color(config.color);
    const outfitMat = makeAnimeMaterial(outfitColor);
    const darkOutfitMat = makeAnimeMaterial(outfitColor.clone().multiplyScalar(0.68));
    const goldTrimMat = makeAnimeMaterial(0xfad02c);
    const bootsMat = makeAnimeMaterial(0x523d46);
    const hairColorHex = config.style === "stargazer" ? 0x483d5a : feminine ? 0x5a3848 : 0x463832;
    const hairMat = makeAnimeMaterial(hairColorHex);

    // Đổ bóng chân
    const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(0.55, 24),
        new THREE.MeshBasicMaterial({ color: 0x1f362e, transparent: true, opacity: 0.28, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -0.66;
    group.add(shadow);

    // ==========================================
    // KHUNG THÂN VÀ TRANG PHỤC ADVENTURER
    // ==========================================
    const bodyRig = new THREE.Group();
    bodyRig.position.y = 1.05;
    group.add(bodyRig);

    // Thân áo thám hiểm
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.42, 0.72, 16), outfitMat);
    torso.position.y = 0.36;
    torso.castShadow = true;
    bodyRig.add(torso);

    // Áo choàng thám hiểm vai (Capelet) có viền vàng
    const capelet = new THREE.Mesh(new THREE.ConeGeometry(0.58, 0.5, 16, 1, true), outfitMat);
    capelet.position.y = 0.65;
    capelet.rotation.x = Math.PI;
    capelet.castShadow = true;
    bodyRig.add(capelet);

    const goldBrooch = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 10, 8),
        goldTrimMat
    );
    goldBrooch.position.set(0, 0.62, 0.38);
    bodyRig.add(goldBrooch);

    // Ngọc đính ngực áo (Gemstone)
    const gem = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.05, 0),
        new THREE.MeshBasicMaterial({ color: config.style === "stargazer" ? 0x7b68ee : 0x48d1cc })
    );
    gem.position.set(0, 0.62, 0.44);
    bodyRig.add(gem);

    // Khăn quàng cổ lụa bay phất phơ (Fluttering Scarf)
    const scarfKnot = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.08, 6, 12), goldTrimMat);
    scarfKnot.position.set(0, 0.72, 0.02);
    scarfKnot.rotation.x = Math.PI / 2;
    bodyRig.add(scarfKnot);

    const scarfTail = new THREE.Group();
    const scarfMesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.65, 0.04), goldTrimMat);
    scarfMesh.position.set(0, -0.32, 0);
    scarfTail.add(scarfMesh);
    scarfTail.position.set(0.18, 0.7, -0.22);
    scarfTail.rotation.x = 0.35;
    bodyRig.add(scarfTail);

    // Váy xòe dễ thương cho nhân vật nữ hoặc quần thám hiểm cho nam
    let skirt;
    if (feminine) {
        skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.66, 0.44, 16), outfitMat);
        skirt.position.y = -0.02;
        skirt.castShadow = true;
        bodyRig.add(skirt);

        const skirtHem = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.035, 6, 16), goldTrimMat);
        skirtHem.position.y = -0.23;
        skirtHem.rotation.x = Math.PI / 2;
        bodyRig.add(skirtHem);
    } else {
        const shorts = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.46, 0.34, 14), darkOutfitMat);
        shorts.position.y = 0.02;
        shorts.castShadow = true;
        bodyRig.add(shorts);
    }

    // ==========================================
    // ĐẦU VÀ KHUÔN MẶT ANIME
    // ==========================================
    const headRig = new THREE.Group();
    headRig.position.set(0, 1.05, 0.04);
    bodyRig.add(headRig);

    // Khuôn mặt anime (Head mesh)
    const headGeom = new THREE.SphereGeometry(0.48, 24, 20);
    headGeom.scale(0.96, 1.02, 0.92);
    const head = new THREE.Mesh(headGeom, skinMat);
    head.castShadow = true;
    headRig.add(head);

    // Tấm mặt với texture mắt to long lanh anime
    const eyeColorHex = config.style === "stargazer" ? "#6b77c9" : config.style === "spirit" ? "#529f79" : "#c46c4f";
    const faceTex = createAnimeFaceTexture(eyeColorHex);
    const facePlate = new THREE.Mesh(
        new THREE.PlaneGeometry(0.68, 0.68),
        new THREE.MeshBasicMaterial({ map: faceTex, transparent: true })
    );
    facePlate.position.set(0, 0.02, 0.43);
    headRig.add(facePlate);

    // Tai anime nhỏ nhắn
    for (const side of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), skinMat);
        ear.scale.set(0.6, 1, 0.8);
        ear.position.set(side * 0.46, -0.02, 0);
        headRig.add(ear);
    }

    // ==========================================
    // MÁI TÓC ANIME NHIỀU LỚP & CỌNG TÓC NGỐ (AHOGE)
    // ==========================================
    // Mái tóc sau (Back hair)
    const backHairGeom = new THREE.SphereGeometry(0.52, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.65);
    const backHair = new THREE.Mesh(backHairGeom, hairMat);
    backHair.position.set(0, 0.05, -0.02);
    headRig.add(backHair);

    // Tóc mái trước (Bangs)
    for (let i = -2; i <= 2; i++) {
        const bang = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.38, 6), hairMat);
        bang.position.set(i * 0.14, 0.16 - Math.abs(i) * 0.04, 0.38);
        bang.rotation.z = i * -0.18;
        bang.rotation.x = -0.3;
        headRig.add(bang);
    }

    // Lọn tóc mai hai bên ôm má
    for (const side of [-1, 1]) {
        const sideLock = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.03, 0.58, 6), hairMat);
        sideLock.position.set(side * 0.42, -0.16, 0.22);
        sideLock.rotation.z = side * -0.22;
        headRig.add(sideLock);
    }

    // Song đuôi (Twin-tails) hoặc tóc đuôi ngựa nếu là nữ
    const twinTails = [];
    if (feminine) {
        for (const side of [-1, 1]) {
            const tailRoot = new THREE.Group();
            tailRoot.position.set(side * 0.42, 0.12, -0.22);
            
            const ribbon = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.03, 6, 8), goldTrimMat);
            tailRoot.add(ribbon);

            const tail = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.78, 8), hairMat);
            tail.position.set(side * 0.12, -0.42, 0);
            tail.rotation.z = side * -0.38;
            tail.rotation.x = 0.22;
            tailRoot.add(tail);

            headRig.add(tailRoot);
            twinTails.push(tailRoot);
        }
    }

    // Cọng tóc ngố (Ahoge) đung đưa trên đỉnh đầu - Biểu tượng anime dễ thương
    const ahogeRig = new THREE.Group();
    ahogeRig.position.set(0, 0.48, 0.12);
    const ahogeCurve = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 6, 12, Math.PI * 0.85), hairMat);
    ahogeCurve.rotation.z = 0.6;
    ahogeCurve.rotation.x = -0.4;
    ahogeRig.add(ahogeCurve);
    headRig.add(ahogeRig);

    // Kẹp tóc thời trang theo Style
    if (config.style === "stargazer") {
        const starClip = new THREE.Mesh(new THREE.OctahedronGeometry(0.08, 0), goldTrimMat);
        starClip.position.set(0.32, 0.32, 0.32);
        headRig.add(starClip);
    } else if (config.style === "spirit") {
        const leafClip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.32, 5), makeAnimeMaterial(0x66bb6a));
        leafClip.position.set(-0.32, 0.32, 0.32);
        leafClip.rotation.z = 0.7;
        headRig.add(leafClip);
    }

    // ==========================================
    // TAY VÀ CHÂN NHÂN VẬT
    // ==========================================
    const arms = [];
    const legs = [];

    for (const side of [-1, 1]) {
        // Cánh tay
        const shoulder = new THREE.Group();
        shoulder.position.set(side * 0.46, 0.64, 0);

        const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.14, 0.36, 8), outfitMat);
        sleeve.position.y = -0.18;
        shoulder.add(sleeve);

        const sleeveGold = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.025, 4, 8), goldTrimMat);
        sleeveGold.position.y = -0.36;
        sleeveGold.rotation.x = Math.PI / 2;
        shoulder.add(sleeveGold);

        const hand = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), skinMat);
        hand.position.y = -0.46;
        shoulder.add(hand);

        bodyRig.add(shoulder);
        arms.push(shoulder);

        // Chân và bốt thám hiểm
        const hip = new THREE.Group();
        hip.position.set(side * 0.2, 0.6, 0);

        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.85, 8), feminine ? skinMat : darkOutfitMat);
        leg.position.y = -0.42;
        hip.add(leg);

        const boot = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.44), bootsMat);
        boot.position.set(0, -0.98, 0.08);
        boot.castShadow = true;
        hip.add(boot);

        const bootCuff = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.035, 4, 8), goldTrimMat);
        bootCuff.position.y = -0.84;
        bootCuff.rotation.x = Math.PI / 2;
        hip.add(bootCuff);

        group.add(hip);
        legs.push(hip);
    }

    // ==========================================
    // BALO THÁM HIỂM (GENSHIN ADVENTURER BACKPACK)
    // ==========================================
    const backpack = new THREE.Group();
    const packColor = config.style === "stargazer" ? 0x5a4868 : config.style === "spirit" ? 0x476a52 : 0x7a523a;
    const packMesh = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), makeAnimeMaterial(packColor));
    packMesh.castShadow = true;
    backpack.add(packMesh);

    // Thảm ngủ cuộn tròn phía trên balo
    const bedroll = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.62, 8), makeAnimeMaterial(0xf5d18a));
    bedroll.rotation.z = Math.PI / 2;
    bedroll.position.set(0, 0.42, 0.04);
    backpack.add(bedroll);

    // Đèn lồng pha lê mini gắn balo phát sáng nhẹ
    const miniLantern = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.09, 0),
        new THREE.MeshBasicMaterial({ color: 0xffd277 })
    );
    miniLantern.position.set(0.24, -0.22, 0.2);
    backpack.add(miniLantern);

    backpack.position.set(0, 1.44, -0.42);
    group.add(backpack);

    group.userData = {
        arms,
        legs,
        bodyRig,
        headRig,
        ahogeRig,
        scarfTail,
        twinTails,
        shadow,
        gestureTime: 0,
        blinkTime: 0,
        isCustomModel: false
    };

    group.scale.setScalar(1.12);
    group.position.set(localPos.x, CHARACTER_FOOT_OFFSET, localPos.z);
    scene.add(group);
    return group;
}

// Bụi bước chân
const footstepPuffs = [];
const puffMaterial = new THREE.MeshBasicMaterial({ color: 0xffebd2, transparent: true, opacity: 0.45, depthWrite: false });
for (let i = 0; i < 12; i++) {
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 0), puffMaterial);
    puff.visible = false;
    scene.add(puff);
    footstepPuffs.push({ mesh: puff, life: 0, velocity: new THREE.Vector3() });
}
let nextPuff = 0;

function emitFootstepDust(position) {
    const puff = footstepPuffs[nextPuff];
    puff.mesh.position.copy(position);
    puff.mesh.scale.setScalar(0.4);
    puff.mesh.visible = true;
    puff.life = 1;
    puff.velocity.set((Math.random() - 0.5) * 0.4, 0.3 + Math.random() * 0.3, (Math.random() - 0.5) * 0.4);
    nextPuff = (nextPuff + 1) % footstepPuffs.length;
}

function updateFootstepDust(delta) {
    for (const puff of footstepPuffs) {
        if (puff.life <= 0) continue;
        puff.life -= delta * 2.2;
        puff.mesh.position.addScaledVector(puff.velocity, delta);
        puff.mesh.scale.setScalar(0.4 + (1 - puff.life) * 0.8);
        puff.mesh.material.opacity = Math.max(0, puff.life * 0.45);
        if (puff.life <= 0) puff.mesh.visible = false;
    }
}

// ============================================================================
// CHARACTER ANIMATION CONTROLLER (BOUNCY ANIME WALK, BREATH, SIT)
// ============================================================================
let walkTime = 0;

function animateCharacter(delta, time, moving) {
    if (!localPlayerMesh) return;
    const ud = localPlayerMesh.userData;

    // Nếu là Custom Model nạp qua GLTF/VRM
    if (ud.isCustomModel) {
        if (ud.mixer) {
            ud.mixer.update(delta);
        } else if (ud.bones) {
            const b = ud.bones;
            const initHipsY = b.hips?.userData?.initialY !== undefined ? b.hips.userData.initialY : 0.94;

            if (isSitting) {
                // Tư thế ngồi nghỉ ngơi
                if (b.hips) b.hips.position.y = THREE.MathUtils.damp(b.hips.position.y, initHipsY - 0.48, 8, delta);
                if (b.leftLeg) b.leftLeg.rotation.x = THREE.MathUtils.damp(b.leftLeg.rotation.x, 1.45, 8, delta);
                if (b.rightLeg) b.rightLeg.rotation.x = THREE.MathUtils.damp(b.rightLeg.rotation.x, 1.45, 8, delta);
                if (b.leftLowerLeg) b.leftLowerLeg.rotation.x = THREE.MathUtils.damp(b.leftLowerLeg.rotation.x, -1.45, 8, delta);
                if (b.rightLowerLeg) b.rightLowerLeg.rotation.x = THREE.MathUtils.damp(b.rightLowerLeg.rotation.x, -1.45, 8, delta);

                // Hai tay đặt lên đùi thư giãn (hạ cánh tay xuôi theo thân người)
                if (b.leftArm) {
                    b.leftArm.rotation.z = THREE.MathUtils.damp(b.leftArm.rotation.z, 0.85, 8, delta);
                    b.leftArm.rotation.x = THREE.MathUtils.damp(b.leftArm.rotation.x, -0.45, 8, delta);
                }
                if (b.rightArm) {
                    b.rightArm.rotation.z = THREE.MathUtils.damp(b.rightArm.rotation.z, -0.85, 8, delta);
                    b.rightArm.rotation.x = THREE.MathUtils.damp(b.rightArm.rotation.x, -0.45, 8, delta);
                }
                if (b.head) b.head.rotation.x = THREE.MathUtils.damp(b.head.rotation.x, -0.2 + Math.sin(time) * 0.02, 5, delta);
            } else if (moving) {
                walkTime += delta * 9.2;
                const stride = Math.sin(walkTime);
                if (b.hips) b.hips.position.y = THREE.MathUtils.damp(b.hips.position.y, initHipsY + Math.abs(stride) * 0.035, 12, delta);
                if (b.leftLeg) b.leftLeg.rotation.x = THREE.MathUtils.damp(b.leftLeg.rotation.x, stride * 0.48, 14, delta);
                if (b.rightLeg) b.rightLeg.rotation.x = THREE.MathUtils.damp(b.rightLeg.rotation.x, -stride * 0.48, 14, delta);
                if (b.leftLowerLeg) b.leftLowerLeg.rotation.x = THREE.MathUtils.damp(b.leftLowerLeg.rotation.x, Math.max(0, -stride * 0.42), 14, delta);
                if (b.rightLowerLeg) b.rightLowerLeg.rotation.x = THREE.MathUtils.damp(b.rightLowerLeg.rotation.x, Math.max(0, stride * 0.42), 14, delta);

                if (b.leftArm) {
                    b.leftArm.rotation.z = THREE.MathUtils.damp(b.leftArm.rotation.z, 1.22, 10, delta);
                    b.leftArm.rotation.x = THREE.MathUtils.damp(b.leftArm.rotation.x, -stride * 0.32, 12, delta);
                    b.leftArm.rotation.y = THREE.MathUtils.damp(b.leftArm.rotation.y, 0.08, 10, delta);
                }
                if (b.rightArm) {
                    b.rightArm.rotation.z = THREE.MathUtils.damp(b.rightArm.rotation.z, -1.22, 10, delta);
                    b.rightArm.rotation.x = THREE.MathUtils.damp(b.rightArm.rotation.x, stride * 0.32, 12, delta);
                    b.rightArm.rotation.y = THREE.MathUtils.damp(b.rightArm.rotation.y, -0.08, 10, delta);
                }
                if (b.spine) {
                    b.spine.rotation.z = THREE.MathUtils.damp(b.spine.rotation.z, Math.sin(walkTime) * 0.025, 10, delta);
                }
                if (b.head) {
                    b.head.rotation.y = THREE.MathUtils.damp(b.head.rotation.y, Math.sin(time * 1.5) * 0.035, 8, delta);
                    b.head.rotation.x = THREE.MathUtils.damp(b.head.rotation.x, Math.cos(walkTime * 2) * 0.018, 8, delta);
                }
            } else {
                // Đứng yên thở nhẹ nhàng, tay buông xuôi tự nhiên bên hông
                if (b.hips) b.hips.position.y = THREE.MathUtils.damp(b.hips.position.y, initHipsY + Math.sin(time * 2.2) * 0.012, 6, delta);
                if (b.leftLeg) b.leftLeg.rotation.x = THREE.MathUtils.damp(b.leftLeg.rotation.x, 0, 8, delta);
                if (b.rightLeg) b.rightLeg.rotation.x = THREE.MathUtils.damp(b.rightLeg.rotation.x, 0, 8, delta);
                if (b.leftLowerLeg) b.leftLowerLeg.rotation.x = THREE.MathUtils.damp(b.leftLowerLeg.rotation.x, 0, 8, delta);
                if (b.rightLowerLeg) b.rightLowerLeg.rotation.x = THREE.MathUtils.damp(b.rightLowerLeg.rotation.x, 0, 8, delta);

                // Tay hạ xuống dọc thân người, thở nhẹ
                if (b.leftArm) {
                    b.leftArm.rotation.z = THREE.MathUtils.damp(b.leftArm.rotation.z, 1.32 + Math.sin(time * 2) * 0.015, 6, delta);
                    b.leftArm.rotation.x = THREE.MathUtils.damp(b.leftArm.rotation.x, 0.06 + Math.sin(time * 1.4) * 0.015, 6, delta);
                    b.leftArm.rotation.y = 0.08;
                }
                if (b.rightArm) {
                    b.rightArm.rotation.z = THREE.MathUtils.damp(b.rightArm.rotation.z, -1.32 - Math.sin(time * 2) * 0.015, 6, delta);
                    b.rightArm.rotation.x = THREE.MathUtils.damp(b.rightArm.rotation.x, 0.06 - Math.sin(time * 1.4) * 0.015, 6, delta);
                    b.rightArm.rotation.y = -0.08;
                }
                if (b.head) {
                    b.head.rotation.y = Math.sin(time * 0.8) * 0.07;
                    b.head.rotation.x = Math.sin(time * 1.2) * 0.02;
                }
            }
        } else if (ud.model) {
            if (isSitting) {
                ud.model.position.y = THREE.MathUtils.damp(ud.model.position.y, -0.4, 8, delta);
            } else if (moving) {
                walkTime += delta * 9.2;
                ud.model.position.y = THREE.MathUtils.damp(ud.model.position.y, Math.abs(Math.sin(walkTime)) * 0.035, 10, delta);
                ud.model.rotation.z = THREE.MathUtils.damp(ud.model.rotation.z, Math.cos(walkTime) * 0.018, 8, delta);
            } else {
                ud.model.position.y = THREE.MathUtils.damp(ud.model.position.y, Math.sin(time * 2.2) * 0.012, 6, delta);
                ud.model.rotation.z = THREE.MathUtils.damp(ud.model.rotation.z, 0, 6, delta);
            }
        }

        if (moving) {
            const footPos = localPlayerMesh.position.clone();
            footPos.y = terrainHeight(localPos.x, localPos.z) + 0.07;
            emitFootstepDust(footPos);
        }

        localPlayerMesh.position.set(
            localPos.x,
            terrainHeight(localPos.x, localPos.z),
            localPos.z
        );
        return;
    }

    const { arms, legs, bodyRig, headRig, ahogeRig, scarfTail, twinTails } = ud;

    // =============================
    // TƯ THẾ NGỒI NGHỈ NGẮM CẢNH (SIT)
    // =============================
    if (isSitting) {
        // Hạ người xuống mặt cỏ
        bodyRig.position.y = THREE.MathUtils.damp(bodyRig.position.y, 0.48, 8, delta);
        legs[0].rotation.x = THREE.MathUtils.damp(legs[0].rotation.x, -Math.PI / 2.2, 8, delta);
        legs[1].rotation.x = THREE.MathUtils.damp(legs[1].rotation.x, -Math.PI / 2.2, 8, delta);
        legs[0].position.z = THREE.MathUtils.damp(legs[0].position.z, 0.28, 8, delta);
        legs[1].position.z = THREE.MathUtils.damp(legs[1].position.z, 0.28, 8, delta);

        // Hai tay đặt lên đùi thư giãn
        arms[0].rotation.x = THREE.MathUtils.damp(arms[0].rotation.x, -0.65, 8, delta);
        arms[1].rotation.x = THREE.MathUtils.damp(arms[1].rotation.x, -0.65, 8, delta);
        arms[0].rotation.z = THREE.MathUtils.damp(arms[0].rotation.z, 0.35, 8, delta);
        arms[1].rotation.z = THREE.MathUtils.damp(arms[1].rotation.z, -0.35, 8, delta);

        // Đầu ngước nhẹ ngắm mây trời
        headRig.rotation.x = THREE.MathUtils.damp(headRig.rotation.x, -0.16 + Math.sin(time * 1.2) * 0.03, 5, delta);
        headRig.rotation.y = THREE.MathUtils.damp(headRig.rotation.y, Math.sin(time * 0.6) * 0.12, 4, delta);

        if (ahogeRig) ahogeRig.rotation.z = Math.sin(time * 2.2) * 0.12;

        localPlayerMesh.position.set(
            localPos.x,
            terrainHeight(localPos.x, localPos.z) + 0.28,
            localPos.z
        );
        return;
    }

    // =============================
    // ĐI BỘ / CHẠY NHẢY DỄ THƯƠNG (BOUNCY ANIME WALK)
    // =============================
    const previousStep = Math.floor(walkTime / Math.PI);

    if (moving) {
        walkTime += delta * 9.2;
        const stride = Math.sin(walkTime);

        legs.forEach((leg, index) => {
            leg.position.z = THREE.MathUtils.damp(leg.position.z, 0, 12, delta);
            leg.rotation.x = THREE.MathUtils.damp(leg.rotation.x, stride * 0.56 * (index === 0 ? 1 : -1), 14, delta);
        });

        arms.forEach((arm, index) => {
            arm.rotation.x = THREE.MathUtils.damp(arm.rotation.x, stride * 0.42 * (index === 0 ? -1 : 1), 12, delta);
            arm.rotation.z = THREE.MathUtils.damp(
                arm.rotation.z,
                (index === 0 ? -1 : 1) * (0.1 + Math.max(0, stride * (index === 0 ? 1 : -1)) * 0.12),
                10,
                delta
            );
        });

        bodyRig.position.y = THREE.MathUtils.damp(bodyRig.position.y, 1.05 + Math.abs(stride) * 0.055, 12, delta);
        bodyRig.rotation.z = THREE.MathUtils.damp(bodyRig.rotation.z, Math.cos(walkTime) * 0.03, 10, delta);
        headRig.rotation.x = THREE.MathUtils.damp(headRig.rotation.x, Math.sin(walkTime) * 0.025, 8, delta);
        headRig.rotation.y = THREE.MathUtils.damp(headRig.rotation.y, Math.sin(time * 1.2) * 0.035, 8, delta);

        // Cọng tóc ngố và khăn quàng đung đưa theo bước chạy
        if (ahogeRig) ahogeRig.rotation.z = 0.6 + Math.sin(walkTime * 2) * 0.22;
        if (scarfTail) scarfTail.rotation.x = 0.35 + Math.abs(stride) * 0.45;
        if (twinTails) twinTails.forEach((t, i) => { t.rotation.x = 0.2 + Math.sin(walkTime) * 0.2 * (i === 0 ? 1 : -1); });

        const currentStep = Math.floor(walkTime / Math.PI);
        if (currentStep !== previousStep) {
            const foot = legs[currentStep % 2];
            const footPos = localPlayerMesh.localToWorld(new THREE.Vector3(foot.position.x, -0.62, 0.18));
            footPos.y = terrainHeight(localPos.x, localPos.z) + 0.07;
            emitFootstepDust(footPos);
        }
    } else {
        // =============================
        // ĐỨNG YÊN THỞ NHẸ (IDLE BREATH)
        // =============================
        bodyRig.position.y = THREE.MathUtils.damp(bodyRig.position.y, 1.05 + Math.sin(time * 2.2) * 0.02, 8, delta);
        bodyRig.rotation.z = THREE.MathUtils.damp(bodyRig.rotation.z, 0, 7, delta);

        legs.forEach(leg => {
            leg.position.z = THREE.MathUtils.damp(leg.position.z, 0, 8, delta);
            leg.rotation.x = THREE.MathUtils.damp(leg.rotation.x, 0, 9, delta);
        });

        arms.forEach((arm, index) => {
            arm.rotation.x = THREE.MathUtils.damp(arm.rotation.x, Math.sin(time * 1.3 + index) * 0.04, 7, delta);
            arm.rotation.z = THREE.MathUtils.damp(arm.rotation.z, index === 0 ? -0.08 : 0.08, 7, delta);
        });

        headRig.rotation.x = THREE.MathUtils.damp(headRig.rotation.x, Math.sin(time * 1.2) * 0.03, 6, delta);
        headRig.rotation.y = THREE.MathUtils.damp(headRig.rotation.y, Math.sin(time * 0.7) * 0.08, 5, delta);

        if (ahogeRig) ahogeRig.rotation.z = THREE.MathUtils.damp(ahogeRig.rotation.z, 0.6 + Math.sin(time * 3) * 0.08, 6, delta);
        if (scarfTail) scarfTail.rotation.x = THREE.MathUtils.damp(scarfTail.rotation.x, 0.35 + Math.sin(time * 2) * 0.08, 6, delta);
    }

    // Động tác vẫy tay chào (Wave Gesture)
    if (ud.gestureTime > 0) {
        ud.gestureTime = Math.max(0, ud.gestureTime - delta);
        const wave = Math.sin((1.35 - ud.gestureTime) * 16) * 0.18;
        arms[1].rotation.z = THREE.MathUtils.damp(arms[1].rotation.z, 1.45 + wave, 12, delta);
        arms[1].rotation.x = THREE.MathUtils.damp(arms[1].rotation.x, -0.85 + wave, 12, delta);
        headRig.rotation.z = THREE.MathUtils.damp(headRig.rotation.z, -0.1, 8, delta);
    }

    localPlayerMesh.position.set(
        localPos.x,
        terrainHeight(localPos.x, localPos.z) + CHARACTER_FOOT_OFFSET + Math.sin(time * (moving ? 14 : 2.2)) * (moving ? 0.025 : 0.009),
        localPos.z
    );
}

// ============================================================================
// HỆ THỐNG ÂM THANH PROCEDURAL (WEB AUDIO API — 0MB DOWNLOAD, CHẠY OFFLINE)
// ============================================================================
class RelaxingAudioManager {
    constructor() {
        this.ctx = null;
        this.isPlaying = false;
        this.windNode = null;
        this.musicTimer = null;
        this.birdTimer = null;
        this.pentatonicScale = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25]; // C, D, E, G, A, C (Âm hưởng thư giãn)
    }

    init() {
        if (this.ctx) return;
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();
    }

    toggle() {
        this.init();
        if (this.ctx.state === "suspended") this.ctx.resume();

        if (this.isPlaying) {
            this.stop();
            return false;
        } else {
            this.start();
            return true;
        }
    }

    start() {
        this.isPlaying = true;
        this.startWind();
        this.startHarpChimes();
        this.startBirdSong();
    }

    stop() {
        this.isPlaying = false;
        if (this.windNode) {
            try { this.windNode.stop(); } catch (e) {}
            this.windNode = null;
        }
        clearTimeout(this.musicTimer);
        clearTimeout(this.birdTimer);
    }

    // Tiếng gió vi vu nhẹ nhàng
    startWind() {
        if (!this.ctx) return;
        const bufferSize = this.ctx.sampleRate * 2;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        noise.loop = true;

        const filter = this.ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(320, this.ctx.currentTime);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.04, this.ctx.currentTime);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);
        noise.start();
        this.windNode = noise;
    }

    // Những nốt đàn Harp / Lofi nhẹ nhàng
    playHarpNote(freq) {
        if (!this.ctx || !this.isPlaying) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

        gain.gain.setValueAtTime(0.001, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.09, this.ctx.currentTime + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 2.8);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 3.0);
    }

    startHarpChimes() {
        const loop = () => {
            if (!this.isPlaying) return;
            const note = this.pentatonicScale[Math.floor(Math.random() * this.pentatonicScale.length)];
            this.playHarpNote(note);
            this.musicTimer = setTimeout(loop, 3500 + Math.random() * 4500);
        };
        loop();
    }

    // Tiếng chim hót sớm mai
    startBirdSong() {
        const loop = () => {
            if (!this.isPlaying) return;
            if (currentTimeMode === "day" && Math.random() > 0.3) {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = "sine";
                const now = this.ctx.currentTime;
                osc.frequency.setValueAtTime(2200, now);
                osc.frequency.exponentialRampToValueAtTime(3200, now + 0.12);
                osc.frequency.exponentialRampToValueAtTime(2600, now + 0.22);

                gain.gain.setValueAtTime(0.02, now);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
                osc.connect(gain);
                gain.connect(this.ctx.destination);
                osc.start(now);
                osc.stop(now + 0.3);
            }
            this.birdTimer = setTimeout(loop, 6000 + Math.random() * 8000);
        };
        loop();
    }
}
const audioManager = new RelaxingAudioManager();

// ============================================================================
// HỖ TRỢ NẠP MODEL ANIME 3D NGOÀI (.GLB / .VRM / .GLTF)
// ============================================================================
const gltfLoader = new THREE.GLTFLoader();

function findHumanoidBones(model) {
    const bones = {};
    model.traverse(node => {
        if (!node.isBone && node.type !== "Bone") return;
        const name = node.name.toLowerCase();
        if (!bones.hips && (name.includes("hips") || name.includes("pelvis") || name.includes("bip_c_hips"))) bones.hips = node;
        if (!bones.leftLeg && (name.includes("leftupperleg") || name.includes("upperleg.l") || name.includes("thigh.l") || name.includes("bip_l_upperleg"))) bones.leftLeg = node;
        if (!bones.rightLeg && (name.includes("rightupperleg") || name.includes("upperleg.r") || name.includes("thigh.r") || name.includes("bip_r_upperleg"))) bones.rightLeg = node;
        if (!bones.leftLowerLeg && (name.includes("leftlowerleg") || name.includes("lowerleg.l") || name.includes("calf.l") || name.includes("bip_l_lowerleg"))) bones.leftLowerLeg = node;
        if (!bones.rightLowerLeg && (name.includes("rightlowerleg") || name.includes("lowerleg.r") || name.includes("calf.r") || name.includes("bip_r_lowerleg"))) bones.rightLowerLeg = node;
        if (!bones.leftArm && (name.includes("leftupperarm") || name.includes("upperarm.l") || name.includes("arm.l") || name.includes("bip_l_upperarm"))) bones.leftArm = node;
        if (!bones.rightArm && (name.includes("rightupperarm") || name.includes("upperarm.r") || name.includes("arm.r") || name.includes("bip_r_upperarm"))) bones.rightArm = node;
        if (!bones.leftLowerArm && (name.includes("leftlowerarm") || name.includes("lowerarm.l") || name.includes("forearm.l") || name.includes("bip_l_lowerarm"))) bones.leftLowerArm = node;
        if (!bones.rightLowerArm && (name.includes("rightlowerarm") || name.includes("lowerarm.r") || name.includes("forearm.r") || name.includes("bip_r_lowerarm"))) bones.rightLowerArm = node;
        if (!bones.head && (name.includes("head") || name.includes("bip_c_head"))) bones.head = node;
        if (!bones.spine && (name.includes("spine") || name.includes("bip_c_spine"))) bones.spine = node;
    });
    return bones;
}

function setupCustomModel(model, gltf, hideScreen = false) {
    // Đặt chân chạm đất chính xác (VRM avatar được thiết kế chuẩn tại y = 0)
    model.position.set(0, 0, 0);

    // Chuẩn hóa chiều cao (~2.4m trong thế giới game)
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    let scale = 1.45;
    if (Number.isFinite(size.y) && size.y > 0.5) {
        scale = 2.45 / size.y;
    }
    model.scale.setScalar(scale);

    // Bật bóng đổ, 2 mặt cho tóc anime và màu sắc chuẩn sRGB
    model.traverse(child => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            if (child.material) {
                child.material.side = THREE.DoubleSide;
                child.material.roughness = 0.82;
                if (child.material.map) {
                    child.material.map.encoding = THREE.sRGBEncoding;
                }
            }
        }
    });

    const bones = findHumanoidBones(model);
    if (bones.hips) {
        bones.hips.userData.initialY = bones.hips.position.y;
    }

    const group = new THREE.Group();
    const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(0.55, 24),
        new THREE.MeshBasicMaterial({ color: 0x1f362e, transparent: true, opacity: 0.28, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.015;
    group.add(shadow, model);

    let mixer = null;
    if (gltf.animations && gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(model);
        const action = mixer.clipAction(gltf.animations[0]);
        action.play();
    }

    group.userData = {
        model,
        bones,
        mixer,
        isCustomModel: true,
        shadow
    };

    const spawnY = terrainHeight(localPos.x, localPos.z);
    group.position.set(localPos.x, spawnY, localPos.z);

    if (localPlayerMesh) scene.remove(localPlayerMesh);
    localPlayerMesh = group;
    scene.add(group);

    showToast("✨ Đã nạp thành công nhân vật Anime 3D!");
    if (hideScreen) {
        document.getElementById("creator-screen")?.classList.add("hidden");
        gameStarted = true;
    }
}

function loadCustomModelFromFile(file) {
    showToast("⏳ Đang đọc và nạp nhân vật Anime 3D...");
    const reader = new FileReader();
    reader.onload = (event) => {
        const arrayBuffer = event.target.result;
        gltfLoader.parse(arrayBuffer, "", (gltf) => {
            setupCustomModel(gltf.scene, gltf, true);
        }, (err) => {
            console.error("Lỗi parse GLTF/VRM:", err);
            showToast("❌ Không thể nạp file 3D này. Hãy thử kiểm tra lại định dạng file!");
        });
    };
    reader.readAsArrayBuffer(file);
}

function loadModelFromUrl(url, hideScreen = false) {
    gltfLoader.load(url, (gltf) => {
        setupCustomModel(gltf.scene, gltf, hideScreen);
        showToast("✨ Đã nạp nhân vật Anime từ thư mục assets!");
    }, undefined, (err) => {
        console.log("Chưa có file nhân vật trong assets, dùng nhân vật mặc định.");
    });
}

function checkAutoLoadCharacter() {
    fetch("./assets/character.vrm", { method: "HEAD" })
        .then(res => {
            if (res.ok) loadModelFromUrl("./assets/character.vrm");
            else {
                fetch("./assets/character.glb", { method: "HEAD" })
                    .then(res2 => { if (res2.ok) loadModelFromUrl("./assets/character.glb"); })
                    .catch(() => {});
            }
        })
        .catch(() => {});
}

// Hỗ trợ Kéo & Thả (Drag & Drop) trực tiếp file .vrm / .glb vào cửa sổ game
window.addEventListener("dragover", event => event.preventDefault());
window.addEventListener("drop", event => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file && (file.name.endsWith(".vrm") || file.name.endsWith(".glb") || file.name.endsWith(".gltf"))) {
        loadCustomModelFromFile(file);
    }
});

// ============================================================================
// CHẾ ĐỘ CHỤP ẢNH / NGẮM CẢNH (SCENIC PHOTO MODE)
// ============================================================================
function togglePhotoMode(enter) {
    if (enter === undefined) enter = !isPhotoMode;
    isPhotoMode = enter;

    const uiLayer = document.getElementById("ui-layer");
    const photoHUD = document.getElementById("photo-mode-overlay");
    const touchControls = document.getElementById("touch-controls");
    const touchInteract = document.getElementById("touch-interact");

    if (isPhotoMode) {
        uiLayer.style.display = "none";
        photoHUD.classList.remove("hidden");
        if (touchControls) touchControls.style.display = "none";
        if (touchInteract) touchInteract.style.display = "none";
        showToast("📸 Đã bật Chế độ Ngắm cảnh & Chụp ảnh. Nhấn phím P hoặc Esc để thoát.");
    } else {
        uiLayer.style.display = "flex";
        photoHUD.classList.add("hidden");
        showToast("Đã trở lại chế độ phiêu lưu.");
    }
}

function takeScreenshot() {
    renderer.render(scene, camera);
    const dataURL = renderer.domElement.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = `RungNho_Anime_${Date.now()}.png`;
    link.href = dataURL;
    link.click();
    showToast("📸 Đã chụp và tải ảnh phong cảnh tuyệt đẹp về máy!");
}

// ============================================================================
// DISCOVERY MARKERS & SCENIC SPOTS
// ============================================================================
const discoveries = [];
let nearestDiscovery = null;
let collected = new Set(readStorage(DISCOVERY_KEY, []));

function makeMarker(id, x, z, title, description) {
    const group = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 1.8, 6), makeAnimeMaterial(0x795b43, { flatShading: true }));
    stem.position.y = 0.9;
    group.add(stem);

    const glow = new THREE.Mesh(
        new THREE.SphereGeometry(0.48, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0xffe289, transparent: true, opacity: 0.75 })
    );
    glow.position.y = 2.0;
    group.add(glow);

    const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.72, 0.035, 5, 24),
        new THREE.MeshBasicMaterial({ color: 0xfff0b8, transparent: true, opacity: 0.7 })
    );
    ring.position.y = 2.0;
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    group.add(new THREE.PointLight(0xffc777, 0.8, 6));
    group.position.set(x, terrainHeight(x, z), z);
    scene.add(group);
    discoveries.push({ id, x, z, title, description, mesh: group, glow, ring, baseY: group.position.y, found: false });
}

// ============================================================================
// IMPORTED FOREST ASSETS
// ============================================================================
const forestTreeLocations = [];

function loadForestPack(url) {
    return new Promise((resolve, reject) => {
        gltfLoader.load(url, gltf => resolve(gltf.scene), undefined, reject);
    });
}

function createForestPrototypes(root, matcher, heightRange) {
    const sources = [];
    root.updateMatrixWorld(true);
    root.traverse(object => {
        if (object.isMesh || !matcher.test(object.name)) return;
        let hasMesh = false;
        object.traverse(child => {
            if (child.isMesh) hasMesh = true;
        });
        if (hasMesh) sources.push(object);
    });

    return sources.map(source => {
        const parts = [];
        source.traverse(object => {
            if (!object.isMesh) return;
            const geometry = object.geometry.clone();
            geometry.applyMatrix4(object.matrixWorld);
            parts.push({ geometry, material: object.material });
        });

        const bounds = new THREE.Box3();
        parts.forEach(part => {
            part.geometry.computeBoundingBox();
            bounds.union(part.geometry.boundingBox);
        });
        const size = bounds.getSize(new THREE.Vector3());
        if (bounds.isEmpty() || size.y < 0.001) {
            parts.forEach(part => part.geometry.dispose());
            return null;
        }

        const center = bounds.getCenter(new THREE.Vector3());
        const scale = THREE.MathUtils.lerp(heightRange[0], heightRange[1], Math.random()) / size.y;
        parts.forEach(part => {
            part.geometry.translate(-center.x, -bounds.min.y, -center.z);
            part.geometry.scale(scale, scale, scale);
            part.geometry.computeBoundingSphere();
        });
        return {
            parts,
            collisionRadius: Math.max(0.65, Math.min(1.8, Math.max(size.x, size.z) * scale * 0.16))
        };
    }).filter(Boolean);
}

function createForestInstances(prototypes, placements, castShadow = false) {
    const placementGroups = prototypes.map(() => []);
    placements.forEach(placement => {
        const index = Number.isInteger(placement.prototypeIndex)
            ? placement.prototypeIndex
            : Math.floor(Math.random() * prototypes.length);
        placementGroups[index].push(placement);
    });

    placementGroups.forEach((group, prototypeIndex) => {
        if (!group.length) return;
        const prototype = prototypes[prototypeIndex];
        prototype.parts.forEach(part => {
            const instances = new THREE.InstancedMesh(part.geometry, part.material, group.length);
            instances.castShadow = castShadow;
            instances.receiveShadow = false;
            instances.frustumCulled = false;
            const dummy = new THREE.Object3D();
            group.forEach((placement, index) => {
                dummy.position.set(placement.x, terrainHeight(placement.x, placement.z), placement.z);
                dummy.rotation.set(0, placement.rotation, 0);
                dummy.scale.setScalar(placement.scale);
                dummy.updateMatrix();
                instances.setMatrixAt(index, dummy.matrix);
            });
            instances.instanceMatrix.needsUpdate = true;
            scene.add(instances);
        });
    });
}

function scatterForestAssets(prototypes, count, options = {}) {
    if (!prototypes.length || count <= 0) return [];
    const placements = [];
    const minRadius = options.minRadius ?? 20;
    const maxRadius = options.maxRadius ?? 80;
    const clusterRadius = options.clusterRadius || 0;
    const minSpacing = options.minSpacing || 0;
    const spacingCells = new Map();
    let attempts = 0;

    while (placements.length < count && attempts < count * 30) {
        attempts++;
        let x;
        let z;
        if (clusterRadius && forestTreeLocations.length && Math.random() < 0.78) {
            const tree = forestTreeLocations[Math.floor(Math.random() * forestTreeLocations.length)];
            const angle = Math.random() * Math.PI * 2;
            const distance = clusterRadius * (0.45 + Math.random() * 0.8);
            x = tree.x + Math.cos(angle) * distance;
            z = tree.z + Math.sin(angle) * distance;
        } else if (options.bounds) {
            x = (Math.random() * 2 - 1) * options.bounds;
            z = (Math.random() * 2 - 1) * options.bounds;
        } else {
            const radius = Math.sqrt(minRadius * minRadius + Math.random() * (maxRadius * maxRadius - minRadius * minRadius));
            const angle = Math.random() * Math.PI * 2;
            x = Math.cos(angle) * radius;
            z = Math.sin(angle) * radius;
        }

        if (Math.hypot(x - 5, z - 5) < (options.campClearance || 14)
            || isNearPath(x, z, options.pathClearance ?? 3)
            || isNearPond(x, z, options.pondClearance ?? 2)) continue;
        if (minSpacing) {
            const cellX = Math.floor(x / minSpacing);
            const cellZ = Math.floor(z / minSpacing);
            let tooClose = false;
            for (let dx = -1; dx <= 1 && !tooClose; dx++) {
                for (let dz = -1; dz <= 1 && !tooClose; dz++) {
                    for (const item of spacingCells.get(`${cellX + dx},${cellZ + dz}`) || []) {
                        if (Math.hypot(item.x - x, item.z - z) < minSpacing) {
                            tooClose = true;
                            break;
                        }
                    }
                }
            }
            if (tooClose) continue;
        }

        const placement = {
            x,
            z,
            rotation: Math.random() * Math.PI * 2,
            scale: options.scaleMin + Math.random() * (options.scaleMax - options.scaleMin)
        };
        placements.push(placement);
        if (minSpacing) {
            const cellKey = `${Math.floor(x / minSpacing)},${Math.floor(z / minSpacing)}`;
            if (!spacingCells.has(cellKey)) spacingCells.set(cellKey, []);
            spacingCells.get(cellKey).push(placement);
        }
    }

    createForestInstances(prototypes, placements, options.castShadow);
    return placements;
}

function scatterForestGrid(prototypes, options = {}) {
    if (!prototypes.length) return [];
    const placements = [];
    const spacing = options.spacing || 10.5;
    const jitter = options.jitter || 2.6;
    const bounds = options.bounds || 98;

    for (let x = -bounds + spacing / 2; x <= bounds - spacing / 2; x += spacing) {
        for (let z = -bounds + spacing / 2; z <= bounds - spacing / 2; z += spacing) {
            const placementX = x + (Math.random() * 2 - 1) * jitter;
            const placementZ = z + (Math.random() * 2 - 1) * jitter;
            if (Math.hypot(placementX - 5, placementZ - 5) < 16
                || isNearPath(placementX, placementZ, 2.8)
                || isNearPond(placementX, placementZ, 1.8)) continue;

            const prototypeIndex = Math.floor(Math.random() * prototypes.length);
            const scale = options.scaleMin + Math.random() * (options.scaleMax - options.scaleMin);
            placements.push({
                x: placementX,
                z: placementZ,
                rotation: Math.random() * Math.PI * 2,
                scale,
                prototypeIndex,
                collisionRadius: prototypes[prototypeIndex].collisionRadius * scale
            });
        }
    }

    createForestInstances(prototypes, placements, options.castShadow);
    return placements;
}

function canMoveToForestPosition(x, z) {
    return forestTreeLocations.every(tree => (
        Math.hypot(x - tree.x, z - tree.z) >= tree.collisionRadius + PLAYER_COLLISION_RADIUS
    ));
}

async function buildImportedForest() {
    const packFiles = [
        "./assets/forest_mine__simple_low_poly_pack.glb",
        "./assets/low_poly_stylized_tree_pack.glb",
        "./assets/low_poly_trees__nature_pack_70_props.glb"
    ];
    const loadedPacks = await Promise.allSettled(packFiles.map(loadForestPack));
    const packScenes = loadedPacks.map((result, index) => {
        if (result.status === "fulfilled") return { index, root: result.value };
        console.error(`Không thể tải model cảnh rừng ${packFiles[index]}:`, result.reason);
        return null;
    }).filter(Boolean);

    const treePrototypes = [];
    const bushPrototypes = [];
    const mushroomPrototypes = [];
    const stonePrototypes = [];
    const stumpPrototypes = [];
    const barkPrototypes = [];
    const flowerPrototypes = [];
    const grassPrototypes = [];
    let minePrototypes = [];

    packScenes.forEach(({ root, index }) => {
        treePrototypes.push(...createForestPrototypes(
            root,
            index === 0 ? /^Tree_[123]$/i : index === 1 ? /^\d{2}-tree-root$/i : /^Tree_0[1-5](?:\.\d+)?$/i,
            [16, 22]
        ));
        if (index === 0) {
            mushroomPrototypes.push(...createForestPrototypes(root, /^Mushroom(?:\.\d+)?$/i, [0.35, 0.75]));
            stonePrototypes.push(...createForestPrototypes(root, /^(?:Big|Small)_stone(?:\.\d+)?$/i, [0.7, 2]));
            stumpPrototypes.push(...createForestPrototypes(root, /^(?:Small|Medium)_stump(?:\.\d+)?$/i, [0.7, 1.5]));
            barkPrototypes.push(...createForestPrototypes(root, /^Bark(?:\.\d+)?$/i, [1.4, 2.4]));
            minePrototypes = createForestPrototypes(root, /^Mine$/i, [8, 11]);
        } else if (index === 2) {
            bushPrototypes.push(...createForestPrototypes(root, /^Bush_0[12](?:\.\d+)?$/i, [1.3, 2.2]));
            mushroomPrototypes.push(...createForestPrototypes(root, /^Mushroom_0[123](?:[._]\d+)?$/i, [0.4, 0.85]));
            stonePrototypes.push(...createForestPrototypes(root, /^Stone_0[1-4]$/i, [0.7, 1.8]));
            flowerPrototypes.push(...createForestPrototypes(root, /^Flover_0[1-3](?:\.\d+)?$/i, [0.45, 0.9]));
            grassPrototypes.push(...createForestPrototypes(root, /^Grass_0[12](?:\.\d+)?$/i, [0.4, 0.85]));
        }
    });

    if (!treePrototypes.length) {
        throw new Error("Không tìm thấy model cây trong các file GLB.");
    }

    forestTreeLocations.push(...scatterForestGrid(treePrototypes, {
        bounds: 98, spacing: 10.5, jitter: 2.6,
        scaleMin: 0.82, scaleMax: 1.2, castShadow: true
    }));
    scatterForestAssets(bushPrototypes, 42, {
        minRadius: 21, maxRadius: 76, clusterRadius: 8,
        scaleMin: 0.75, scaleMax: 1.2
    });
    scatterForestAssets(mushroomPrototypes, 115, {
        minRadius: 19, maxRadius: 77, clusterRadius: 5.2,
        minSpacing: 1.25, scaleMin: 0.75, scaleMax: 1.45
    });
    scatterForestAssets(stonePrototypes, 48, {
        minRadius: 20, maxRadius: 78, clusterRadius: 7,
        minSpacing: 2, scaleMin: 0.65, scaleMax: 1.2
    });
    scatterForestAssets(stumpPrototypes, 28, {
        minRadius: 20, maxRadius: 75, clusterRadius: 6,
        minSpacing: 2.8, scaleMin: 0.75, scaleMax: 1.25
    });
    scatterForestAssets(barkPrototypes, 16, {
        minRadius: 20, maxRadius: 75, clusterRadius: 6,
        minSpacing: 3, scaleMin: 0.7, scaleMax: 1.15
    });
    scatterForestAssets(flowerPrototypes, 70, {
        minRadius: 13, maxRadius: 70, clusterRadius: 4.5,
        minSpacing: 1.2, scaleMin: 0.7, scaleMax: 1.2
    });
    scatterForestAssets(grassPrototypes, 55, {
        minRadius: 15, maxRadius: 75, clusterRadius: 3.5,
        minSpacing: 1.1, scaleMin: 0.7, scaleMax: 1.3
    });
    if (minePrototypes.length) {
        createForestInstances(minePrototypes, [{ x: 54, z: -52, rotation: -0.5, scale: 1 }], true);
    }
}

function createProceduralForestFallback() {
    for (let i = 0; i < 220; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 19 + Math.random() * 70;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        if (Math.hypot(x - 5, z - 5) < 13 || isNearPath(x, z, 4.2) || isNearPond(x, z, 2.5)) continue;
        const broadleaf = Math.random() > 0.22;
        createTree(x, z, broadleaf, broadleaf && Math.random() > 0.32);
    }
}

// ============================================================================
// KHỞI TẠO THẾ GIỚI (WORLD BUILDING)
// ============================================================================
const campfire = createFire();
dressCampfire();
createSky();

const groundGeometry = new THREE.PlaneGeometry(210, 210, 130, 130);
groundGeometry.rotateX(-Math.PI / 2);
const groundPositions = groundGeometry.attributes.position;
const groundColors = [];
const meadowPalette = [new THREE.Color(0x4a9b40), new THREE.Color(0x6eb750), new THREE.Color(0x8dd35a)];

for (let i = 0; i < groundPositions.count; i++) {
    const x = groundPositions.getX(i);
    const z = groundPositions.getZ(i);
    const height = terrainHeight(x, z);
    groundPositions.setY(i, height);
    const variation = THREE.MathUtils.clamp(
        0.48 + Math.sin(x * 0.16) * Math.cos(z * 0.14) * 0.22 + height * 0.07,
        0,
        0.98
    );
    const color = meadowPalette[0].clone().lerp(meadowPalette[1], variation);
    if (variation > 0.66) color.lerp(meadowPalette[2], (variation - 0.66) * 0.8);
    const distance = Math.hypot(x, z);
    if (distance < 12) color.lerp(new THREE.Color(0xb99a5c), 0.15);
    groundColors.push(color.r, color.g, color.b);
}
groundGeometry.setAttribute("color", new THREE.Float32BufferAttribute(groundColors, 3));
groundGeometry.computeVertexNormals();

const ground = new THREE.Mesh(
    groundGeometry,
    new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1 })
);
ground.receiveShadow = true;
scene.add(ground);

campPathRoutes.forEach(createTrail);
createDistantHills();

buildImportedForest().catch(error => {
    console.error("Không thể dựng rừng từ các file GLB:", error);
    if (!forestTreeLocations.length) createProceduralForestFallback();
});

// Cây Đại Cổ Thụ Hoa Anh Đào tại trung tâm ngắm cảnh
const grandSakura = createTree(14, 18, true, true);
grandSakura.scale.setScalar(2.2);

createGroundCover();
createWildflowers();
createSakuraPetals();
createFireflies();

createTent(8, -5, 0xa85d50);
createTent(-8, -5, 0x647d67);
for (const [x, z] of [[-2.8, -2.6], [2.8, -2.6], [-2.8, 2.6], [2.8, 2.6], [7, 0], [-7, 0]]) createLantern(x, z);

pondSites.forEach(createPond);
createPier(-19, -15, 0.55);

// 4 Địa điểm ngắm cảnh thơ mộng
makeMarker("pond", -16, -14, "Bến Hồ Gương", "Mặt hồ soi bóng mây trời. Hãy ngồi xuống ngắm đàn cá và hoa súng nở rộ nhé.");
makeMarker("wildflowers", 16, -17, "Thung Lũng Hoa Dại", "Cánh đồng hoa dại rực rỡ đung đưa trong gió. Đom đóm thường tụ về đây khi hoàng hôn buông xuống.");
makeMarker("lookout", 25, 27, "Đài Vọng Cảnh", "Đỉnh đồi cao nhất đón trọn ánh bình minh và biển sao đêm. Hãy ước một điều ước.");
makeMarker("sakura", 14, 18, "Cổ Thụ Anh Đào", "Tán hoa anh đào nghìn năm rực rỡ, những cánh hoa hồng bay lượn ngập tràn trong gió.");

// ============================================================================
// CONTROLS & EVENT LISTENERS
// ============================================================================
const keys = { w: false, a: false, s: false, d: false, ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };
const keyMap = { w: "w", W: "w", a: "a", A: "a", s: "s", S: "s", d: "d", D: "d", ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight" };

function releaseKeys() {
    Object.keys(keys).forEach(key => { keys[key] = false; });
}

window.addEventListener("keydown", event => {
    if (document.activeElement === document.getElementById("chat-input")) return;

    const key = keyMap[event.key];
    if (key) {
        keys[key] = true;
        if (isSitting) {
            isSitting = false;
            showToast("Đã đứng dậy tiếp tục hành trình.");
        }
    }
    if (event.key === "e" || event.key === "E") interact();
    if (event.key === "k" || event.key === "K") {
        isSitting = !isSitting;
        showToast(isSitting ? "🧘 Đang ngồi nghỉ ngơi ngắm cảnh..." : "Đã đứng dậy.");
    }
    if (event.key === "p" || event.key === "P") togglePhotoMode();
    if (event.key === "Escape" && isPhotoMode) togglePhotoMode(false);
});

window.addEventListener("keyup", event => {
    const key = keyMap[event.key];
    if (key) keys[key] = false;
});

// UI Buttons Event Listeners
document.getElementById("btn-camera")?.addEventListener("click", () => togglePhotoMode(true));
document.getElementById("btn-snap-photo")?.addEventListener("click", takeScreenshot);
document.getElementById("btn-exit-photo")?.addEventListener("click", () => togglePhotoMode(false));

document.getElementById("btn-time")?.addEventListener("click", () => {
    const nextMode = currentTimeMode === "day" ? "sunset" : currentTimeMode === "sunset" ? "night" : "day";
    setEnvironmentTime(nextMode);
    showToast(`Đã chuyển sang ${nextMode === "sunset" ? "Hoàng Hôn 🌅" : nextMode === "night" ? "Đêm Sao 🌌" : "Ban Ngày ☀️"}`);
});

document.getElementById("btn-photo-time")?.addEventListener("click", () => {
    const nextMode = currentTimeMode === "day" ? "sunset" : currentTimeMode === "sunset" ? "night" : "day";
    setEnvironmentTime(nextMode);
});

document.getElementById("btn-sit")?.addEventListener("click", () => {
    isSitting = !isSitting;
    showToast(isSitting ? "🧘 Đang ngồi nghỉ ngơi ngắm cảnh..." : "Đã đứng dậy.");
});
document.getElementById("btn-photo-sit")?.addEventListener("click", () => {
    isSitting = !isSitting;
});

document.getElementById("btn-music")?.addEventListener("click", () => {
    const active = audioManager.toggle();
    document.getElementById("music-icon").textContent = active ? "🔊" : "🎵";
    showToast(active ? "🔊 Đã bật âm thanh thiên nhiên & lofi harp chữa lành." : "Đã tắt âm thanh.");
});

document.getElementById("btn-rain")?.addEventListener("click", () => {
    isRaining = !isRaining;
    rainSystem.visible = isRaining;
    showToast(isRaining ? "🌧️ Cơn mưa rào mùa xuân đã bắt đầu..." : "🌤️ Mưa đã tạnh, trời lại sáng.");
});

document.getElementById("btn-tarot")?.addEventListener("click", () => {
    const modal = document.getElementById("tarot-modal");
    const text = document.getElementById("tarot-text");
    text.textContent = `"${tarotMessages[Math.floor(Math.random() * tarotMessages.length)]}"`;
    modal.classList.add("active");
});

window.closeTarot = function() {
    document.getElementById("tarot-modal").classList.remove("active");
};

// File Uploader cho Custom Model 3D
const fileInput = document.getElementById("model-file-input");
document.getElementById("btn-custom-model")?.addEventListener("click", () => fileInput?.click());
fileInput?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) loadCustomModelFromFile(file);
});

// Toast notification
let toastTimer;
function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 3800);
}

function updateProgress() {
    const found = collected.size;
    const fill = document.getElementById("progress-fill");
    const label = document.getElementById("progress-label");
    const objText = document.getElementById("objective-text");
    if (fill) fill.style.width = `${Math.min(found / discoveries.length, 1) * 100}%`;
    if (label) label.textContent = `${found} / ${discoveries.length} điểm ngắm cảnh`;
    if (objText) {
        objText.textContent = found === discoveries.length
            ? "Bạn đã ghé thăm tất cả danh lam thắng cảnh trong thung lũng! Giờ hãy ngồi ngắm hoàng hôn và nghe nhạc nhé."
            : "Khám phá các đốm sáng ven hồ, thung lũng hoa và cổ thụ anh đào.";
    }
}

function interact() {
    if (!nearestDiscovery) return;
    if (localPlayerMesh && localPlayerMesh.userData) localPlayerMesh.userData.gestureTime = 1.35;
    collected.add(nearestDiscovery.id);
    saveStorage(DISCOVERY_KEY, [...collected]);
    nearestDiscovery.found = true;
    nearestDiscovery.glow.material.color.setHex(0xa6c989);
    nearestDiscovery.ring.material.color.setHex(0xa6c989);
    updateProgress();
    showToast(`✨ Kỷ niệm: ${nearestDiscovery.title}. ${nearestDiscovery.description}`);
}

function updateDiscoveries(time) {
    nearestDiscovery = null;
    let nearestDistance = Infinity;
    for (const discovery of discoveries) {
        const distance = Math.hypot(localPos.x - discovery.x, localPos.z - discovery.z);
        discovery.mesh.position.y = discovery.baseY + (collected.has(discovery.id) ? 0 : Math.sin(time * 2 + discovery.x) * 0.12);
        discovery.glow.scale.setScalar(collected.has(discovery.id) ? 0.8 : 0.9 + Math.sin(time * 3 + discovery.z) * 0.13);
        discovery.ring.rotation.z = time * 0.24;
        discovery.found = collected.has(discovery.id);
        if (!discovery.found && distance < nearestDistance) {
            nearestDistance = distance;
            nearestDiscovery = discovery;
        }
    }
    const prompt = document.getElementById("interaction-prompt");
    if (!nearestDiscovery || nearestDistance > 3.6) {
        nearestDiscovery = null;
        prompt?.classList.remove("visible");
        return;
    }
    if (prompt) {
        prompt.innerHTML = `Nhấn <kbd>E</kbd> để ngắm cảnh <strong>${nearestDiscovery.title}</strong>`;
        prompt.classList.add("visible");
    }
}

// ============================================================================
// CHARACTER CREATOR FORM & PREVIEW
// ============================================================================
const creator = document.getElementById("creator-screen");
const nameInput = document.getElementById("character-name");
if (nameInput) nameInput.value = character.name;
let selectedStyle = character.style;
let selectedColor = character.color;
let selectedGender = character.gender || defaultCharacter.gender;

const colorButtons = [...document.querySelectorAll(".color-choice")];
const styleButtons = [...document.querySelectorAll(".style-choice")];
const genderButtons = [...document.querySelectorAll(".gender-choice")];

function updatePreview() {
    const previewColor = /^#[\da-f]{6}$/i.test(selectedColor) ? selectedColor : defaultCharacter.color;
    const previewEl = document.getElementById("character-preview");
    if (!previewEl) return;

    previewEl.innerHTML = `
        <svg viewBox="0 0 320 410" role="img" aria-label="Nhân vật anime ${selectedGender === "female" ? "nữ" : "nam"}">
            <defs>
                <linearGradient id="coat" x1="0" x2="1" y1="0" y2="1">
                    <stop offset="0" stop-color="${previewColor}"/><stop offset="1" stop-color="#fff5d8" stop-opacity=".6"/>
                </linearGradient>
                <linearGradient id="skin" x1="0" x2=".8" y1="0" y2="1">
                    <stop stop-color="#fff0e6"/><stop offset="1" stop-color="#f5cbb8"/>
                </linearGradient>
            </defs>
            <ellipse cx="160" cy="388" rx="74" ry="13" fill="#345c4b" opacity=".18"/>
            <path d="M117 268h87l24 91H94z" fill="url(#coat)" stroke="#fad02c" stroke-width="4" stroke-linejoin="round"/>
            <path d="M129 225h62v64h-62z" fill="url(#skin)"/>
            <path d="M94 165c-5-48 18-88 66-88 51 0 72 40 66 88-5 55-29 86-66 86-37 0-61-31-66-86z" fill="url(#skin)"/>
            <ellipse cx="120" cy="205" rx="14" ry="10" fill="#ff9999" opacity=".4"/>
            <ellipse cx="200" cy="205" rx="14" ry="10" fill="#ff9999" opacity=".4"/>
            <ellipse cx="138" cy="180" rx="14" ry="20" fill="#fff"/>
            <ellipse cx="182" cy="180" rx="14" ry="20" fill="#fff"/>
            <ellipse cx="140" cy="182" rx="9" ry="14" fill="#6c79bd"/>
            <ellipse cx="180" cy="182" rx="9" ry="14" fill="#6c79bd"/>
            <circle cx="142" cy="176" r="4.5" fill="#fff"/>
            <circle cx="182" cy="176" r="4.5" fill="#fff"/>
            <circle cx="137" cy="188" r="2.2" fill="#fff"/>
            <circle cx="177" cy="188" r="2.2" fill="#fff"/>
            <path d="M124 160q16-12 30 0" fill="none" stroke="#4a3642" stroke-width="6" stroke-linecap="round"/>
            <path d="M166 160q16-12 30 0" fill="none" stroke="#4a3642" stroke-width="6" stroke-linecap="round"/>
            <path d="M154 212q6 7 12 0" fill="none" stroke="#a75462" stroke-width="3" stroke-linecap="round"/>
            <path d="M152 72q16-30 2 35" fill="none" stroke="#5a3848" stroke-width="8" stroke-linecap="round"/>
        </svg>`;
}

updatePreview();
colorButtons.forEach(button => button.addEventListener("click", () => {
    selectedColor = button.dataset.color;
    colorButtons.forEach(choice => choice.classList.toggle("selected", choice === button));
    updatePreview();
}));
styleButtons.forEach(button => button.addEventListener("click", () => {
    selectedStyle = button.dataset.style;
    styleButtons.forEach(choice => choice.classList.toggle("selected", choice === button));
    updatePreview();
}));
genderButtons.forEach(button => button.addEventListener("click", () => {
    selectedGender = button.dataset.gender;
    genderButtons.forEach(choice => choice.classList.toggle("selected", choice === button));
    updatePreview();
}));

document.getElementById("creator-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    const nextCharacter = {
        name: nameInput?.value.trim().slice(0, 18) || defaultCharacter.name,
        color: selectedColor,
        style: selectedStyle,
        gender: selectedGender
    };
    const submitButton = event.currentTarget.querySelector('button[type="submit"]');
    const creatorError = document.getElementById("creator-error");
    const originalButtonText = submitButton.innerHTML;
    submitButton.disabled = true;
    submitButton.textContent = "Đang triệu hồi nhân vật Anime...";
    if (creatorError) creatorError.hidden = true;

    character = nextCharacter;
    saveStorage(PROFILE_KEY, character);
    localPlayerColor = new THREE.Color(character.color).getHex();

    const finishLaunch = (charName) => {
        const groundY = terrainHeight(localPos.x, localPos.z);
        controls.target.set(localPos.x, groundY + 1.2, localPos.z);
        camera.position.set(localPos.x, groundY + 3.8, localPos.z + 10.0);
        controls.update();

        const playerLabel = document.getElementById("player-label");
        if (playerLabel) playerLabel.textContent = `${charName} · WASD: Di chuyển · E: Tương tác · K: Ngồi · P: Chụp ảnh`;

        gameStarted = true;
        releaseKeys();
        submitButton.disabled = false;
        submitButton.innerHTML = originalButtonText;
        creator.classList.add("hidden");
        updateProgress();
        setTimeout(() => showToast(`Chào mừng ${charName}! Hãy dạo bước ngắm hoa anh đào và thung lũng nhé.`), 500);
    };

    // Kiểm tra và ưu tiên nạp file VRM (su.vrm cho nữ hoặc shu.vrm cho nam)
    const vrmFile = nextCharacter.gender === "female" ? "./assets/su.vrm" : "./assets/shu.vrm";
    gltfLoader.load(vrmFile, (gltf) => {
        setupCustomModel(gltf.scene, gltf, true);
        finishLaunch(nextCharacter.name);
    }, undefined, (err) => {
        // Fallback sang nhân vật thủ công nếu không tìm thấy file
        try {
            const newPlayerMesh = createCharacter(nextCharacter);
            if (localPlayerMesh) {
                scene.remove(localPlayerMesh);
                localPlayerMesh.userData.mixer?.stopAllAction();
            }
            localPlayerMesh = newPlayerMesh;
            finishLaunch(nextCharacter.name);
        } catch (e) {
            console.error("Lỗi tạo nhân vật:", e);
            if (creatorError) {
                creatorError.textContent = "Không thể tạo nhân vật. Hãy thử lại nhé.";
                creatorError.hidden = false;
            }
            submitButton.disabled = false;
            submitButton.innerHTML = originalButtonText;
        }
    });
});

// Nhật ký lữ hành (Chat / Journal)
const chatMessagesEl = document.getElementById("chat-messages");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatTitleEl = document.getElementById("chat-title");
const chatModeLabelEl = document.getElementById("chat-mode-label");
let chatMessages = readStorage(CHAT_KEY, []);
const remotePlayers = new Map();
const serverChatMessages = new Map();
let multiplayerStatus = "unconfigured";
let onlinePlayerCount = 0;
let multiplayerChatActive = false;

function renderChat() {
    if (!chatMessagesEl) return;
    chatMessagesEl.replaceChildren();
    for (const message of chatMessages.slice(-25)) {
        const bubble = document.createElement("div");
        bubble.className = "msg-bubble";
        const author = document.createElement("div");
        author.className = "msg-author";
        author.textContent = message.name;
        const text = document.createElement("div");
        text.textContent = message.text;
        bubble.append(author, text);
        chatMessagesEl.appendChild(bubble);
    }
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}
renderChat();

function updateMultiplayerStatus(status, detail) {
    multiplayerStatus = status;
    const statusEl = document.getElementById("multiplayer-status");
    const statusTextEl = document.getElementById("multiplayer-status-text");
    if (statusEl) statusEl.dataset.state = status;

    const statusMessages = {
        unconfigured: "Chơi một mình · Firebase chưa cấu hình",
        connecting: "Đang kết nối khu trại...",
        connected: `Đang online · ${onlinePlayerCount} người trong khu trại`,
        disconnected: "Mất kết nối · đang chờ Firebase...",
        error: "Kết nối Firebase gặp lỗi"
    };
    if (statusTextEl) statusTextEl.textContent = statusMessages[status] || statusMessages.error;
    if (status === "error" && detail) console.error("Firebase multiplayer:", detail);

    multiplayerChatActive = status === "connected";
    if (chatTitleEl) chatTitleEl.textContent = multiplayerChatActive ? "💬 Trò chuyện khu trại" : "📖 Nhật Ký Lữ Hành";
    if (chatModeLabelEl) chatModeLabelEl.textContent = multiplayerChatActive ? "Mọi người đều thấy" : "Lưu trên máy này";
    if (chatInput) chatInput.placeholder = multiplayerChatActive ? "Nhắn mọi người trong trại..." : "Ghi lại cảm xúc hôm nay...";

    if (multiplayerChatActive) {
        chatMessages = [...serverChatMessages.values()]
            .sort((a, b) => a.time - b.time)
            .slice(-25);
    } else {
        chatMessages = readStorage(CHAT_KEY, []);
    }
    renderChat();
}

function createNameTag(name) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 112;
    const context = canvas.getContext("2d");
    context.fillStyle = "rgba(20, 33, 33, 0.82)";
    context.beginPath();
    context.roundRect(12, 12, 488, 88, 30);
    context.fill();
    context.font = "bold 48px Quicksand, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#fff4df";
    context.fillText(name.slice(0, 18), 256, 57, 450);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    tag.scale.set(2.4, 0.53, 1);
    tag.position.y = 3.1;
    tag.renderOrder = 20;
    return tag;
}

function removeRemotePlayer(id) {
    const remote = remotePlayers.get(id);
    if (!remote) return;
    scene.remove(remote.mesh);
    remote.mesh.traverse(node => {
        node.geometry?.dispose();
        if (Array.isArray(node.material)) node.material.forEach(material => material.dispose());
        else node.material?.dispose();
    });
    scene.remove(remote.nameTag);
    remote.nameTag.material.map?.dispose();
    remote.nameTag.material.dispose();
    remotePlayers.delete(id);
}

function updateRemotePlayers(players, currentUserId) {
    onlinePlayerCount = Object.keys(players).length;
    if (multiplayerStatus === "connected") {
        const statusTextEl = document.getElementById("multiplayer-status-text");
        if (statusTextEl) statusTextEl.textContent = `Đang online · ${onlinePlayerCount} người trong khu trại`;
    }

    const presentIds = new Set();
    for (const [id, data] of Object.entries(players)) {
        if (id === currentUserId || !data || typeof data !== "object") continue;
        const name = typeof data.name === "string" ? data.name.trim().slice(0, 18) : "";
        const color = typeof data.color === "string" && /^#[\da-f]{6}$/i.test(data.color) ? data.color : defaultCharacter.color;
        const style = ["hiker", "spirit", "stargazer"].includes(data.style) ? data.style : "hiker";
        const gender = data.gender === "male" ? "male" : "female";
        const x = Number.isFinite(data.x) ? THREE.MathUtils.clamp(data.x, -88, 88) : 5;
        const z = Number.isFinite(data.z) ? THREE.MathUtils.clamp(data.z, -88, 88) : 5;
        const rotation = Number.isFinite(data.rotation) ? data.rotation : 0;
        const sitting = data.sitting === true;
        if (!name) continue;

        presentIds.add(id);
        const appearance = `${name}|${color}|${style}|${gender}`;
        let remote = remotePlayers.get(id);
        if (remote && remote.appearance !== appearance) {
            removeRemotePlayer(id);
            remote = undefined;
        }
        if (!remote) {
            const mesh = createCharacter({ name, color, style, gender });
            mesh.position.set(x, terrainHeight(x, z) + CHARACTER_FOOT_OFFSET, z);
            mesh.rotation.y = rotation;
            const nameTag = createNameTag(name);
            scene.add(nameTag);
            remote = {
                mesh,
                nameTag,
                appearance,
                target: { x, z, rotation, sitting }
            };
            remotePlayers.set(id, remote);
        } else {
            remote.target = { x, z, rotation, sitting };
        }
    }

    for (const id of remotePlayers.keys()) {
        if (!presentIds.has(id)) removeRemotePlayer(id);
    }
}

function addServerChatMessage(message) {
    if (!message || typeof message.id !== "string" || typeof message.name !== "string" || typeof message.text !== "string") return;
    const time = Number.isFinite(message.createdAt) ? message.createdAt : Date.now();
    serverChatMessages.set(message.id, {
        id: message.id,
        name: message.name.slice(0, 18),
        text: message.text.slice(0, 180),
        time
    });
    const oldestFirst = [...serverChatMessages.entries()].sort((a, b) => a[1].time - b[1].time);
    while (oldestFirst.length > 25) {
        serverChatMessages.delete(oldestFirst.shift()[0]);
    }
    if (multiplayerChatActive) {
        chatMessages = [...serverChatMessages.values()].sort((a, b) => a.time - b.time).slice(-25);
        renderChat();
    }
}

const multiplayer = createFirebaseMultiplayer({
    onPlayersChanged: updateRemotePlayers,
    onChatMessage: addServerChatMessage,
    onStatus: updateMultiplayerStatus
});
void multiplayer.start();

chatForm?.addEventListener("submit", event => {
    event.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    if (multiplayerChatActive) {
        void multiplayer.sendChat({ name: character.name, text })
            .then(() => { chatInput.value = ""; })
            .catch(error => {
                console.error("Không gửi được tin nhắn khu trại:", error);
                showToast("Không gửi được tin nhắn. Hãy kiểm tra kết nối Firebase nhé.");
            });
        return;
    }
    chatMessages.push({ name: character.name, text, time: Date.now() });
    chatMessages = chatMessages.slice(-25);
    saveStorage(CHAT_KEY, chatMessages);
    renderChat();
    chatInput.value = "";
});

setInterval(() => {
    if (!gameStarted || !localPlayerMesh) return;
    multiplayer.updatePlayer({
        name: character.name,
        color: character.color,
        style: character.style,
        gender: character.gender || defaultCharacter.gender,
        x: localPos.x,
        z: localPos.z,
        rotation: localPlayerMesh.rotation.y,
        sitting: isSitting
    });
}, 100);

// Mobile Touch Controls
[...document.querySelectorAll("#touch-controls button")].forEach(button => {
    const key = button.dataset.key;
    const release = event => { event.preventDefault(); keys[key] = false; };
    button.addEventListener("pointerdown", event => {
        event.preventDefault();
        keys[key] = true;
        if (isSitting) isSitting = false;
        button.setPointerCapture(event.pointerId);
    });
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", release);
});
document.getElementById("touch-interact")?.addEventListener("pointerdown", event => {
    event.preventDefault();
    interact();
});

// ============================================================================
// MAIN ANIMATION LOOP
// ============================================================================
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.05);
    const time = clock.getElapsedTime();
    let moving = false;

    // Di chuyển nhân vật
    if (localPlayerMesh && gameStarted && document.activeElement !== chatInput) {
        const inputX = Number(keys.d || keys.ArrowRight) - Number(keys.a || keys.ArrowLeft);
        const inputForward = Number(keys.w || keys.ArrowUp) - Number(keys.s || keys.ArrowDown);
        const cameraForward = new THREE.Vector3(
            controls.target.x - camera.position.x,
            0,
            controls.target.z - camera.position.z
        );
        if (cameraForward.lengthSq() < 0.0001) cameraForward.set(0, 0, -1);
        cameraForward.normalize();
        const cameraRight = new THREE.Vector3(-cameraForward.z, 0, cameraForward.x);
        let moveX = cameraRight.x * inputX + cameraForward.x * inputForward;
        let moveZ = cameraRight.z * inputX + cameraForward.z * inputForward;
        const length = Math.hypot(moveX, moveZ);
        if (length > 0 && !isSitting) {
            moving = true;
            moveX /= length;
            moveZ /= length;
            const speed = 5.6 * delta;
            const nextX = THREE.MathUtils.clamp(localPos.x + moveX * speed, -88, 88);
            const nextZ = THREE.MathUtils.clamp(localPos.z + moveZ * speed, -88, 88);
            if (canMoveToForestPosition(nextX, nextZ)) {
                localPos.x = nextX;
                localPos.z = nextZ;
            } else {
                const canMoveX = canMoveToForestPosition(nextX, localPos.z);
                const canMoveZ = canMoveToForestPosition(localPos.x, nextZ);
                if (canMoveX) localPos.x = nextX;
                if (canMoveZ) localPos.z = nextZ;
            }
            const targetRotation = Math.atan2(moveX, moveZ) + PLAYER_MODEL_FACING_OFFSET;
            const angleDelta = THREE.MathUtils.euclideanModulo(
                targetRotation - localPlayerMesh.rotation.y + Math.PI,
                Math.PI * 2
            ) - Math.PI;
            localPlayerMesh.rotation.y += angleDelta * (1 - Math.exp(-12 * delta));
        }

        // Camera bám theo nhân vật mượt mà
        if (!isPhotoMode) {
            const groundY = terrainHeight(localPos.x, localPos.z);
            const targetX = THREE.MathUtils.damp(controls.target.x, localPos.x, 7, delta);
            const targetY = THREE.MathUtils.damp(controls.target.y, groundY + 1.2, 7, delta);
            const targetZ = THREE.MathUtils.damp(controls.target.z, localPos.z, 7, delta);
            const deltaX = targetX - controls.target.x;
            const deltaY = targetY - controls.target.y;
            const deltaZ = targetZ - controls.target.z;
            camera.position.x += deltaX;
            camera.position.y += deltaY;
            camera.position.z += deltaZ;
            controls.target.x = targetX;
            controls.target.y = targetY;
            controls.target.z = targetZ;
        }
    }

    for (const remote of remotePlayers.values()) {
        const { mesh, nameTag, target } = remote;
        mesh.position.x = THREE.MathUtils.damp(mesh.position.x, target.x, 10, delta);
        mesh.position.z = THREE.MathUtils.damp(mesh.position.z, target.z, 10, delta);
        const targetY = terrainHeight(mesh.position.x, mesh.position.z) + (target.sitting ? 0.28 : CHARACTER_FOOT_OFFSET);
        mesh.position.y = THREE.MathUtils.damp(mesh.position.y, targetY, 10, delta);
        const angleDelta = THREE.MathUtils.euclideanModulo(target.rotation - mesh.rotation.y + Math.PI, Math.PI * 2) - Math.PI;
        mesh.rotation.y += angleDelta * (1 - Math.exp(-10 * delta));
        nameTag.position.set(mesh.position.x, mesh.position.y + 2.45, mesh.position.z);
    }

    animateCharacter(delta, time, moving);
    updateFootstepDust(delta);

    // Cánh hoa anh đào rơi trong gió (Sakura Drift)
    if (sakuraMesh) {
        const dummy = new THREE.Object3D();
        for (let i = 0; i < SAKURA_COUNT; i++) {
            const s = sakuraData[i];
            s.y -= s.speedY * delta;
            s.x += Math.sin(time * 0.8 + s.swayPhase) * 1.2 * delta + 0.6 * delta;
            s.z += Math.cos(time * 0.8 + s.swayPhase) * 0.9 * delta;

            if (s.y < terrainHeight(s.x, s.z)) {
                s.y = 28 + Math.random() * 8;
                s.x = localPos.x + (Math.random() - 0.5) * 120;
                s.z = localPos.z + (Math.random() - 0.5) * 120;
            }

            dummy.position.set(s.x, s.y, s.z);
            dummy.scale.setScalar(s.scale);
            dummy.rotation.x += s.rotSpeedX * delta;
            dummy.rotation.y += s.rotSpeedY * delta;
            dummy.updateMatrix();
            sakuraMesh.setMatrixAt(i, dummy.matrix);
        }
        sakuraMesh.instanceMatrix.needsUpdate = true;
    }

    // Đom đóm bay lượn (Fireflies)
    if (fireflyMesh) {
        const dummy = new THREE.Object3D();
        const activeTime = currentTimeMode === "night" || currentTimeMode === "sunset";
        fireflyMesh.visible = activeTime;

        if (activeTime) {
            for (let i = 0; i < FIREFLY_COUNT; i++) {
                const f = fireflyData[i];
                const angle = time * f.freq + f.phase;
                const fx = f.originX + Math.cos(angle) * f.radius;
                const fz = f.originZ + Math.sin(angle) * f.radius;
                const fy = f.baseY + Math.sin(time * 2.2 + f.phase) * 0.65;
                dummy.position.set(fx, fy, fz);
                dummy.scale.setScalar(0.7 + Math.sin(time * 3 + f.phase) * 0.4);
                dummy.updateMatrix();
                fireflyMesh.setMatrixAt(i, dummy.matrix);
            }
            fireflyMesh.instanceMatrix.needsUpdate = true;
        }
    }

    // Hiệu ứng lửa trại
    for (const particle of fireParticles) {
        particle.mesh.position.y += particle.speed * (isRaining ? 0.7 : 1);
        particle.mesh.rotation.y += 0.04;
        particle.mesh.material.opacity = Math.max(0, 1 - particle.mesh.position.y / particle.maxH);
        if (particle.mesh.position.y > particle.maxH) {
            particle.mesh.position.set((Math.random() - 0.5) * 0.7, 0, (Math.random() - 0.5) * 0.7);
        }
    }
    campfire.flame.scale.y = 0.9 + Math.sin(time * 12) * 0.08;
    campfire.light.intensity = (currentTimeMode === "night" ? 3.4 : 2.2) + Math.sin(time * 9) * 0.35;

    // Gợn sóng hồ nước
    for (const ripple of pondRipples) {
        const pulse = (Math.sin(time * 1.4 + ripple.phase) + 1) / 2;
        ripple.mesh.scale.setScalar(0.7 + pulse * 1.1);
        ripple.mesh.material.opacity = 0.08 + pulse * 0.22;
    }

    // Hạt mưa
    if (isRaining) {
        const positions = rainSystem.geometry.attributes.position.array;
        for (let i = 1; i < positions.length; i += 3) {
            positions[i] -= 18 * delta;
            if (positions[i] < 0) positions[i] = 42;
        }
        rainSystem.geometry.attributes.position.needsUpdate = true;
    }

    // Cây cối và mây trôi
    for (const tree of animatedTrees) tree.rotation.z = Math.sin(time * 0.7 + tree.userData.windOffset) * 0.018;
    for (const cloud of animatedClouds) {
        cloud.position.x += delta * 0.42;
        if (cloud.position.x > 140) cloud.position.x = -140;
    }

    if (gameStarted) updateDiscoveries(time);

    controls.update();
    renderer.render(scene, camera);
}

// Cửa sổ thay đổi kích thước
window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Khởi chạy
updateProgress();
checkAutoLoadCharacter();
document.getElementById("loading-screen").style.opacity = "0";
setTimeout(() => { document.getElementById("loading-screen").style.display = "none"; }, 650);
animate();
