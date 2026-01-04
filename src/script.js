import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

// === GAME STATE ===
let isGameActive = false; // The game starts paused

// === AUDIO SETUP ===
const bgm = new Audio("./sounds/The-Builder(chosic.com).mp3"); // Ensure path is correct
bgm.loop = true;
bgm.volume = 0.5;

// Try to play music immediately
bgm.play().catch((error) => {
  console.log("Autoplay blocked. Waiting for user interaction.");
  // If blocked, play on the first click anywhere on the page
  window.addEventListener(
    "click",
    () => {
      bgm.play();
    },
    { once: true }
  ); // 'once: true' means this listener runs only one time
});

// Elements
const landingPage = document.getElementById("landing-page");
const startBtn = document.getElementById("btn-start");
const exitBtn = document.getElementById("btn-exit");
const volumeSlider = document.getElementById("bgm-slider");
const hud = document.getElementById("hud"); // Grab the HUD to hide it initially

//import { mod } from 'three/src/nodes/TSL.js'
const BLOOM_LAYER = 1;
//Base
// ===== LEVEL SYSTEM =====
let level = 1;
let enemiesKilled = 0;
let enemiesToNextLevel = 10;

// ===== SKILL SYSTEM =====
const waves = []; // Array to store active waves
let waveCooldown = 0;
const waveCooldownMax = 5.0;
let isRightMouseDown = false; // To prevent spamming if held down

let isWaveSkillUnlocked = false;
let skillStacks = 0;
const skillStacksRequired = 5;
const skillHud = document.getElementById("skill-hud");
const skillStatusText = document.getElementById("skill-status");
const skillCounterText = document.getElementById("skill-counter");
const skillTimerOverlay = document.getElementById("skill-timer-overlay");

// Elements
const gameOverPage = document.getElementById("game-over-page");
const finalScoreDisplay = document.getElementById("final-score-display");
const restartBtn = document.getElementById("btn-restart");
// const quitBtn = document.getElementById("btn-quit");

// Elements
const pauseMenu = document.getElementById("pause-menu");
const resumeBtn = document.getElementById("btn-resume");
const mainMenuBtn = document.getElementById("btn-main-menu");

let isPaused = false;

// ===== PARTICLES (DEATH EXPLOSIONS) =====
const particles = [];
const particleGeometry = new THREE.BoxGeometry(1, 1, 1); // Small cube chunks
const particleMaterial = new THREE.MeshBasicMaterial({
  color: 0xff0000,
  transparent: true,
  opacity: 0.8,
});
//const recoilAmount = 0.2

// Enemy speed modifier
let enemyGlobalSpeed = 1.0;

// ===== SCORE + COMBO =====
let score = 0;
let combo = 2;

// ===== ENEMY TYPES =====
const ENEMY_TYPES = {
  NORMAL: "normal",
  FAST: "fast",
  TANK: "tank",
  ZIGZAG: "zigzag",
};

// ===== POWER UPS =====
const powerUps = [];
const POWER_TYPES = ["rapidFire", "heal", "slowTime"];

