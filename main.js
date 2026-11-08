import { createFirebaseMultiplayer } from "./firebase-multiplayer.js";

// ============================================================================
// RỪNG NHỎ — KHU TRẠI CHỮA LÀNH (3D ANIME EXPLORATION & SIGHTSEEING)
// Phong cách: Cel-Shading, Anime Genshin 1/10, Thư Giãn, Chụp Ảnh & Ngắm Cảnh
// ============================================================================

const PROFILE_KEY = "rung-nho-profile-v1";
const CHAT_KEY = "rung-nho-chat-v1";
const DISCOVERY_KEY = "rung-nho-discoveries-v1";
const CAMP_KEY = "rung-nho-camp-v1";
const CHARACTER_FOOT_OFFSET = 0.69;
const PLAYER_COLLISION_RADIUS = 0.48;
const PLAYER_MODEL_FACING_OFFSET = Math.PI;
const WORLD_HALF_SIZE = 150;
const WORLD_PLAYER_LIMIT = WORLD_HALF_SIZE - 10;
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

const camera = new THREE.PerspectiveCamera(56, window.innerWidth / window.innerHeight, 0.1, 850);
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
        cloud.position.set(
            (Math.random() - 0.5) * WORLD_HALF_SIZE * 3.2,
            32 + Math.random() * 20,
            (Math.random() - 0.5) * WORLD_HALF_SIZE * 2.8
        );
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
const riverHighlights = [];
const pondSites = [
    { x: -24, z: -18, radius: 8.5 },
    { x: 34, z: -35, radius: 5.2 }
];
const riverRoutes = [
    [[-145, 19], [-120, 18], [-98, 12], [-78, 16], [-59, 12], [-44, 7], [-34, 2], [-31, -7], [-42, -15], [-64, -18], [-90, -14], [-120, -20], [-145, -17]],
    [[145, -68], [120, -62], [96, -58], [78, -49], [62, -52], [48, -44], [41, -32], [50, -22], [72, -18], [96, -25], [120, -32], [145, -28]]
];
const campPathRoutes = [
    [[0, 2], [-3, -3], [-9, -8], [-16, -14]],
    [[1, 0], [5, -5], [12, -9], [16, -17]],
    [[0, -1], [6, 4], [16, 13], [25, 27]]
];

function baseTerrainHeight(x, z) {
    const distance = Math.hypot(x, z);
    const clearing = THREE.MathUtils.smoothstep(distance, 13, 23);
    return (Math.sin(x * 0.065 + Math.cos(z * 0.07)) * 1.75
        + Math.cos(z * 0.058 - x * 0.025) * 1.4
        + Math.sin((x + z) * 0.11) * 0.55) * clearing;
}

function nearestRiverPoint(x, z) {
    let nearest = { distance: Infinity, x: 0, z: 0 };
    for (const route of riverRoutes) {
        for (let i = 0; i < route.length - 1; i++) {
            const [ax, az] = route[i];
            const [bx, bz] = route[i + 1];
            const dx = bx - ax;
            const dz = bz - az;
            const t = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
            const nearestX = ax + dx * t;
            const nearestZ = az + dz * t;
            const distance = Math.hypot(x - nearestX, z - nearestZ);
            if (distance < nearest.distance) nearest = { distance, x: nearestX, z: nearestZ };
        }
    }
    return nearest;
}

function terrainHeight(x, z) {
    let height = baseTerrainHeight(x, z);
    const pondBasin = pondSites.reduce((deepest, pond) => {
        const d = Math.hypot(x - pond.x, z - pond.z);
        return Math.max(deepest, 1 - THREE.MathUtils.smoothstep(d, pond.radius * 0.8, pond.radius * 2));
    }, 0);
    height = THREE.MathUtils.lerp(height, -0.5, pondBasin);
    const riverPoint = nearestRiverPoint(x, z);
    const riverBasin = 1 - THREE.MathUtils.smoothstep(riverPoint.distance, 2.4, 7.2);
    const riverBed = baseTerrainHeight(riverPoint.x, riverPoint.z) - 0.62;
    height = THREE.MathUtils.lerp(height, riverBed, riverBasin);
    return height;
}

function isNearPond(x, z, margin = 0) {
    return pondSites.some(pond => Math.hypot(x - pond.x, z - pond.z) < pond.radius + margin);
}

function isNearRiver(x, z, margin = 0) {
    return nearestRiverPoint(x, z).distance < 2.4 + margin;
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

function createRiver(route, routeIndex) {
    const curve = new THREE.CatmullRomCurve3(route.map(([x, z]) => new THREE.Vector3(x, 0, z)));
    const segments = 180;
    const waterPositions = [];
    const waterColors = [];
    const waterIndices = [];
    const shallowColor = new THREE.Color(0x82d6ce);
    const deepColor = new THREE.Color(0x3b9eb6);
    const bankPositions = [[], []];
    const bankColors = [[], []];
    const bankIndices = [[], []];

    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const point = curve.getPointAt(t);
        const tangent = curve.getTangentAt(t);
        const halfWidth = 2.2 + Math.sin(t * Math.PI * 8 + routeIndex) * 0.2;
        const normalX = -tangent.z;
        const normalZ = tangent.x;
        const waterY = baseTerrainHeight(point.x, point.z) - 0.2;
        for (let side = -1; side <= 1; side++) {
            waterPositions.push(
                point.x + normalX * halfWidth * side,
                waterY + Math.abs(side) * 0.006,
                point.z + normalZ * halfWidth * side
            );
            const color = side === 0 ? deepColor : shallowColor;
            waterColors.push(color.r, color.g, color.b);
        }

        for (let bankSide = 0; bankSide < 2; bankSide++) {
            const direction = bankSide === 0 ? -1 : 1;
            const innerX = point.x + normalX * halfWidth * direction;
            const innerZ = point.z + normalZ * halfWidth * direction;
            const outerX = point.x + normalX * (halfWidth + 1.55) * direction;
            const outerZ = point.z + normalZ * (halfWidth + 1.55) * direction;
            bankPositions[bankSide].push(
                innerX, waterY - 0.045, innerZ,
                outerX, terrainHeight(outerX, outerZ) + 0.035, outerZ
            );
            bankColors[bankSide].push(0.74, 0.68, 0.48, 0.43, 0.62, 0.36);
        }
    }

    for (let i = 0; i < segments; i++) {
        const row = i * 3;
        const next = row + 3;
        waterIndices.push(row, row + 1, next, row + 1, next + 1, next);
        waterIndices.push(row + 1, row + 2, next + 1, row + 2, next + 2, next + 1);
        for (let bankSide = 0; bankSide < 2; bankSide++) {
            const bankRow = i * 2;
            const bankNext = bankRow + 2;
            bankIndices[bankSide].push(bankRow, bankRow + 1, bankNext, bankRow + 1, bankNext + 1, bankNext);
        }
    }

    const waterGeometry = new THREE.BufferGeometry();
    waterGeometry.setAttribute("position", new THREE.Float32BufferAttribute(waterPositions, 3));
    waterGeometry.setAttribute("color", new THREE.Float32BufferAttribute(waterColors, 3));
    waterGeometry.setIndex(waterIndices);
    waterGeometry.computeVertexNormals();
    const water = new THREE.Mesh(waterGeometry, new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.22,
        metalness: 0.08,
        transparent: true,
        opacity: 0.94,
        depthWrite: false,
        side: THREE.DoubleSide
    }));
    water.receiveShadow = true;
    scene.add(water);

    for (let bankSide = 0; bankSide < 2; bankSide++) {
        const bankGeometry = new THREE.BufferGeometry();
        bankGeometry.setAttribute("position", new THREE.Float32BufferAttribute(bankPositions[bankSide], 3));
        bankGeometry.setAttribute("color", new THREE.Float32BufferAttribute(bankColors[bankSide], 3));
        bankGeometry.setIndex(bankIndices[bankSide]);
        bankGeometry.computeVertexNormals();
        const bank = new THREE.Mesh(bankGeometry, new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 1,
            side: THREE.DoubleSide
        }));
        bank.receiveShadow = true;
        scene.add(bank);
    }

    for (let i = 0; i < 12; i++) {
        const highlight = new THREE.Mesh(
            new THREE.SphereGeometry(0.72, 8, 5),
            new THREE.MeshBasicMaterial({
                color: 0xd4fff1,
                transparent: true,
                opacity: 0.5,
                depthWrite: false
            })
        );
        highlight.scale.set(1, 0.025, 0.12);
        scene.add(highlight);
        riverHighlights.push({
            mesh: highlight,
            curve,
            progress: (i + 0.5) / 12,
            speed: 0.006 + (i % 3) * 0.001
        });
    }

    const riverStoneGeometry = new THREE.DodecahedronGeometry(0.32, 0);
    const riverStoneMaterial = makeAnimeMaterial(0x9ca99a, { flatShading: true });
    for (let i = 0; i < 26; i++) {
        const t = (i + 0.4) / 26;
        const point = curve.getPointAt(t);
        const tangent = curve.getTangentAt(t);
        const side = i % 2 ? -1 : 1;
        const offset = 2.55 + Math.random() * 0.8;
        const x = point.x - tangent.z * offset * side;
        const z = point.z + tangent.x * offset * side;
        const stone = new THREE.Mesh(riverStoneGeometry, riverStoneMaterial);
        stone.position.set(x, terrainHeight(x, z) + 0.12, z);
        stone.rotation.set(Math.random() * 0.3, Math.random() * Math.PI, Math.random() * 0.3);
        stone.scale.set(0.7 + Math.random() * 0.8, 0.65 + Math.random() * 0.5, 0.8 + Math.random() * 0.7);
        stone.castShadow = true;
        scene.add(stone);
    }
}

function createDistantHills() {
    const colors = [0x668eb0, 0x79a4b9, 0x8db6bc];
    for (let i = 0; i < 20; i++) {
        const angle = (i / 20) * Math.PI * 2 + Math.random() * 0.12;
        const radius = WORLD_HALF_SIZE * 1.28 + Math.random() * 25;
        const height = 30 + Math.random() * 30;
        const width = 34 + Math.random() * 22;
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
    while (count < 24000 && attempts < 60000) {
        attempts++;
        const x = (Math.random() - 0.5) * WORLD_HALF_SIZE * 1.67;
        const z = (Math.random() - 0.5) * WORLD_HALF_SIZE * 1.67;
        if (Math.hypot(x, z) < 5.5 || isNearPath(x, z, 1.1) || isNearPond(x, z, 2.2) || isNearRiver(x, z, 1.2)) continue;
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
        const radius = 12 + Math.random() * 88;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        if (isNearPath(x, z, 2.2) || isNearPond(x, z, 1.5) || isNearRiver(x, z, 2.4)) {
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
function createFire(x = 0, z = 0, base = true, fuelUntil = Date.now() + 180000) {
    const group = new THREE.Group();
    const particles = [];
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
        particles.push({ mesh: particle, speed: 0.8 + Math.random() * 0.9, maxH: 1.8 + Math.random() * 1.2 });
    }
    group.position.set(x, terrainHeight(x, z), z);
    scene.add(group);
    const fire = { group, flame, light, x, z, base, fuelUntil };
    particles.forEach(particle => {
        particle.fire = fire;
        fireParticles.push(particle);
    });
    setFireLit(fire, base || fuelUntil > Date.now());
    return fire;
}

function setFireLit(fire, lit) {
    fire.lit = lit;
    fire.flame.visible = lit;
    fire.light.visible = lit;
    fire.light.intensity = lit ? (currentTimeMode === "night" ? 3.4 : 2.2) : 0;
    for (const particle of fireParticles) {
        if (particle.fire === fire) particle.mesh.visible = lit;
    }
}

function addFuelVisual(fire) {
    const log = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.2, 1.25, 6),
        makeAnimeMaterial(0x71472e, { flatShading: true })
    );
    log.rotation.z = Math.PI / 2;
    log.rotation.y = Math.random() * 0.5;
    log.position.set((Math.random() - 0.5) * 0.28, 0.28, (Math.random() - 0.5) * 0.28);
    log.castShadow = true;
    fire.group.add(log);
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
    tree.scale.setScalar(0.65 + Math.random() * 0.58);
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
    return tent;
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
        const x = (Math.random() - 0.5) * WORLD_HALF_SIZE * 1.6;
        const y = 8 + Math.random() * 26;
        const z = (Math.random() - 0.5) * WORLD_HALF_SIZE * 1.6;
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

    if (isPhotoMode) {
        uiLayer.style.display = "none";
        photoHUD.classList.remove("hidden");
        if (touchControls) touchControls.style.display = "none";
        showToast("📸 Đã bật Chế độ Ngắm cảnh & Chụp ảnh. Nhấn phím P hoặc Esc để thoát.");
    } else {
        uiLayer.style.display = "flex";
        photoHUD.classList.add("hidden");
        if (touchControls) touchControls.style.display = "";
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
let nearestForage = null;
let nearestInteractable = null;
let collected = new Set(readStorage(DISCOVERY_KEY, []));
const DAILY_GATHER_GOAL = 4;
const DAILY_VISIT_GOAL = 2;
const forageTypes = {
    flower: { label: "Hoa dại", icon: "🌼", color: 0xff9fca },
    pinecone: { label: "Hạt thông", icon: "🌰", color: 0xb77b4b },
    firefly: { label: "Đom đóm", icon: "✨", color: 0xffe890 },
    wood: { label: "Củi", icon: "🪵", color: 0x9a6842 },
    fish: { label: "Cá tươi", icon: "🐟", color: 0x78b9d1 },
    meat: { label: "Thịt sống", icon: "🥩", color: 0xd87970 }
};
const backpackItems = {
    tent: { label: "Lều cắm trại", icon: "⛺", description: "Dựng lều ở gần nhân vật." },
    wood: { label: "Củi", icon: "🪵", description: "Dùng 3 khúc để nhóm bếp mới; thêm 1 khúc để giữ lửa." },
    fish: { label: "Cá tươi", icon: "🐟", description: "Nướng tại bếp lửa để nhận cá nướng." },
    meat: { label: "Thịt sống", icon: "🥩", description: "Nướng tại bếp lửa để nhận thịt nướng." },
    cookedFish: { label: "Cá nướng", icon: "🍢", description: "Bữa ăn đã sẵn sàng trong ba lô." },
    cookedMeat: { label: "Thịt nướng", icon: "🍖", description: "Bữa ăn đã sẵn sàng trong ba lô." }
};
const defaultSupplies = { tent: 1, wood: 4, fish: 1, meat: 1, cookedFish: 0, cookedMeat: 0 };

function getLocalDateKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function createDailyState(date = getLocalDateKey()) {
    return { date, gathered: 0, visits: 0, claimedGather: false, claimedVisits: false };
}

function loadCampState() {
    const saved = readStorage(CAMP_KEY, {});
    const savedState = saved && typeof saved === "object" ? saved : {};
    const inventory = savedState.inventory && typeof savedState.inventory === "object" ? savedState.inventory : {};
    const daily = savedState.daily && savedState.daily.date === getLocalDateKey() ? savedState.daily : createDailyState();
    const gathered = Number.isFinite(daily.gathered) ? Math.floor(daily.gathered) : 0;
    const visits = Number.isFinite(daily.visits) ? Math.floor(daily.visits) : 0;
    return {
        inventory: {
            ...Object.fromEntries(Object.keys(forageTypes).map(type => [
                type,
                Number.isFinite(inventory[type]) ? Math.max(0, Math.floor(inventory[type])) : 0
            ])),
            ...Object.fromEntries(Object.entries(defaultSupplies).map(([type, count]) => [
                type,
                Number.isFinite(inventory[type]) ? Math.max(0, Math.floor(inventory[type])) : count
            ]))
        },
        leaves: Number.isFinite(savedState.leaves) ? Math.max(0, Math.floor(savedState.leaves)) : 0,
        upgradeLevel: Number.isFinite(savedState.upgradeLevel) ? THREE.MathUtils.clamp(Math.floor(savedState.upgradeLevel), 0, 3) : 0,
        tents: Array.isArray(savedState.tents) ? savedState.tents.filter(site => Number.isFinite(site?.x) && Number.isFinite(site?.z)).slice(-20) : [],
        campfires: Array.isArray(savedState.campfires) ? savedState.campfires.filter(site => Number.isFinite(site?.x) && Number.isFinite(site?.z) && Number.isFinite(site.fuelUntil)).slice(-10) : [],
        cooking: Array.isArray(savedState.cooking) ? savedState.cooking.filter(job =>
            ["fish", "meat"].includes(job?.type) && Number.isFinite(job.readyAt) && Number.isFinite(job.x) && Number.isFinite(job.z)
        ).slice(-10) : [],
        hunger: Number.isFinite(savedState.hunger) ? THREE.MathUtils.clamp(savedState.hunger, 0, 100) : 100,
        daily: {
            ...createDailyState(daily.date),
            gathered: Math.min(DAILY_GATHER_GOAL, Math.max(0, gathered)),
            visits: Math.min(DAILY_VISIT_GOAL, Math.max(0, visits)),
            claimedGather: daily.claimedGather === true,
            claimedVisits: daily.claimedVisits === true
        }
    };
}

let campState = loadCampState();
const campUpgradeRecipes = [
    { name: "Thắp đèn lồng quanh trại", cost: { leaves: 1, flower: 2, pinecone: 1 } },
    { name: "Trồng vườn hoa nhỏ", cost: { leaves: 2, flower: 3, firefly: 2 } },
    { name: "Ươm Cổ Thụ Ước Nguyện", cost: { leaves: 3, pinecone: 4, firefly: 3 } }
];
const forageItems = [];
const campfireSites = [];
const cookingJobs = [];

for (const job of campState.cooking) {
    const cookedType = job.type === "fish" ? "cookedFish" : "cookedMeat";
    if (job.readyAt <= Date.now()) {
        campState.inventory[cookedType] += 1;
    } else {
        cookingJobs.push({ ...job, mesh: null });
    }
}
campState.cooking = cookingJobs.map(({ type, readyAt, x, z }) => ({ type, readyAt, x, z }));
saveStorage(CAMP_KEY, campState);

function saveCampState() {
    saveStorage(CAMP_KEY, campState);
}

function completeDailyQuest(kind) {
    const isGatherQuest = kind === "gathered";
    const progressKey = isGatherQuest ? "gathered" : "visits";
    const claimKey = isGatherQuest ? "claimedGather" : "claimedVisits";
    const goal = isGatherQuest ? DAILY_GATHER_GOAL : DAILY_VISIT_GOAL;
    if (campState.daily[claimKey]) return;

    campState.daily[progressKey] = Math.min(goal, campState.daily[progressKey] + 1);
    let completed = false;
    if (campState.daily[progressKey] === goal) {
        campState.daily[claimKey] = true;
        campState.leaves += 2;
        completed = true;
    }
    saveCampState();
    updateCampUI();
    return completed;
}

function updateCampUI() {
    const inventoryList = document.getElementById("inventory-list");
    const leafCount = document.getElementById("leaf-count");
    const gatherQuest = document.getElementById("daily-gather-quest");
    const visitQuest = document.getElementById("daily-visit-quest");
    const upgradeButton = document.getElementById("camp-upgrade");
    const upgradeCost = document.getElementById("camp-upgrade-cost");
    if (inventoryList) {
        inventoryList.textContent = ["tent", "wood", "fish", "meat"]
            .map(type => `${backpackItems[type].icon} ${campState.inventory[type]}`)
            .join("   ");
    }
    if (leafCount) leafCount.textContent = String(campState.leaves);
    if (gatherQuest) {
        gatherQuest.textContent = `${campState.daily.claimedGather ? "✓" : "○"} Nhặt ${DAILY_GATHER_GOAL} vật phẩm (${campState.daily.gathered}/${DAILY_GATHER_GOAL}) · thưởng 2 lá`;
    }
    if (visitQuest) {
        visitQuest.textContent = `${campState.daily.claimedVisits ? "✓" : "○"} Ghé ${DAILY_VISIT_GOAL} danh lam (${campState.daily.visits}/${DAILY_VISIT_GOAL}) · thưởng 2 lá`;
    }
    if (!upgradeButton || !upgradeCost) return;

    const recipe = campUpgradeRecipes[campState.upgradeLevel];
    if (!recipe) {
        upgradeButton.textContent = "✨ Khu trại đã được trang trí hoàn chỉnh";
        upgradeButton.disabled = true;
        upgradeCost.textContent = "Hãy quay lại mỗi ngày để khám phá thêm.";
        return;
    }

    const requirements = Object.entries(recipe.cost)
        .map(([item, amount]) => item === "leaves"
            ? `${amount} lá`
            : `${amount} ${forageTypes[item].icon}`)
        .join(" · ");
    const hasMaterials = Object.entries(recipe.cost).every(([item, amount]) =>
        item === "leaves" ? campState.leaves >= amount : campState.inventory[item] >= amount
    );
    upgradeButton.textContent = `🛠 ${recipe.name}`;
    upgradeButton.disabled = !hasMaterials;
    upgradeCost.textContent = `Cần: ${requirements}`;
    renderBackpack();
}

function toggleBackpack(open = document.getElementById("backpack-modal")?.hidden) {
    const modal = document.getElementById("backpack-modal");
    if (!modal) return;
    modal.hidden = !open;
    releaseKeys();
    if (open) {
        renderBackpack();
        document.getElementById("btn-close-backpack")?.focus();
    } else {
        document.getElementById("btn-backpack")?.focus();
    }
}

function findNearbyFire(maxDistance = 6, includeUnlit = false) {
    let nearest = null;
    for (const fire of campfireSites) {
        const lit = fire.base || fire.fuelUntil > Date.now();
        if (!lit && !includeUnlit) continue;
        const distance = Math.hypot(localPos.x - fire.x, localPos.z - fire.z);
        if (distance <= maxDistance && (!nearest || distance < nearest.distance)) {
            nearest = { fire, distance };
        }
    }
    return nearest?.fire || null;
}

function getPlacementPosition(distance = 3.8) {
    const heading = (localPlayerMesh?.rotation.y || 0) - PLAYER_MODEL_FACING_OFFSET;
    const offsets = [0, Math.PI / 2, -Math.PI / 2, Math.PI];
    for (const offset of offsets) {
        const angle = heading + offset;
        const x = THREE.MathUtils.clamp(localPos.x + Math.sin(angle) * distance, -WORLD_PLAYER_LIMIT, WORLD_PLAYER_LIMIT);
        const z = THREE.MathUtils.clamp(localPos.z + Math.cos(angle) * distance, -WORLD_PLAYER_LIMIT, WORLD_PLAYER_LIMIT);
        if (!canMoveToForestPosition(x, z)) continue;
        if (campState.tents.some(tent => Math.hypot(tent.x - x, tent.z - z) < 4)) continue;
        if (campfireSites.some(fire => !fire.base && Math.hypot(fire.x - x, fire.z - z) < 4)) continue;
        return { x, z };
    }
    return null;
}

function persistCampfire(fire) {
    const savedFire = campState.campfires.find(site => site.id === fire.id);
    if (savedFire) savedFire.fuelUntil = fire.fuelUntil;
    saveCampState();
}

function updateBackpackLocation() {
    const location = document.getElementById("backpack-location");
    if (!location) return;
    const fire = findNearbyFire();
    const nearbyColdFire = fire || findNearbyFire(6, true);
    location.textContent = fire
        ? "🔥 Đang ở gần bếp lửa · có thể nướng thức ăn."
        : nearbyColdFire
            ? "🪵 Bếp đã tắt · dùng củi để nhóm lửa lại."
            : "🌲 Hãy dựng bếp bằng 3 khúc củi để nướng thức ăn.";
}

function canUseBackpackItem(type) {
    const count = campState.inventory[type] || 0;
    if (count <= 0) return false;
    if (type === "wood") return Boolean(findNearbyFire(6, true)) || count >= 3;
    if (type === "fish" || type === "meat") return Boolean(findNearbyFire());
    if (type === "cookedFish" || type === "cookedMeat") return campState.hunger < 100;
    return type === "tent";
}

function renderBackpack() {
    const list = document.getElementById("backpack-items");
    const modal = document.getElementById("backpack-modal");
    if (!list || !modal || modal.hidden) return;

    list.replaceChildren();
    for (const [type, item] of Object.entries(backpackItems)) {
        const count = campState.inventory[type] || 0;
        const card = document.createElement("article");
        card.className = "backpack-item";
        const info = document.createElement("div");
        info.className = "backpack-item-info";
        const icon = document.createElement("span");
        icon.className = "backpack-item-icon";
        icon.textContent = item.icon;
        const copy = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = `${item.label} · ${count}`;
        const description = document.createElement("p");
        description.textContent = item.description;
        copy.append(title, description);
        info.append(icon, copy);
        const useButton = document.createElement("button");
        useButton.className = "backpack-use";
        useButton.type = "button";
        useButton.dataset.item = type;
        useButton.textContent = type === "cookedFish" || type === "cookedMeat" ? "Ăn" : "Dùng";
        useButton.disabled = !canUseBackpackItem(type);
        card.append(info, useButton);
        list.append(card);
    }
    const hint = document.getElementById("backpack-hint");
    if (hint) hint.textContent = `🍃 No bụng ${Math.round(campState.hunger)}% · đi bộ sẽ tiêu hao thể lực, ăn món nướng để hồi sức.`;
    updateBackpackLocation();
}

function createCookingVisual(type, fire, index, cooked = false) {
    const skewer = new THREE.Group();
    const stick = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.035, 1.15, 5),
        makeAnimeMaterial(0x9a6842)
    );
    stick.rotation.z = Math.PI / 2;
    skewer.add(stick);
    const foodColor = type === "fish"
        ? cooked ? 0xb87943 : 0x78b9d1
        : cooked ? 0x9a5637 : 0xd87970;
    const food = new THREE.Mesh(
        type === "fish" ? new THREE.SphereGeometry(0.22, 8, 6) : new THREE.BoxGeometry(0.48, 0.32, 0.4),
        makeAnimeMaterial(foodColor, { flatShading: true })
    );
    food.position.set(-0.1, 0, 0);
    skewer.add(food);
    skewer.position.set(0.95 + (index % 3) * 0.24, 0.8, 0.38 + Math.floor(index / 3) * 0.24);
    skewer.rotation.y = Math.PI / 2;
    fire.group.add(skewer);
    return skewer;
}

function useBackpackItem(type) {
    if (!canUseBackpackItem(type)) {
        updateBackpackLocation();
        return;
    }

    if (type === "tent") {
        const position = getPlacementPosition();
        if (!position) {
            showToast("Không đủ chỗ dựng lều ở đây. Hãy bước ra khu đất trống nhé.");
            return;
        }
        campState.inventory.tent -= 1;
        const rotation = (localPlayerMesh?.rotation.y || 0) - PLAYER_MODEL_FACING_OFFSET;
        const tent = createTent(position.x, position.z, localPlayerColor);
        tent.rotation.y = rotation;
        campState.tents.push({ ...position, rotation });
        showToast("⛺ Đã dựng lều ở phía trước bạn!");
    } else if (type === "wood") {
        const nearbyFire = findNearbyFire(6, true);
        if (nearbyFire) {
            campState.inventory.wood -= 1;
            if (!nearbyFire.base) {
                nearbyFire.fuelUntil = Math.max(Date.now(), nearbyFire.fuelUntil) + 90000;
                persistCampfire(nearbyFire);
                setFireLit(nearbyFire, true);
            } else {
                saveCampState();
            }
            addFuelVisual(nearbyFire);
            showToast("🔥 Bạn đã thêm củi, lửa trại bập bùng ấm hơn.");
        } else {
            if (campState.inventory.wood < 3) return;
            const position = getPlacementPosition();
            if (!position) {
                showToast("Không đủ chỗ nhóm bếp ở đây. Hãy tìm một khoảng đất trống.");
                return;
            }
            campState.inventory.wood -= 3;
            const fire = createFire(position.x, position.z, false);
            fire.id = `campfire-${Date.now()}`;
            campfireSites.push(fire);
            campState.campfires.push({ id: fire.id, x: fire.x, z: fire.z, fuelUntil: fire.fuelUntil });
            showToast("🔥 Đã nhóm bếp lửa trại! Củi sẽ cháy trong khoảng 3 phút.");
        }
    } else if (type === "fish" || type === "meat") {
        const fire = findNearbyFire();
        if (!fire) return;
        campState.inventory[type] -= 1;
        const readyAt = Date.now() + 5000;
        const job = { type, readyAt, x: fire.x, z: fire.z, mesh: null };
        job.mesh = createCookingVisual(type, fire, cookingJobs.length);
        cookingJobs.push(job);
        campState.cooking.push({ type, readyAt, x: fire.x, z: fire.z });
        showToast(`🍢 Đang nướng ${backpackItems[type].label.toLowerCase()}...`);
    } else if (type === "cookedFish" || type === "cookedMeat") {
        campState.inventory[type] -= 1;
        campState.hunger = Math.min(100, campState.hunger + (type === "cookedMeat" ? 45 : 30));
        showToast(`😋 Bạn đã ăn ${backpackItems[type].label.toLowerCase()}, thể lực hồi phục.`);
    }

    saveCampState();
    updateCampUI();
}

function updateCookingJobs(now) {
    let changed = false;
    for (let index = cookingJobs.length - 1; index >= 0; index--) {
        const job = cookingJobs[index];
        if (!job.mesh) {
            const fire = campfireSites.find(site => site.x === job.x && site.z === job.z);
            if (fire) job.mesh = createCookingVisual(job.type, fire, index);
        }
        if (now < job.readyAt) continue;
        const cookedType = job.type === "fish" ? "cookedFish" : "cookedMeat";
        campState.inventory[cookedType] += 1;
        campState.cooking = campState.cooking.filter(savedJob => savedJob.readyAt !== job.readyAt || savedJob.type !== job.type);
        if (job.mesh) {
            job.mesh.parent?.remove(job.mesh);
            job.mesh.traverse(node => {
                if (!node.isMesh) return;
                node.geometry.dispose();
                if (Array.isArray(node.material)) node.material.forEach(material => material.dispose());
                else node.material.dispose();
            });
        }
        cookingJobs.splice(index, 1);
        changed = true;
        showToast(`✨ ${backpackItems[cookedType].label} đã chín! Mở ba lô để ăn.`);
    }
    if (changed) {
        saveCampState();
        updateCampUI();
    }
}

function createCampUpgradeVisual(level) {
    if (level === 1) {
        createLantern(0, 8);
        createLantern(0, -8);
    } else if (level === 2) {
        const stemGeometry = new THREE.CylinderGeometry(0.025, 0.035, 0.34, 5);
        const petalGeometry = new THREE.SphereGeometry(0.095, 7, 6);
        const centerGeometry = new THREE.SphereGeometry(0.055, 7, 6);
        const stemMaterial = makeAnimeMaterial(0x5a9a54);
        const petalMaterial = makeAnimeMaterial(0xff9fca);
        const centerMaterial = makeAnimeMaterial(0xffe38b);
        for (let i = 0; i < 8; i++) {
            const angle = i / 8 * Math.PI * 2;
            const x = Math.cos(angle) * 5.2;
            const z = Math.sin(angle) * 5.2;
            const flower = new THREE.Group();
            const stem = new THREE.Mesh(stemGeometry, stemMaterial);
            stem.position.y = 0.17;
            flower.add(stem);
            for (let petal = 0; petal < 5; petal++) {
                const blossom = new THREE.Mesh(petalGeometry, petalMaterial);
                const petalAngle = petal / 5 * Math.PI * 2;
                blossom.position.set(Math.cos(petalAngle) * 0.13, 0.37, Math.sin(petalAngle) * 0.13);
                flower.add(blossom);
            }
            const center = new THREE.Mesh(centerGeometry, centerMaterial);
            center.position.y = 0.37;
            flower.add(center);
            flower.position.set(x, terrainHeight(x, z), z);
            scene.add(flower);
        }
    } else if (level === 3) {
        const tree = createTree(-11, 10, true, true);
        tree.scale.setScalar(1.35);
    }
}

function createForageVisual(type) {
    const group = new THREE.Group();
    if (type === "flower") {
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.45, 5), makeAnimeMaterial(0x57934b));
        stem.position.y = 0.22;
        group.add(stem);
        const petalMaterial = makeAnimeMaterial(forageTypes.flower.color);
        for (let i = 0; i < 5; i++) {
            const angle = i / 5 * Math.PI * 2;
            const petal = new THREE.Mesh(new THREE.SphereGeometry(0.095, 7, 6), petalMaterial);
            petal.position.set(Math.cos(angle) * 0.12, 0.48, Math.sin(angle) * 0.12);
            group.add(petal);
        }
        const center = new THREE.Mesh(new THREE.SphereGeometry(0.06, 7, 6), makeAnimeMaterial(0xffe38b));
        center.position.y = 0.48;
        group.add(center);
    } else if (type === "pinecone") {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.48, 7), makeAnimeMaterial(forageTypes.pinecone.color, { flatShading: true }));
        cone.position.y = 0.24;
        cone.rotation.x = Math.PI;
        group.add(cone);
    } else if (type === "wood") {
        const material = makeAnimeMaterial(forageTypes.wood.color, { flatShading: true });
        for (let i = 0; i < 3; i++) {
            const log = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.75, 6), material);
            log.rotation.z = Math.PI / 2;
            log.rotation.y = (i - 1) * 0.42;
            log.position.set(0, 0.12 + i * 0.12, (i - 1) * 0.13);
            group.add(log);
        }
    } else if (type === "fish") {
        const material = makeAnimeMaterial(forageTypes.fish.color, { flatShading: true });
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), material);
        body.scale.set(1.35, 0.68, 0.55);
        body.position.y = 0.3;
        group.add(body);
        const tail = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.32, 4), material);
        tail.rotation.z = Math.PI / 2;
        tail.position.set(-0.4, 0.3, 0);
        group.add(tail);
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), new THREE.MeshBasicMaterial({ color: 0x20323a }));
        eye.position.set(0.36, 0.34, 0.12);
        group.add(eye);
    } else if (type === "meat") {
        const meat = new THREE.Mesh(
            new THREE.DodecahedronGeometry(0.27, 0),
            makeAnimeMaterial(forageTypes.meat.color, { flatShading: true })
        );
        meat.position.y = 0.3;
        meat.scale.set(1.15, 0.78, 0.9);
        group.add(meat);
        const boneMaterial = new THREE.MeshBasicMaterial({ color: 0xffe6ce });
        for (const side of [-1, 1]) {
            const bone = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), boneMaterial);
            bone.position.set(side * 0.3, 0.32, 0);
            group.add(bone);
        }
    } else {
        const glow = new THREE.Mesh(
            new THREE.SphereGeometry(0.2, 10, 8),
            new THREE.MeshBasicMaterial({ color: forageTypes.firefly.color, transparent: true, opacity: 0.22 })
        );
        const light = new THREE.Mesh(
            new THREE.SphereGeometry(0.09, 8, 6),
            new THREE.MeshBasicMaterial({ color: forageTypes.firefly.color })
        );
        glow.position.y = 0.48;
        light.position.y = 0.48;
        group.add(glow, light);
    }
    return group;
}