function spawnPowerUp(position) {
  const type = POWER_TYPES[Math.floor(Math.random() * POWER_TYPES.length)];

  // Colors
  const colors = {
    heal: 0x00ff00,
    rapidFire: 0xffaa00,
    slowTime: 0x00aaff,
  };
  const glowColor = colors[type] || 0xffffff;

  let mesh = null;
  let mixer = null;

  // === NEW: COMPENSATION SCALE ===
  // Since rapidFire model is smaller (0.35 vs 0.5), we need to make its aura bigger
  let auraBaseScale = 1.0;
  if (type === "rapidFire") auraBaseScale = 1.6;

  if (powerUpAssets[type]) {
    mesh = powerUpAssets[type].clone();

    // Animation
    const animations = powerUpAssets[type].userData.animations;
    if (animations && animations.length > 0) {
      mixer = new THREE.AnimationMixer(mesh);
      const action = mixer.clipAction(animations[0]);
      action.play();
    }

    // Shadows
    mesh.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  } else {
    // Fallback
    const geo = new THREE.SphereGeometry(0.4, 12, 12);
    const mat = new THREE.MeshStandardMaterial({ color: glowColor });
    mesh = new THREE.Mesh(geo, mat);
  }

  // === AURA ===
  const auraGeo = new THREE.SphereGeometry(1.5, 16, 16);
  const auraMat = new THREE.MeshBasicMaterial({
    color: glowColor,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const auraMesh = new THREE.Mesh(auraGeo, auraMat);
  mesh.add(auraMesh);

  // === LIGHT ===
  const light = new THREE.PointLight(glowColor, 3.0, 8.0);
  light.position.y = 0.5;
  mesh.add(light);

  mesh.position.copy(position);
  mesh.position.y = 1.0;
  scene.add(mesh);

  powerUps.push({
    mesh,
    type,
    mixer,
    aura: auraMesh,
    auraBaseScale: auraBaseScale, // <--- Save the compensation scale here
    rotationSpeed: 1.0 + Math.random(),
    life: 5.0,
  });
}
function spawnDeathParticles(position, color) {
  for (let i = 0; i < 8; i++) {
    // OPTIMIZATION: Use shared geometry
    const mesh = new THREE.Mesh(sharedParticleGeo, particleMaterial.clone());

    mesh.material.color.set(color || 0xff0000);
    mesh.position.copy(position);

    // Reuse temp vector for math calculations
    mesh.position.x += (Math.random() - 0.5) * 0.5;
    mesh.position.z += (Math.random() - 0.5) * 0.5;
    mesh.position.y += 0.5;

    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 0.3,
      Math.random() * 0.5 + 0.1,
      (Math.random() - 0.5) * 0.1
    );

    mesh.userData.rotSpeed = {
      x: (Math.random() - 0.5) * 10,
      y: (Math.random() - 0.5) * 10,
    };

    scene.add(mesh);

    particles.push({
      mesh: mesh,
      velocity: velocity,
      life: 1.0,
    });
  }
}
function spawnWaterTrail(position) {
  // Clone material so each ripple can fade independently
  const mesh = new THREE.Mesh(trailGeometry, trailMaterial.clone());

  // Position it at the enemy's location, slightly above water (y=0) to avoid Z-fighting
  mesh.position.copy(position);
  mesh.position.y = 0.05;

  scene.add(mesh);

  enemyTrails.push({
    mesh: mesh,
    life: 1.0, // Life starts at 1.0 and counts down to 0
  });
}

function activatePowerUp(type) {
  // Inside activatePowerUp(type)
  if (type === "heal") {
    // 1. IF DUCK IS HURT -> HEAL
    if (duckHealth < maxHealth) {
      duckHealth++;
      updateDuckIcons();

      // Play Heal Sound & Flash (From previous step)
      if (healSoundReady && !healSound.isPlaying) healSound.play();
      if (healFlash) {
        healFlash.classList.add("active");
        setTimeout(() => healFlash.classList.remove("active"), 300);
      }
    }
    // 2. IF HEALTH FULL & SKILL LOCKED -> STACK
    else if (!isWaveSkillUnlocked) {
      skillStacks++;

      // Update UI Text
      skillCounterText.textContent = `${skillStacks}/${skillStacksRequired}`;

      // Play a small "charging" sound or effect here if you want

      // Check for Unlock
      if (skillStacks >= skillStacksRequired) {
        isWaveSkillUnlocked = true;

        // Visual Updates
        skillHud.classList.remove("locked");
        skillHud.classList.add("unlocked");
        skillStatusText.textContent = "READY";
        skillCounterText.textContent = "MAX";

        console.log("WAVE SKILL UNLOCKED!");
      }
    }
    // 3. IF FULL HEALTH & UNLOCKED -> Just Score
    else {
      updateScore(100); // Bonus points for wasting health packs
    }
  }

  if (type === "rapidFire") {
    projectilesSpeed = 0.9;
    isRapidFire = true;
    // === PLAY SOUND ===
    if (rapidFireSoundReady && !rapidFireSound.isPlaying) rapidFireSound.play();
    setTimeout(() => {
      projectilesSpeed = 0.5;
      isRapidFire = false; // <--- TURN OFF
    }, 5000);
  }

  if (type === "slowTime") {
    enemyGlobalSpeed = 0.3;
    if (slowenemySoundReady && !slowenemy.isPlaying) slowenemy.play();
    setTimeout(() => {
      enemyGlobalSpeed = 1.0;
    }, 4000);
  }
}

// ===== WAVE SKILL OBJECTS =====
// (InnerRadius, OuterRadius, Segments, PhiSeg, StartAngle, LengthAngle)
// Creating a "C" shape arc
const waveGeometry = new THREE.RingGeometry(1.5, 2.5, 32, 1, Math.PI, Math.PI);

// Lay it flat on the ground
waveGeometry.rotateX(-Math.PI / 2);

const waveMaterial = new THREE.MeshBasicMaterial({
  color: 0x00ffff,
  transparent: true,
  opacity: 0.7,
  side: THREE.DoubleSide,
});

const levelValue = document.getElementById("level-value"); // optional UI

// Debug
// const gui = new dat.GUI()

// Canvas
const canvas = document.querySelector("canvas.webgl");

// Scene
const scene = new THREE.Scene();
//scene.background = new THREE.Color(0xD69B7C)

const textureLoader = new THREE.TextureLoader();
//LIGHTS

//scene.add(object1, object2, object3)
// ===== POND (WATER FLOOR) =====
const pondGeometry = new THREE.CircleGeometry(30, 32, 0, 6.283185307179586); // Large size (100x100)
const pondMaterial = new THREE.MeshBasicMaterial({
  color: 0x005eb8, // Ocean Blue

  side: THREE.DoubleSide, // Visible from below if camera goes under
});
const pond = new THREE.Mesh(pondGeometry, pondMaterial);
const pondBaseColor = pondMaterial.color.clone();
pondMaterial.depthWrite = false;

pond.renderOrder = -1;

// Rotate -90 degrees on X to lay it flat
pond.rotation.x = -Math.PI / 2;
pond.position.y = 0; // Ground level

scene.add(pond);

// ===== PROJECTILE TRACERS =====
const projectileTracers = [];
const tracerMaterial = new THREE.MeshBasicMaterial({
  color: 0xffaa00, // Golden/Orange glow
  transparent: true,
  opacity: 0.8,
  blending: THREE.AdditiveBlending, // Makes them look like light
});

// ===== WATER TRAIL EFFECT =====
const enemyTrails = []; // Stores active trail particles
const trailGeometry = new THREE.RingGeometry(
  0.1,
  0.7,
  6,
  5,
  1,
  6.283185307179586
); // A flat ring
trailGeometry.rotateX(-Math.PI / 2); // Lay it flat on the water
const trailMaterial = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 1,
  side: THREE.DoubleSide,
});

const _tempVec = new THREE.Vector3();
const _tempDir = new THREE.Vector3();
const _tempPos = new THREE.Vector3();
const _axisY = new THREE.Vector3(0, 1, 0);
const _zero = new THREE.Vector3(0, 0, 0);

// Reusable Geometries (Don't create these inside functions)
const sharedParticleGeo = new THREE.BoxGeometry(1, 1, 1);

// Helper to Clean Memory
function cleanUpMesh(mesh) {
  if (!mesh) return;

  scene.remove(mesh);

  mesh.traverse((child) => {
    if (child.isMesh) {
      if (child.geometry) child.geometry.dispose();

      if (child.material) {
        // Handle arrays of materials or single materials
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    }
  });
}
//RAYCASTER
const raycaster = new THREE.Raycaster();

//DUCK MODEL
const gltfLoader = new GLTFLoader();

let model = null;
gltfLoader.load("./models/Duck/glTF-Binary/Duck.glb", (gltf) => {
  model = gltf.scene;
  // gltf.scene.position.y = -1.2
  // Keep duck on pond height
  model.position.y = 0.1;
  model.rotation.y += Math.PI;
  scene.add(model);
});

let coinmodel = null;
gltfLoader.load("./models/coin.glb", (gltf) => {
  coinmodel = gltf.scene;

  // Scale the coin to a good size
  coinmodel.scale.set(0.5, 0.5, 0.5);

  // Enable shadows
  coinmodel.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      // Make it shiny gold
      if (child.material) {
        child.material.metalness = 1.0;
        child.material.roughness = 0.3;
        child.material.color.set(0xffd700); // Gold color
      }
    }
  });
});

let crocodileModel = null;

let isRapidFire = false;
const powerUpAssets = {
  heal: null,
  rapidFire: null,
  slowTime: null,
};

// Load Health Model
gltfLoader.load("./models/PowerUP/health.glb", (gltf) => {
  const model = gltf.scene;
  model.scale.set(0.5, 0.5, 0.5);
  model.rotation.y = -Math.PI / 2;
  powerUpAssets.heal = model;
});