function makeForage(id, type, x, z) {
    const mesh = createForageVisual(type);
    mesh.position.set(x, terrainHeight(x, z), z);
    scene.add(mesh);
    forageItems.push({ id, type, x, z, mesh, respawnAt: 0, baseY: mesh.position.y });
}

function makeMarker(id, x, z, title, description) {
    const group = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 1.8, 6), makeAnimeMaterial(0x795b43, { flatShading: true }));
    stem.position.y = 0.9;
    group.add(stem);

    const glowMaterial = new THREE.MeshBasicMaterial({ color: collected.has(id) ? 0xa6c989 : 0xffe289, transparent: true, opacity: 0.75 });
    const glow = new THREE.Mesh(
        new THREE.SphereGeometry(0.48, 12, 10),
        glowMaterial
    );
    glow.position.y = 2.0;
    group.add(glow);

    const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.72, 0.035, 5, 24),
        new THREE.MeshBasicMaterial({ color: collected.has(id) ? 0xa6c989 : 0xfff0b8, transparent: true, opacity: 0.7 })
    );
    ring.position.y = 2.0;
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    group.add(new THREE.PointLight(0xffc777, 0.8, 6));
    group.position.set(x, terrainHeight(x, z), z);
    scene.add(group);
    discoveries.push({ id, x, z, title, description, mesh: group, glow, ring, baseY: group.position.y, found: collected.has(id) });
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
    const maxRadius = options.maxRadius ?? 120;
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
            || isNearPond(x, z, options.pondClearance ?? 2)
            || isNearRiver(x, z, options.riverClearance ?? 1.8)) continue;
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
    const bounds = options.bounds || WORLD_PLAYER_LIMIT;

    for (let x = -bounds + spacing / 2; x <= bounds - spacing / 2; x += spacing) {
        for (let z = -bounds + spacing / 2; z <= bounds - spacing / 2; z += spacing) {
            const placementX = x + (Math.random() * 2 - 1) * jitter;
            const placementZ = z + (Math.random() * 2 - 1) * jitter;
            if (Math.hypot(placementX - 5, placementZ - 5) < 16
                || isNearPath(placementX, placementZ, 2.8)
                || isNearPond(placementX, placementZ, 1.8)
                || isNearRiver(placementX, placementZ, 2.2)) continue;

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
            [13, 18]
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
        bounds: WORLD_PLAYER_LIMIT, spacing: 10.5, jitter: 2.6,
        scaleMin: 0.78, scaleMax: 1.1, castShadow: true
    }));
    scatterForestAssets(bushPrototypes, 42, {
        minRadius: 21, maxRadius: 112, clusterRadius: 8,
        scaleMin: 0.75, scaleMax: 1.2
    });
    scatterForestAssets(mushroomPrototypes, 115, {
        minRadius: 19, maxRadius: 114, clusterRadius: 5.2,
        minSpacing: 1.25, scaleMin: 0.75, scaleMax: 1.45
    });
    scatterForestAssets(stonePrototypes, 48, {
        minRadius: 20, maxRadius: 116, clusterRadius: 7,
        minSpacing: 2, scaleMin: 0.65, scaleMax: 1.2
    });
    scatterForestAssets(stumpPrototypes, 28, {
        minRadius: 20, maxRadius: 112, clusterRadius: 6,
        minSpacing: 2.8, scaleMin: 0.75, scaleMax: 1.25
    });
    scatterForestAssets(barkPrototypes, 16, {
        minRadius: 20, maxRadius: 112, clusterRadius: 6,
        minSpacing: 3, scaleMin: 0.7, scaleMax: 1.15
    });
    scatterForestAssets(flowerPrototypes, 70, {
        minRadius: 13, maxRadius: 104, clusterRadius: 4.5,
        minSpacing: 1.2, scaleMin: 0.7, scaleMax: 1.2
    });
    scatterForestAssets(grassPrototypes, 55, {
        minRadius: 15, maxRadius: 112, clusterRadius: 3.5,
        minSpacing: 1.1, scaleMin: 0.7, scaleMax: 1.3
    });
    if (minePrototypes.length) {
        createForestInstances(minePrototypes, [{ x: 54, z: -52, rotation: -0.5, scale: 1 }], true);
    }
}

function createProceduralForestFallback() {
    for (let i = 0; i < 400; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 19 + Math.random() * 100;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        if (Math.hypot(x - 5, z - 5) < 13 || isNearPath(x, z, 4.2) || isNearPond(x, z, 2.5) || isNearRiver(x, z, 2.5)) continue;
        const broadleaf = Math.random() > 0.22;
        createTree(x, z, broadleaf, broadleaf && Math.random() > 0.32);
    }
}

// ============================================================================
// KHỞI TẠO THẾ GIỚI (WORLD BUILDING)
// ============================================================================
const campfire = createFire();
campfireSites.push(campfire);
dressCampfire();
createSky();

const groundGeometry = new THREE.PlaneGeometry(WORLD_HALF_SIZE * 2, WORLD_HALF_SIZE * 2, 180, 180);
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
riverRoutes.forEach(createRiver);

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
for (const tentSite of campState.tents) {
    const tent = createTent(tentSite.x, tentSite.z, localPlayerColor);
    tent.rotation.y = tentSite.rotation || 0;
}
for (const fireSite of campState.campfires) {
    const fire = createFire(fireSite.x, fireSite.z, false, fireSite.fuelUntil);
    fire.id = fireSite.id;
    campfireSites.push(fire);
}
for (let index = 0; index < cookingJobs.length; index++) {
    const job = cookingJobs[index];
    const fire = campfireSites.find(site => site.x === job.x && site.z === job.z);
    if (fire) job.mesh = createCookingVisual(job.type, fire, index);
}
for (const [x, z] of [[-2.8, -2.6], [2.8, -2.6], [-2.8, 2.6], [2.8, 2.6], [7, 0], [-7, 0]]) createLantern(x, z);