// Load Rapid Fire Model
gltfLoader.load("./models/PowerUP/projectilespeed.glb", (gltf) => {
  const model = gltf.scene;
  model.scale.set(0.3, 0.3, 0.3);
  model.rotation.y = -Math.PI / 2;
  model.userData.animations = gltf.animations;
  powerUpAssets.rapidFire = model;
});

// Load Slow Time Model
gltfLoader.load("./models/PowerUP/enemyslow.glb", (gltf) => {
  const model = gltf.scene;
  model.scale.set(0.5, 0.5, 0.5);
  model.rotation.y = -Math.PI / 2;
  model.userData.animations = gltf.animations;
  powerUpAssets.slowTime = model;
});

gltfLoader.load("./models/Crocodile/crocodile2.glb", (gltf) => {
  // 1. Save the loaded model to a variable
  crocodileModel = gltf.scene;

  // 2. Adjust scale/rotation to fit the game, scale down
  const scale = 0.7;
  crocodileModel.scale.set(scale, scale, scale);
  // crocodileModel.rotation.z = Math.PI/20

  // 3. Fix Materials (Optional: Make it less shiny/dark)
  crocodileModel.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      child.rotation.y = Math.PI * 0.5;

      // If it looks too dark, increase roughness or emissive
      if (child.material) {
        child.material.roughness = 0.8;
        child.material.metalness = 0.0;
      }
    }
  });
});

//Duck Island
let duckIsland = null;

gltfLoader.load("./models/Island/duck-Island.glb", (gltf) => {
  duckIsland = gltf.scene;

  const scale = 1.5;
  duckIsland.scale.set(scale, scale, scale);
  duckIsland.rotation.y = Math.PI / 2;

  duckIsland.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      child.material.metalness = 0.0;

      if (child.material) {
        child.material.roughness = 0.8;
        child.material.metalness = 0.0;
      }
    }
  });
  scene.add(duckIsland);
});

const sizes = {
  width: window.innerWidth,
  height: window.innerHeight,
};

window.addEventListener("resize", () => {
  const aspect = sizes.width / sizes.height;
  camera.left = (-frustumSize * aspect) / 2;
  camera.right = (frustumSize * aspect) / 2;
  camera.top = frustumSize / 2;
  camera.bottom = -frustumSize / 2;

  camera.updateProjectionMatrix();

  // Update renderer
  renderer.setSize(sizes.width, sizes.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

// ===== KEYBOARD MOVEMENT =====
const keys = {
  w: false,
  a: false,
  s: false,
  d: false,
};

window.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() in keys) {
    keys[e.key.toLowerCase()] = true;
  }
});

window.addEventListener("keyup", (e) => {
  if (e.key.toLowerCase() in keys) {
    keys[e.key.toLowerCase()] = false;
  }
});

window.addEventListener("keydown", (e) => {
  // Check if the key is Escape AND the game has actually started (so it doesn't open on landing page)
  if (
    e.key === "Escape" &&
    landingPage.style.display === "none" &&
    !isGameActive &&
    !isPaused
  ) {
    // Game Over state check if needed, but assuming standard play:
    // If game is over, we usually don't want pause menu, so you might check:
    if (gameOverPage.style.display !== "flex") {
      togglePause();
    }
  } else if (e.key === "Escape" && (isGameActive || isPaused)) {
    togglePause();
  }
});

//MOUSE
const mouse = new THREE.Vector2();
window.addEventListener("mousemove", (event) => {
  mouse.x = (event.clientX / sizes.width) * 2 - 1;
  mouse.y = -(event.clientY / sizes.height) * 2 + 1;
});

window.addEventListener("mousedown", (event) => {
  if (event.button === 2) {
    if (!isWaveSkillUnlocked) {
      console.log("Skill Locked! Collect 5 Health at Max Health to unlock.");
      return;
    }
    isRightMouseDown = true;
  }
});