pondSites.forEach(createPond);
createPier(-19, -15, 0.55);

// 4 Địa điểm ngắm cảnh thơ mộng
makeMarker("pond", -16, -14, "Bến Hồ Gương", "Mặt hồ soi bóng mây trời. Hãy ngồi xuống ngắm đàn cá và hoa súng nở rộ nhé.");
makeMarker("wildflowers", 16, -17, "Thung Lũng Hoa Dại", "Cánh đồng hoa dại rực rỡ đung đưa trong gió. Đom đóm thường tụ về đây khi hoàng hôn buông xuống.");
makeMarker("lookout", 25, 27, "Đài Vọng Cảnh", "Đỉnh đồi cao nhất đón trọn ánh bình minh và biển sao đêm. Hãy ước một điều ước.");
makeMarker("sakura", 14, 18, "Cổ Thụ Anh Đào", "Tán hoa anh đào nghìn năm rực rỡ, những cánh hoa hồng bay lượn ngập tràn trong gió.");

[
    ["flower", -28, -8], ["flower", 22, -30], ["flower", 40, 16], ["flower", -34, 22],
    ["pinecone", -12, 30], ["pinecone", 38, -12], ["pinecone", -44, -22], ["pinecone", 10, 32],
    ["firefly", -30, -35], ["firefly", 30, 40], ["firefly", 45, 24], ["firefly", -42, 10],
    ["wood", -34, -28], ["wood", 34, 34], ["wood", 50, -30], ["wood", -52, 16],
    ["fish", -22, -18], ["fish", 32, -34], ["fish", 38, 42], ["fish", -40, 35],
    ["meat", -48, -12], ["meat", 48, 12], ["meat", -16, 48], ["meat", 56, 38]
].forEach(([type, x, z], index) => makeForage(`${type}-${index}`, type, x, z));
for (let level = 1; level <= campState.upgradeLevel; level++) createCampUpgradeVisual(level);

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
    if (!document.getElementById("backpack-modal")?.hidden
        && !["Escape", "i", "I", "b", "B"].includes(event.key)) return;

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
    if (event.key === "i" || event.key === "I" || event.key === "b" || event.key === "B") toggleBackpack();
    if (event.key === "Escape" && !document.getElementById("backpack-modal")?.hidden) toggleBackpack(false);
    else if (event.key === "Escape" && isPhotoMode) togglePhotoMode(false);
});