//CLICK
const glowShell = new THREE.Mesh(
  new THREE.SphereGeometry(0.5, 12, 12),
  new THREE.MeshBasicMaterial({
    color: 0xffaa00,
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
);

window.addEventListener("click", () => {
  // 1. Check UI/Basic Objects
  raycaster.setFromCamera(mouse, camera);

  if (model) {
    raycaster.setFromCamera(mouse, camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const targetPoint = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, targetPoint);

    const projectile = new THREE.Mesh(
      projectileGeometry,
      projectileMaterial.clone()
    );
    if (isRapidFire) {
      projectile.material.color.set(0xff0000); // Turn Red
      projectile.material.emissive.set(0xff0000); // Glow Red
    }
    projectile.layers.enable(BLOOM_LAYER);

    const forward = new THREE.Vector3(1, 0, 0); // X-axis
    forward.applyQuaternion(model.quaternion); // rotate with duck's facing
    projectile.position
      .copy(model.position)
      .add(forward.multiplyScalar(1))
      .add(new THREE.Vector3(0, 1, 0));

    // === JUICE 1: ELONGATE PROJECTILE ===
    projectile.scale.set(1.5, 0.7, 0.7);
    projectile.lookAt(targetPoint);

    projectile.add(glowShell);
    scene.add(projectile);

    const direction = new THREE.Vector3().subVectors(
      targetPoint,
      projectile.position
    );

    direction.y = 0;
    direction.normalize();

    projectiles.push({
      mesh: projectile,
      velocity: direction.multiplyScalar(projectilesSpeed),
      life: 0,
    });

    // Randomize pitch slightly so it doesn't sound robotic
    if (shootSound.isPlaying) shootSound.stop();
    shootSound.detune = (Math.random() - 0.5) * 400; // Variate pitch
    shootSound.play();

    // Squash the duck down slightly
    model.scale.set(1.3, 0.8, 1.3);
    // Push the duck backward physically (Kickback)
    const recoilDir = direction.clone().negate().normalize();
    //model.position.add(recoilDir.multiplyScalar(0.3)) // Small knockback

    // Create a quick flash of light at the beak
    const flash = new THREE.PointLight(0xffaa00, 5, 5);
    flash.position.copy(projectile.position);
    scene.add(flash);
    // Remove flash after 50ms
    setTimeout(() => scene.remove(flash), 50);
  }
});

//PROJECTILES
const projectiles = [];
let projectilesSpeed = 0.5;
const projectileGeometry = new THREE.SphereGeometry(
  0.3,
  10,
  15,
  0,
  6.283185307179586,
  0,
  3.141592653589793
);
const projectileMaterial = new THREE.MeshStandardMaterial({
  color: 0xffd79a,
  emissive: 0xffffff,
  emissiveIntensity: 10,
  roughness: 0.05,
  metalness: 0.1,
});

// Spawn new enemy every few second
//Spawning System
let spawnInterval = 1.5; // Time in seconds between enemies
let spawnTimer = 0; // Counter to track time
let previousTime = 0; // Used to calculate delta time

//ENEMIES

const enemies = [];

function spawnEnemy() {
  if (!crocodileModel) return;

  const angle = Math.random() * Math.PI * 2;
  const distance = 30 + Math.random() * 20;

  const enemy = crocodileModel.clone();
  enemy.position.set(
    Math.cos(angle) * distance,
    1.3,
    Math.sin(angle) * distance
  );

  scene.add(enemy);

  // Determine Type (Logic stays the same)
  let type = ENEMY_TYPES.NORMAL;
  if (level >= 2 && Math.random() < 0.3) type = ENEMY_TYPES.FAST;
  if (level >= 3 && Math.random() < 0.4) type = ENEMY_TYPES.ZIGZAG;
  if (level >= 4 && Math.random() < 0.2) type = ENEMY_TYPES.TANK;

  // Visual cues for different types (Optional: Tint the color)
  enemy.traverse((child) => {
    if (child.isMesh) {
      // Clone material so changing one doesn't change all
      child.material = child.material.clone();
      // Allow fading by enabling transparency on the cloned material
      child.material.transparent = true;

      if (type === ENEMY_TYPES.FAST) child.material.color.set(0xffaa00); // Orange
      if (type === ENEMY_TYPES.TANK) child.material.color.set(0x444444); // Dark Grey
      // Normal stays original texture color
    }
  });

  // Scale adjustment for Tank
  if (type === ENEMY_TYPES.TANK) {
    enemy.scale.multiplyScalar(1.5);
  }

  enemies.push({
    mesh: enemy,
    // Radius needs to be accurate for hit detection.
    // Since it's a model, 0.8 is usually a safe guess, adjust if hits miss.
    radius: type === ENEMY_TYPES.TANK ? 1.2 : 1.5,
    speed:
      type === ENEMY_TYPES.FAST
        ? 0.07
        : type === ENEMY_TYPES.TANK
        ? 0.02
        : 0.04,
    health: type === ENEMY_TYPES.TANK ? 3 : 1,
    type,
    strafeOffset: Math.random() * Math.PI * 2,
    strafeSpeed: 0.05,
  });
}

// ===== COIN SYSTEM =====
const coins = [];

function spawnCoin(position) {
  if (!coinmodel) return;

  // Clone the blueprint
  const coin = coinmodel.clone();

  // Set position (start slightly higher for a "pop" effect)
  coin.position.copy(position);
  coin.position.y = 1.5;

  scene.add(coin);

  coins.push({
    mesh: coin,
    rotationSpeed: 5.0, // Spin faster!
    bobOffset: Math.random() * Math.PI,

    // === NEW PROPERTIES ===
    isMagnetized: false, // Has it started flying yet?
    magnetDelay: 0.5, // Wait 0.5 seconds before flying
    flySpeed: 0.0, // Starts at 0 speed and accelerates
  });
}

const frustumSize = 35;
const aspect = sizes.width / sizes.height;

const camera = new THREE.OrthographicCamera(
  (-frustumSize * aspect) / 2,
  (frustumSize * aspect) / 2,
  frustumSize / 2,
  -frustumSize / 2,
  0.1,
  1000
);

// Diagonal top-down angle
camera.position.set(0, 35, 35);

// Tilt downward
camera.lookAt(0, 0, 0);

scene.add(camera);

//AUDIO
const listener = new THREE.AudioListener();
camera.add(listener);

// Shoot SOUND
const shootSound = new THREE.Audio(listener);
const audioLoader = new THREE.AudioLoader();

audioLoader.load("./sounds/bottle-pop.mp3", (buffer) => {
  shootSound.setBuffer(buffer);
  shootSound.setLoop(false);
  shootSound.setVolume(0.5);
});

//HIT SOUND
let hitSoundReady = false;
const hitSound = new THREE.Audio(listener);
audioLoader.load("./sounds/egg_cracking.mp3", (buffer) => {
  hitSound.setBuffer(buffer);
  hitSound.setLoop(false);
  hitSound.setVolume(0.2);
  hitSoundReady = true;
});

//Duck hitsound
let duckQuackSoundReady = false;
const duckQuack = new THREE.Audio(listener);

audioLoader.load("./sounds/quack.mp3", (buffer) => {
  duckQuack.setBuffer(buffer);
  duckQuack.setLoop(false);
  duckQuack.setVolume(0.5);
  duckQuackSoundReady = true;
});

//Wave Sound
let waveSoundReady = false;
const waveSound = new THREE.Audio(listener);

audioLoader.load("./sounds/water-splash.mp3", (buffer) => {
  waveSound.setBuffer(buffer);
  waveSound.setLoop(false);
  waveSound.setVolume(0.5);
  waveSoundReady = true;
});

//GAME OVER SOUND
let gameOverSoundReady = false;
const gameOverSound = new THREE.Audio(listener);

audioLoader.load("./sounds/game-over.mp3", (buffer) => {
  gameOverSound.setBuffer(buffer);
  gameOverSound.setLoop(false);
  gameOverSound.setVolume(0.8);
  gameOverSoundReady = true;
});

//Level up
let lvlupSoundReady = false;
const lvlupSound = new THREE.Audio(listener);

audioLoader.load("./sounds/level-up.mp3", (buffer) => {
  lvlupSound.setBuffer(buffer);
  lvlupSound.setLoop(false);
  lvlupSound.setVolume(0.8);
  lvlupSoundReady = true;
});

let slowenemySoundReady = false;
const slowenemy = new THREE.Audio(listener);

audioLoader.load("./sounds/bass-drop2.mp3", (buffer) => {
  slowenemy.setBuffer(buffer);
  slowenemy.setLoop(false);
  slowenemy.setVolume(1.5);
  slowenemySoundReady = true;
});

let healSoundReady = false;
const healSound = new THREE.Audio(listener);

audioLoader.load("./sounds/heal-up.mp3", (buffer) => {
  healSound.setBuffer(buffer);
  healSound.setLoop(false);
  healSound.setVolume(0.8);
  healSoundReady = true;
});

let rapidFireSoundReady = false;
const rapidFireSound = new THREE.Audio(listener);

audioLoader.load("./sounds/rapid-fire.mp3", (buffer) => {
  rapidFireSound.setBuffer(buffer);
  rapidFireSound.setLoop(false);
  rapidFireSound.setVolume(0.8);
  rapidFireSoundReady = true;
});

let coinSoundReady = false;
const coinSound = new THREE.Audio(listener);

audioLoader.load("./sounds/drop-coin.mp3", (buffer) => {
  coinSound.setBuffer(buffer);
  coinSound.setLoop(false);
  coinSound.setVolume(0.3);
  coinSoundReady = true;
});

function updateScore(points) {
  // Combo system
  score += points * combo;
  scoreValue.textContent = score;
}

function recordKill() {
  enemiesKilled++;

  // Level up check moves here
  if (enemiesKilled >= enemiesToNextLevel) {
    levelUp();
  }
}

const levelPopup = document.getElementById("level-popup");

function levelUp() {
  level++;
  enemiesKilled = 0;
  enemiesToNextLevel += 5;

  // 1. PLAY SOUND
  if (lvlupSoundReady) {
    if (lvlupSound.isPlaying) lvlupSound.stop();
    lvlupSound.play();
  }

  // 2. INCREASE DIFFICULTY
  spawnInterval = Math.max(0.3, 1.0 - level * 0.1);

  // 3. SHOW POPUP [NEW CODE]
  if (levelPopup) {
    levelPopup.textContent = `LEVEL ${level}`; // Update text
    levelPopup.classList.add("active"); // Trigger animation

    // Remove after 2 seconds
    setTimeout(() => {
      levelPopup.classList.remove("active");
    }, 2000);
  }

  console.log(`LEVEL UP → ${level}`);
}

function castWaveSkill() {
  if (!isWaveSkillUnlocked) return;
  if (!model || waveCooldown > 0) return;
  if (waveSoundReady) {
    if (waveSound.isPlaying) waveSound.stop(); // Restarts sound if you cast again quickly
    waveSound.play();
  }

  // 1. Raycast
  raycaster.setFromCamera(mouse, camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const targetPoint = new THREE.Vector3();
  raycaster.ray.intersectPlane(plane, targetPoint);

  // 2. Create Wave
  const wave = new THREE.Mesh(waveGeometry, waveMaterial.clone());
  wave.position.copy(model.position);
  wave.position.y = 0.2;

  // 3. Aim
  targetPoint.y = wave.position.y;
  wave.lookAt(targetPoint);

  // Was 0.1, changed to 1.0 so it starts as a wide arc
  wave.scale.set(1.0, 1.0, 1.0);

  scene.add(wave);

  // 4. Direction
  const direction = new THREE.Vector3()
    .subVectors(targetPoint, model.position)
    .normalize();

  // Was 0.5, changed to 0.2 (Easier to see, hits more consistently)
  waves.push({
    mesh: wave,
    velocity: direction.multiplyScalar(0.2),
    life: 0,
    maxLife: 25,
  });

  waveCooldown = waveCooldownMax;
}

// DUCK HEALTHHEALTH SYSTEM
let duckHealth = 5;
let maxHealth = 5;
let isGameOver = false;
let duckSpeed = 0.05;

const duckHealthContainer = document.getElementById("duck-health");
const duckHealthFrame = document.getElementById("duck-health-frame");
const damageFlash = document.getElementById("damage-flash");
const healFlash = document.getElementById("heal-flash");

const duckIconPath = "./images/duck-health.png";

function updateDuckIcons() {
  duckHealthContainer.innerHTML = "";
  for (let i = 0; i < maxHealth; i++) {
    const img = document.createElement("img");
    img.src = duckIconPath;
    if (i >= duckHealth) img.classList.add("lost");
    duckHealthContainer.appendChild(img);
  }
}

updateDuckIcons();

// === SCORE SYSTEM ===

const scoreValue = document.getElementById("score-value");

function triggerGameOver() {
  isGameActive = false; // Stop the game loop
  bgm.pause();
  bgm.currentTime = 0;

  // Play Game Over Sound
  if (gameOverSoundReady) gameOverSound.play();

  // Show the Game Over Screen
  gameOverPage.style.display = "flex";
  hud.style.display = "none"; // Hide the normal game HUD

  // Update the score text
  finalScoreDisplay.textContent = `SCORE: ${score}`;
}

function togglePause() {
  isPaused = !isPaused;

  if (isPaused) {
    // PAUSE STATE
    isGameActive = false;
    bgm.pause(); // Pause the music
    pauseMenu.style.display = "flex";
    hud.style.display = "none";
  } else {
    // RESUME STATE
    isGameActive = true;
    bgm.play(); // Resume the music
    pauseMenu.style.display = "none";
    hud.style.display = "block";
  }
}

const whiteFlash = document.getElementById("white-flash");

window.addEventListener("contextmenu", (event) => {
  event.preventDefault(); // STOPS the browser menu from showing
  castWaveSkill();
});

// RESUME BUTTON
resumeBtn.addEventListener("click", () => {
  togglePause(); // Simply unpauses
});

// MAIN MENU BUTTON (From Pause)
mainMenuBtn.addEventListener("click", () => {
  // 1. Hide Pause Menu
  pauseMenu.style.display = "none";

  // 2. Reset Game State or Reload
  // The safest way to go back to main menu completely fresh is reloading:
  window.location.reload();
});

//RESET GAME
function resetGame() {
  // OPTIMIZATION: Dispose of memory properly
  enemies.forEach((e) => cleanUpMesh(e.mesh));
  projectiles.forEach((p) => cleanUpMesh(p.mesh));
  projectileTracers.forEach((t) => cleanUpMesh(t.mesh));
  particles.forEach((p) => cleanUpMesh(p.mesh));
  powerUps.forEach((p) => cleanUpMesh(p.mesh));
  enemyTrails.forEach((t) => cleanUpMesh(t.mesh));
  waves.forEach((w) => cleanUpMesh(w.mesh));

  // Clear Arrays
  enemies.length = 0;
  projectiles.length = 0;
  projectileTracers.length = 0;
  particles.length = 0;
  powerUps.length = 0;
  enemyTrails.length = 0;
  waves.length = 0;
  // ... existing cleanup ...
  coins.forEach((c) => cleanUpMesh(c.mesh)); // Clean memory

  // Clear Array
  coins.length = 0;

  // Reset Stats
  duckHealth = maxHealth;
  score = 0;
  scoreValue.textContent = score;
  updateDuckIcons();
  level = 1;
  enemiesKilled = 0;
  enemiesToNextLevel = 10;
  spawnTimer = 0;
  spawnInterval = 1;
  enemyGlobalSpeed = 1;
  skillStacks = 0;
  isWaveSkillUnlocked = false;
  waveCooldown = 0;
  skillHud.classList.remove("unlocked", "cooldown");
  skillHud.classList.add("locked");
  skillStatusText.textContent = "LOCKED";
  skillCounterText.textContent = "0/8";

  skillTimerOverlay.textContent = "";
  skillTimerOverlay.style.opacity = ""; // <--- CHANGEd THIS from '0' to ""
  skillTimerOverlay.style.height = ""; // <--- Clear height just in ca
  skillTimerOverlay.style.height = "";

  isGameOver = false;
  // UI Reset
  const overlay = document.getElementById("game-over-overlay");
  if (overlay) overlay.remove();

  if (!bgm.isPlaying) bgm.play();

  if (model) {
    model.traverse((child) => {
      if (child.isMesh) child.material.color.set(0xffffff);
    });
    model.scale.set(1, 1, 1);
  }

  if (levelPopup) {
    levelPopup.classList.remove("active");
    levelPopup.textContent = "LEVEL 1";
  }
}

// Controls

const cameraOffset = new THREE.Vector3(0, 60, 60); // height, distance
const cameraLerpSpeed = 0.08;

const cameraHeight = 20; // how high above the duck
const cameraFollowSpeed = 0.12;

/**
 * Renderer
 */
const renderer = new THREE.WebGLRenderer({
  canvas: canvas,
});

const composer = new EffectComposer(renderer);

const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(sizes.width, sizes.height),
  1.5, // strength
  0.4, // radius
  0.85 // threshold
);

composer.addPass(bloomPass);

renderer.setSize(sizes.width, sizes.height);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; // Makes brights/darks look more realistic
renderer.toneMappingExposure = 1.0;

const pmremGenerator = new THREE.PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();

new EXRLoader().load("./textures/EnviMap/forest.exr", (texture) => {
  const envMap = pmremGenerator.fromEquirectangular(texture).texture;

  scene.environment = envMap;
  // scene.background = envMap// IMPORTANT
  scene.background = new THREE.Color(0x538069); // soft sky blue

  texture.dispose();
  pmremGenerator.dispose();
});

// Initially hide the HUD so it doesn't overlap the menu
hud.style.display = "none";

// 1. START BUTTON
startBtn.addEventListener("click", () => {
  // Hide Landing Page
  bgm.play().catch((e) => console.log("Audio play failed:", e));
  landingPage.classList.add("hidden");

  // Show HUD
  hud.style.display = "block";

  // Start Game Logic
  isGameActive = true;
});

// 2. EXIT BUTTON
exitBtn.addEventListener("click", () => {
  // Try to close window (browsers often block this)
  // Fallback: Reload page to reset everything
  if (confirm("Are you sure you want to exit?")) {
    window.close();
    location.reload();
  }
});

// 3. VOLUME SLIDER
volumeSlider.addEventListener("input", (e) => {
  const volume = e.target.value;
  bgm.volume = volume;
});

restartBtn.addEventListener("click", () => {
  window.location.reload();
});

const clock = new THREE.Clock();

let currentIntersect = null;

// --- OPTIMIZATION GLOBALS ---

const _diff = new THREE.Vector3();
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const ZERO_POINT = new THREE.Vector3(0, 0, 0);

const tick = () => {
  const elapsedTime = clock.getElapsedTime();
  const deltaTime = elapsedTime - previousTime;
  previousTime = elapsedTime;

  if (isGameActive) {
    // 1. Duck Movement
    if (model) {
      _tempVec.set(0, 0, 0); // Reset temp vector

      if (keys.w) _tempVec.z -= 1;
      if (keys.s) _tempVec.z += 1;
      if (keys.a) _tempVec.x -= 1;
      if (keys.d) _tempVec.x += 1;

      if (_tempVec.lengthSq() > 0) {
        // faster than length()
        _tempVec.normalize().multiplyScalar(duckSpeed);

        // Calculate potential position
        _tempPos.copy(model.position).add(_tempVec);

        // Distance check (Squared to avoid sqrt)
        const distSq = _tempPos.x * _tempPos.x + _tempPos.z * _tempPos.z;

        // 28 * 28 = 784 (Radius squared)
        if (distSq < 784) {
          model.position.copy(_tempPos);
          if (Math.random() < 0.15) spawnWaterTrail(model.position);
        }
      }
    }

    // 2. Camera Follow
    if (model) {
      // Reuse _tempPos for camera target
      _tempPos.copy(model.position).add(cameraOffset);
      camera.position.lerp(_tempPos, cameraFollowSpeed);
      // camera.lookAt(model.position.x, model.position.y, model.position.z)
    }

    // 3. Spawning
    spawnTimer += deltaTime * enemyGlobalSpeed;
    if (spawnTimer >= spawnInterval) {
      spawnEnemy();
      spawnTimer = 0;
    }

    // 4. Raycaster / Mouse Interaction
    raycaster.setFromCamera(mouse, camera);
    if (model) {
      const modelIntersects = raycaster.intersectObject(model, true);

      if (modelIntersects.length) {
        model.scale.set(1.2, 1.2, 1.2);
      } else {
        // Smoothly lerp back
        model.scale.lerp(_tempVec.set(1, 1, 1), 0.1);
      }

      // Optimized Rotation
      raycaster.ray.intersectPlane(new THREE.Plane(_axisY, 0), _tempPos);
      _tempPos.y = model.position.y;
      model.lookAt(_tempPos);
      model.rotateY(-Math.PI / 2);
    }

    // 5. Trails Update
    for (let i = enemyTrails.length - 1; i >= 0; i--) {
      const trail = enemyTrails[i];
      trail.life -= 0.01;
      trail.mesh.scale.multiplyScalar(1.01);
      trail.mesh.material.opacity = trail.life * 0.4;

      if (trail.life <= 0) {
        cleanUpMesh(trail.mesh); // Clean memory
        enemyTrails.splice(i, 1);
      }
    }

    // 6. Enemy Logic
    if (model) {
      for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];

        // Dying Logic
        if (e.isDying) {
          e.deathTimer -= deltaTime;
          e.mesh.scale.multiplyScalar(1.05);
          e.mesh.traverse((child) => {
            if (child.isMesh && child.material) {
              child.material.transparent = true;
              child.material.opacity = Math.max(0, e.deathTimer * 5);
            }
          });

          if (e.deathTimer <= 0) {
            cleanUpMesh(e.mesh); // Clean memory
            enemies.splice(i, 1);
            if (e.shouldSpawnPowerUp) spawnPowerUp(e.mesh.position.clone());
          }
          continue;
        }

        // Hit Flash Logic
        if (e.hitTimer > 0) {
          e.hitTimer -= deltaTime;
          if (e.hitTimer <= 0) {
            e.mesh.traverse((child) => {
              if (child.isMesh) child.material.emissive.set(0x000000);
            });
          }
        }

        // Movement Logic
        _tempDir.subVectors(model.position, e.mesh.position).normalize();

        if (e.type === ENEMY_TYPES.ZIGZAG) {
          e.strafeOffset += e.strafeSpeed;
          // Calculate Right vector without new object
          const sinOffset = Math.sin(e.strafeOffset) * 1.1;
          _tempDir.x += -_tempDir.z * sinOffset; // Quick right vector math
          _tempDir.z += _tempDir.x * sinOffset;
        }

        // Apply movement
        _tempDir.multiplyScalar(e.speed * enemyGlobalSpeed);
        e.mesh.position.add(_tempDir);
        e.mesh.lookAt(model.position);

        if (Math.random() < 0.15) spawnWaterTrail(e.mesh.position);

        // Hit Player Logic
        // Using distanceToSquared (1.5 * 1.5 = 2.25)
        if (e.mesh.position.distanceToSquared(model.position) < 2.25) {
          if (duckQuack.isPlaying) duckQuack.stop();
          duckQuack.play();

          cleanUpMesh(e.mesh); // Clean memory
          enemies.splice(i, 1);

          if (duckHealthFrame) {
            duckHealthFrame.classList.add("hit");
            setTimeout(() => duckHealthFrame.classList.remove("hit"), 400);
          }
          if (damageFlash) {
            damageFlash.classList.add("active");
            setTimeout(() => damageFlash.classList.remove("active"), 200);
          }

          model.traverse((child) => {
            if (child.isMesh) child.material.color.set(0xff0000);
          });
          setTimeout(() => {
            model.traverse((child) => {
              if (child.isMesh) child.material.color.set(0xffffff);
            });
          }, 200);

          duckHealth--;
          updateDuckIcons();

          if (duckHealth <= 0 && !isGameOver) {
            isGameOver = true;
            triggerGameOver();

            //onGameOver();
          }
        }
      }
    }

    // 7. Projectile Tracers
    for (let i = projectileTracers.length - 1; i >= 0; i--) {
      const tracer = projectileTracers[i];
      tracer.life -= deltaTime * 8.0;
      tracer.mesh.scale.multiplyScalar(0.9);
      tracer.mesh.material.opacity = tracer.life;

      if (tracer.life <= 0) {
        cleanUpMesh(tracer.mesh); // Clean memory
        projectileTracers.splice(i, 1);
      }
    }

    // 8. Pond Animation
    pondMaterial.color.copy(pondBaseColor);
    pondMaterial.color.offsetHSL(0, 0, Math.sin(elapsedTime * 0.5) * 0.05);

    // 9. Power Ups Animation & Logic
    for (let i = powerUps.length - 1; i >= 0; i--) {
      const power = powerUps[i];
      power.life -= deltaTime;

      // --- B. REMOVAL ---
      if (power.life <= 0) {
        cleanUpMesh(power.mesh);
        powerUps.splice(i, 1); // Remove from array
        continue; // Skip the rest of the loop
      }

      // --- C. BLINKING EFFECT (Visual Warning) ---
      // If life is less than 2 seconds, make it flash
      if (power.life < 2.0) {
        // Flash speed increases as life gets shorter
        const flashSpeed = 20;
        // Simple On/Off visibility toggle based on time
        power.mesh.visible = Math.sin(elapsedTime * flashSpeed) > -0.5;
      } else {
        power.mesh.visible = true; // Ensure it's visible otherwise
      }

      // --- D. EXISTING ANIMATIONS ---
      if (power.mesh) power.mesh.rotation.y += power.rotationSpeed * deltaTime;
      if (power.mixer) power.mixer.update(deltaTime);
      if (power.aura) {
        const pulse = 1.1 + Math.sin(elapsedTime * 3.0) * 0.2;
        const finalScale = pulse * (power.auraBaseScale || 1.0);
        power.aura.scale.set(finalScale, finalScale, finalScale);
        power.aura.material.opacity = 0.3 + Math.sin(elapsedTime * 3.0) * 0.1;
      }
    }

    // 10. Projectile Logic & Collision
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];

      p.mesh.position.add(p.velocity);

      // Spawn Tracer
      const tMesh = new THREE.Mesh(projectileGeometry, tracerMaterial.clone());
      if (isRapidFire) tMesh.material.color.set(0xff0000);
      tMesh.position.copy(p.mesh.position);
      tMesh.scale.set(0.2, 0.2, 0.2);
      tMesh.layers.enable(BLOOM_LAYER);
      scene.add(tMesh);

      projectileTracers.push({ mesh: tMesh, life: 1.5 });

      p.life += p.velocity.length();

      // Max range check
      if (p.life > 100) {
        cleanUpMesh(p.mesh); // Clean memory
        projectiles.splice(i, 1);
        continue;
      }

      let projectileHit = false;

      // Collision: Projectiles vs Enemies
      const pRadius = 0.3;
      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
        // OPTIMIZATION: Squared distance
        const minDist = pRadius + e.radius;
        const distSq = p.mesh.position.distanceToSquared(e.mesh.position);

        if (distSq < minDist * minDist) {
          if (hitSoundReady) {
            if (hitSound.isPlaying) hitSound.stop();
            hitSound.play();
          }

          e.health--;

          e.hitTimer = 0.1;
          e.mesh.traverse((child) => {
            if (child.isMesh) {
              child.material.emissive.set(0xffffff);
              child.material.emissiveIntensity = 0.8;
            }
          });

          // Knockback
          _tempDir.copy(p.velocity).normalize().multiplyScalar(0.5);
          e.mesh.position.add(_tempDir);

          cleanUpMesh(p.mesh); // Clean projectile
          projectiles.splice(i, 1);
          projectileHit = true;

          if (e.health <= 0) {
            enemies.splice(j, 1);
            cleanUpMesh(e.mesh);

            updateScore(5);
            recordKill();
            spawnCoin(e.mesh.position);

            let boomColor = 0xff0000;
            if (e.type === "fast") boomColor = 0xffaa00;
            if (e.type === "tank") boomColor = 0x444444;
            spawnDeathParticles(e.mesh.position, boomColor);

            if (Math.random() < 0.15) spawnPowerUp(e.mesh.position.clone());
          }

          break;
        }
      }

      if (projectileHit) continue;

      // Collision: Projectiles vs Powerups
      for (let k = powerUps.length - 1; k >= 0; k--) {
        const power = powerUps[k];
        const powerRadius = 1.5;
        const minDist = pRadius + powerRadius;

        // Optimization: Squared
        if (
          p.mesh.position.distanceToSquared(power.mesh.position) <
          minDist * minDist
        ) {
          activatePowerUp(power.type);

          cleanUpMesh(p.mesh);
          cleanUpMesh(power.mesh);
          projectiles.splice(i, 1);
          powerUps.splice(k, 1);

          projectileHit = true;
          break;
        }
      }
    }

    // 11. Particles Update
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];

      p.life -= deltaTime * 1.5;
      p.velocity.y -= deltaTime * 0.5;
      p.mesh.position.add(p.velocity);

      p.mesh.rotation.x += p.mesh.userData.rotSpeed.x * deltaTime;
      p.mesh.rotation.y += p.mesh.userData.rotSpeed.y * deltaTime;

      p.mesh.scale.multiplyScalar(0.95);
      p.mesh.material.opacity = p.life;

      if (p.life <= 0 || p.mesh.position.y < -1) {
        cleanUpMesh(p.mesh); // Clean memory
        particles.splice(i, 1);
      }
    }

    // 12. Wave Skill Logic
    if (isWaveSkillUnlocked) {
      if (waveCooldown > 0) {
        waveCooldown -= deltaTime;

        // Apply class (CSS handles the visual gray overlay)
        if (!skillHud.classList.contains("cooldown")) {
          skillHud.classList.add("cooldown");
        }

        // Update ONLY the text
        skillTimerOverlay.textContent = Math.ceil(waveCooldown);
      } else {
        // Cooldown Finished
        waveCooldown = 0;
        if (skillHud.classList.contains("cooldown")) {
          skillHud.classList.remove("cooldown");
          skillTimerOverlay.textContent = "";
        }
      }
    }
    for (let i = waves.length - 1; i >= 0; i--) {
      const wave = waves[i];
      wave.mesh.position.add(wave.velocity);

      if (wave.mesh.scale.x < 3) {
        wave.mesh.scale.multiplyScalar(1.02);
      } else {
        const mat = wave.mesh.material;
        // Handle array material check if needed, simplifed here:
        if (!mat) {
          cleanUpMesh(wave.mesh);
          waves.splice(i, 1);
          continue;
        }

        let currentOp = Array.isArray(mat) ? mat[0].opacity : mat.opacity;
        currentOp -= 0.05;

        if (Array.isArray(mat)) mat.forEach((m) => (m.opacity = currentOp));
        else mat.opacity = currentOp;

        if (currentOp <= 0) {
          cleanUpMesh(wave.mesh); // Clean memory
          waves.splice(i, 1);
          continue;
        }
      }

      // Wave Collisions
      const waveRadius = 2.5 * wave.mesh.scale.x;

      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
        if (e.isDying) continue;

        // Squared distance is tricky for 2D, sticking to the logic but optimizing math vars
        const dx = wave.mesh.position.x - e.mesh.position.x;
        const dz = wave.mesh.position.z - e.mesh.position.z;
        const distSq = dx * dx + dz * dz; // Manual squared

        if (distSq < waveRadius * waveRadius) {
          if (hitSoundReady && Math.random() < 0.1) {
            if (!hitSound.isPlaying) hitSound.play();
          }

          e.health -= 1;

          _tempDir.copy(wave.velocity).normalize().multiplyScalar(0.3);
          e.mesh.position.add(_tempDir);

          e.hitTimer = 0.1;
          e.mesh.traverse((c) => {
            if (c.isMesh) c.material.emissive.set(0x00ffff);
          });

          if (e.health <= 0) {
            updateScore(20);
            recordKill();
            e.isDying = true;
            e.deathTimer = 0.15;

            let boomColor = 0xff0000;
            if (e.type === "fast") boomColor = 0xffaa00;
            if (e.type === "tank") boomColor = 0x444444;

            spawnDeathParticles(e.mesh.position, boomColor);
            if (Math.random() < 0.15) e.shouldSpawnPowerUp = true;
          }
        }
      }
    }

    // ===== 13. COIN LOGIC =====
    for (let i = coins.length - 1; i >= 0; i--) {
      const coin = coins[i];

      // 1. Rotation (Always spin)
      coin.mesh.rotation.y += coin.rotationSpeed * deltaTime;

      // 2. Magnet & Movement Logic
      if (model) {
        // Phase A: Waiting (The "Pop")
        if (coin.magnetDelay > 0) {
          coin.magnetDelay -= deltaTime;

          // Bob up and down while waiting
          coin.mesh.position.y =
            1.0 + Math.sin(elapsedTime * 3 + coin.bobOffset) * 0.2;
        }
        // Phase B: Flying to Duck
        else {
          // Calculate direction to the duck
          _tempDir.subVectors(model.position, coin.mesh.position).normalize();

          // Accelerate the coin (zoom effect)
          coin.flySpeed += deltaTime * 20.0;

          // Move the coin
          coin.mesh.position.add(
            _tempDir.multiplyScalar(coin.flySpeed * deltaTime)
          );
        }

        // 3. Collection Check
        // We use a small distance now because the coin flies RIGHT into the duck
        const distSq = coin.mesh.position.distanceToSquared(model.position);

        if (distSq < 1.0) {
          // === Coin Collected! ===

          // Play Sound
          if (coinSoundReady) {
            if (coinSound.isPlaying) coinSound.stop();
            coinSound.play();
          }

          // Add Bonus Score
          updateScore(50);

          // Remove Coin
          cleanUpMesh(coin.mesh);
          coins.splice(i, 1);
        }
      }
    }
  }
  // Render
  camera.layers.set(BLOOM_LAYER);
  composer.render();
  camera.layers.set(0);
  renderer.render(scene, camera);

  window.requestAnimationFrame(tick);
};

tick();