window.addEventListener("keyup", event => {
    const key = keyMap[event.key];
    if (key) keys[key] = false;
});

// UI Buttons Event Listeners
document.getElementById("btn-camera")?.addEventListener("click", () => togglePhotoMode(true));
document.getElementById("btn-backpack")?.addEventListener("click", () => toggleBackpack());
document.getElementById("touch-bag")?.addEventListener("click", () => toggleBackpack());
document.getElementById("btn-close-backpack")?.addEventListener("click", () => toggleBackpack(false));
document.getElementById("backpack-modal")?.addEventListener("click", event => {
    if (event.target === event.currentTarget) toggleBackpack(false);
});
document.getElementById("backpack-items")?.addEventListener("click", event => {
    const button = event.target.closest("button[data-item]");
    if (button && !button.disabled) useBackpackItem(button.dataset.item);
});
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

document.getElementById("camp-upgrade")?.addEventListener("click", () => {
    const recipe = campUpgradeRecipes[campState.upgradeLevel];
    if (!recipe) return;
    const canCraft = Object.entries(recipe.cost).every(([item, amount]) =>
        item === "leaves" ? campState.leaves >= amount : campState.inventory[item] >= amount
    );
    if (!canCraft) return;

    for (const [item, amount] of Object.entries(recipe.cost)) {
        if (item === "leaves") campState.leaves -= amount;
        else campState.inventory[item] -= amount;
    }
    campState.upgradeLevel += 1;
    createCampUpgradeVisual(campState.upgradeLevel);
    saveCampState();
    updateCampUI();
    showToast(`🏕️ ${recipe.name}! Khu trại của bạn ngày càng ấm cúng.`);
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
    updateCampUI();
}

function interact() {
    if (!nearestInteractable) return;
    if (localPlayerMesh && localPlayerMesh.userData) localPlayerMesh.userData.gestureTime = 1.35;
    if (nearestInteractable.kind === "forage") {
        const item = nearestInteractable.item;
        item.mesh.visible = false;
        item.respawnAt = performance.now() / 1000 + 45;
        campState.inventory[item.type] += 1;
        const questCompleted = completeDailyQuest("gathered");
        saveCampState();
        updateCampUI();
        showToast(questCompleted
            ? `🌿 Hoàn thành nhiệm vụ ngày! Nhặt ${DAILY_GATHER_GOAL} vật phẩm, nhận 2 lá may mắn.`
            : `${forageTypes[item.type].icon} Nhặt được ${forageTypes[item.type].label}!`);
        return;
    }

    const discovery = nearestInteractable.discovery;
    const wasNew = !collected.has(discovery.id);
    if (wasNew) {
        collected.add(discovery.id);
        saveStorage(DISCOVERY_KEY, [...collected]);
        discovery.found = true;
        discovery.glow.material.color.setHex(0xa6c989);
        discovery.ring.material.color.setHex(0xa6c989);
        updateProgress();
    }
    const questCompleted = completeDailyQuest("visits");
    showToast(questCompleted
        ? `🌿 Hoàn thành nhiệm vụ ngày! Ghé thăm ${DAILY_VISIT_GOAL} danh lam, nhận 2 lá may mắn.`
        : wasNew
            ? `✨ Kỷ niệm: ${discovery.title}. ${discovery.description}`
            : `🌿 Bạn lại ghé ${discovery.title}. Mỗi lần dừng chân đều là một kỷ niệm.`);
}

function updateDiscoveries(time) {
    nearestDiscovery = null;
    nearestForage = null;
    nearestInteractable = null;
    let nearestDistance = Infinity;
    for (const discovery of discoveries) {
        const distance = Math.hypot(localPos.x - discovery.x, localPos.z - discovery.z);
        discovery.mesh.position.y = discovery.baseY + (collected.has(discovery.id) ? 0 : Math.sin(time * 2 + discovery.x) * 0.12);
        discovery.glow.scale.setScalar(collected.has(discovery.id) ? 0.8 : 0.9 + Math.sin(time * 3 + discovery.z) * 0.13);
        discovery.ring.rotation.z = time * 0.24;
        discovery.found = collected.has(discovery.id);
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestDiscovery = discovery;
            nearestForage = null;
            nearestInteractable = { kind: "discovery", discovery };
        }
    }
    const now = performance.now() / 1000;
    for (const item of forageItems) {
        if (item.respawnAt && now >= item.respawnAt) {
            item.respawnAt = 0;
            item.mesh.visible = true;
        }
        if (!item.mesh.visible) continue;
        item.mesh.position.y = item.baseY + 0.08 + Math.sin(time * 2.4 + item.x) * 0.06;
        const distance = Math.hypot(localPos.x - item.x, localPos.z - item.z);
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestForage = item;
            nearestDiscovery = null;
            nearestInteractable = { kind: "forage", item };
        }
    }
    const prompt = document.getElementById("interaction-prompt");
    if (!nearestInteractable || nearestDistance > 3.6) {
        nearestInteractable = null;
        nearestDiscovery = null;
        nearestForage = null;
        prompt?.classList.remove("visible");
        return;
    }
    if (prompt) {
        prompt.innerHTML = nearestInteractable.kind === "forage"
            ? `Nhấn <kbd>E</kbd> để nhặt <strong>${forageTypes[nearestForage.type].label}</strong>`
            : `Nhấn <kbd>E</kbd> để ghé thăm <strong>${nearestDiscovery.title}</strong>`;
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
    if (screen.orientation && typeof screen.orientation.lock === "function") {
        try {
            screen.orientation.lock("landscape").catch(error => {
                console.info("Không thể khóa hướng màn hình; vẫn có thể xoay thiết bị thủ công.", error);
            });
        } catch (error) {
            console.info("Không thể khóa hướng màn hình; vẫn có thể xoay thiết bị thủ công.", error);
        }
    }
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
        if (playerLabel) playerLabel.textContent = `${charName} · WASD: Di chuyển · E: Tương tác · I: Ba lô · K: Ngồi · P: Chụp ảnh`;

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
        const x = Number.isFinite(data.x) ? THREE.MathUtils.clamp(data.x, -WORLD_PLAYER_LIMIT, WORLD_PLAYER_LIMIT) : 5;
        const z = Number.isFinite(data.z) ? THREE.MathUtils.clamp(data.z, -WORLD_PLAYER_LIMIT, WORLD_PLAYER_LIMIT) : 5;
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

// Mobile MOBA-style controls
const joystick = document.getElementById("move-joystick");
const joystickKnob = document.getElementById("joystick-knob");
const touchAxes = { x: 0, y: 0 };
let joystickPointerId = null;

function updateJoystick(event) {
    if (!joystick || !joystickKnob) return;
    const bounds = joystick.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const maxDistance = bounds.width * 0.34;
    const deltaX = event.clientX - centerX;
    const deltaY = event.clientY - centerY;
    const distance = Math.hypot(deltaX, deltaY);
    const scale = distance > maxDistance ? maxDistance / distance : 1;
    const offsetX = deltaX * scale;
    const offsetY = deltaY * scale;
    const deadZone = maxDistance * 0.12;
    const activeDistance = Math.max(0, Math.hypot(offsetX, offsetY) - deadZone);
    const strength = activeDistance / (maxDistance - deadZone);
    touchAxes.x = distance > deadZone ? offsetX / Math.hypot(offsetX, offsetY) * strength : 0;
    touchAxes.y = distance > deadZone ? offsetY / Math.hypot(offsetX, offsetY) * strength : 0;
    joystickKnob.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
    if (isSitting && strength > 0) isSitting = false;
}

function releaseJoystick(event) {
    if (joystickPointerId !== event.pointerId) return;
    joystickPointerId = null;
    touchAxes.x = 0;
    touchAxes.y = 0;
    if (joystickKnob) joystickKnob.style.transform = "";
}

joystick?.addEventListener("pointerdown", event => {
    event.preventDefault();
    if (joystickPointerId !== null) return;
    joystickPointerId = event.pointerId;
    joystick.setPointerCapture(event.pointerId);
    updateJoystick(event);
});
joystick?.addEventListener("pointermove", event => {
    if (joystickPointerId === event.pointerId) updateJoystick(event);
});
joystick?.addEventListener("pointerup", releaseJoystick);
joystick?.addEventListener("pointercancel", releaseJoystick);
joystick?.addEventListener("lostpointercapture", releaseJoystick);

document.getElementById("touch-interact")?.addEventListener("click", () => {
    interact();
});
document.getElementById("touch-sit")?.addEventListener("click", () => {
    isSitting = !isSitting;
    showToast(isSitting ? "🧘 Đang ngồi nghỉ ngơi ngắm cảnh..." : "Đã đứng dậy.");
});
document.getElementById("touch-time")?.addEventListener("click", () => {
    document.getElementById("btn-time")?.click();
});
document.getElementById("touch-photo")?.addEventListener("click", () => {
    togglePhotoMode(true);
});

// ============================================================================
// MAIN ANIMATION LOOP
// ============================================================================
const clock = new THREE.Clock();
let hungerClock = 0;

function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.05);
    const time = clock.getElapsedTime();
    let moving = false;

    // Di chuyển nhân vật
    if (localPlayerMesh && gameStarted && document.activeElement !== chatInput && document.getElementById("backpack-modal").hidden) {
        const inputX = Number(keys.d || keys.ArrowRight) - Number(keys.a || keys.ArrowLeft) + touchAxes.x;
        const inputForward = Number(keys.w || keys.ArrowUp) - Number(keys.s || keys.ArrowDown) - touchAxes.y;
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
            const speed = 5.6 * delta * Math.min(length, 1) * (campState.hunger <= 0 ? 0.7 : 1);
            const nextX = THREE.MathUtils.clamp(localPos.x + moveX * speed, -WORLD_PLAYER_LIMIT, WORLD_PLAYER_LIMIT);
            const nextZ = THREE.MathUtils.clamp(localPos.z + moveZ * speed, -WORLD_PLAYER_LIMIT, WORLD_PLAYER_LIMIT);
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
    if (moving && campState.hunger > 0) {
        hungerClock += delta;
        if (hungerClock >= 25) {
            hungerClock %= 25;
            campState.hunger = Math.max(0, campState.hunger - 1);
            saveCampState();
            updateCampUI();
        }
    }

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
                s.x = localPos.x + (Math.random() - 0.5) * WORLD_HALF_SIZE * 2.2;
                s.z = localPos.z + (Math.random() - 0.5) * WORLD_HALF_SIZE * 2.2;
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
        if (!particle.fire.flame.visible) continue;
        particle.mesh.position.y += particle.speed * (isRaining ? 0.7 : 1);
        particle.mesh.rotation.y += 0.04;
        particle.mesh.material.opacity = Math.max(0, 1 - particle.mesh.position.y / particle.maxH);
        if (particle.mesh.position.y > particle.maxH) {
            particle.mesh.position.set((Math.random() - 0.5) * 0.7, 0, (Math.random() - 0.5) * 0.7);
        }
    }
    for (const fire of campfireSites) {
        const lit = fire.base || fire.fuelUntil > Date.now();
        if (fire.lit !== lit) setFireLit(fire, lit);
        if (lit) {
            fire.flame.scale.y = 0.9 + Math.sin(time * 12 + fire.x) * 0.08;
            fire.light.intensity = (currentTimeMode === "night" ? 3.4 : 2.2) + Math.sin(time * 9 + fire.z) * 0.35;
        }
    }
    updateCookingJobs(Date.now());
    if (!document.getElementById("backpack-modal").hidden) {
        updateBackpackLocation();
        for (const button of document.querySelectorAll("#backpack-items button[data-item]")) {
            button.disabled = !canUseBackpackItem(button.dataset.item);
        }
    }

    // Gợn sóng hồ nước
    for (const ripple of pondRipples) {
        const pulse = (Math.sin(time * 1.4 + ripple.phase) + 1) / 2;
        ripple.mesh.scale.setScalar(0.7 + pulse * 1.1);
        ripple.mesh.material.opacity = 0.08 + pulse * 0.22;
    }
    for (const highlight of riverHighlights) {
        const progress = (highlight.progress + time * highlight.speed) % 1;
        const point = highlight.curve.getPointAt(progress);
        const tangent = highlight.curve.getTangentAt(progress);
        highlight.mesh.position.set(point.x, baseTerrainHeight(point.x, point.z) - 0.12, point.z);
        highlight.mesh.rotation.y = -Math.atan2(tangent.z, tangent.x);
        highlight.mesh.material.opacity = 0.28 + (Math.sin(time * 2.4 + highlight.progress * Math.PI * 2) + 1) * 0.16;
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
