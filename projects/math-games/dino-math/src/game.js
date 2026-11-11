import * as THREE from 'three';

const MULTIPLIER_POOL = [2, 3, 4, 5, 6, 7, 8, 9];
const NUMBER_COUNT = 20;
const TIMES_TABLE_SIZE = 10;
export const COLLECT_RADIUS = 3.0;
const TREE_EXCLUSION = 5;   // don't place numbers within this radius of any tree
const PLAYER_EXCLUSION = 10; // don't place numbers within this radius of the player
const STUN_DURATION = 1.5;
const MAX_HEARTS = 3;

export class Game {
    constructor(scene, camera, getElevation, treePositions = [], onCorrect = null, getPlayerPos = null) {
        this.scene = scene;
        this.camera = camera;
        this.getElevation = getElevation;

        this._treePositions = treePositions;
        this._onCorrect = onCorrect;
        this._getPlayerPos = getPlayerPos;

        this._phase = 'idle';
        this._remainingPool = this._shuffle([...MULTIPLIER_POOL]);
        this._multiplier = null;
        this._numberObjects = [];
        this._correctSet = new Set();
        this._foundCount = 0;
        this._totalCorrect = 0;
        this._hearts = MAX_HEARTS;
        this._stunTimer = 0;

        this._createUI();
    }

    get stunned() {
        return this._phase === 'stunned';
    }

    get coinMeshes() {
        return this._numberObjects.filter(m => m.visible);
    }

    startRound(multiplierOverride = null) {
        this._clearNumbers();

        if (multiplierOverride !== null) {
            this._multiplier = multiplierOverride;
        } else {
            if (this._remainingPool.length === 0) {
                this._remainingPool = this._shuffle([...MULTIPLIER_POOL]);
            }
            this._multiplier = this._remainingPool.pop();
        }

        this._hearts = MAX_HEARTS;
        this._foundCount = 0;

        const range = this._multiplier * TIMES_TABLE_SIZE;
        const allMultiples = [];
        const allNonMultiples = [];
        for (let i = 1; i <= range; i++) {
            if (i % this._multiplier === 0) allMultiples.push(i);
            else allNonMultiples.push(i);
        }

        this._shuffle(allNonMultiples);

        const correctPick = allMultiples;
        const wrongPick = allNonMultiples.slice(0, NUMBER_COUNT - correctPick.length);

        this._totalCorrect = correctPick.length;
        this._correctSet = new Set(correctPick);

        const allNumbers = this._shuffle([...correctPick, ...wrongPick]);
        const positions = this._generatePositions(allNumbers.length);

        allNumbers.forEach((num, i) => {
            const { x, z } = positions[i];
            const mesh = this._createNumberMesh(num);
            const baseY = this.getElevation(x, z) + 4;
            mesh.position.set(x, baseY, z);
            mesh.userData.number = num;
            mesh.userData.baseY = baseY;
            this.scene.add(mesh);
            this._numberObjects.push(mesh);
        });

        this._phase = 'playing';
        this._updateUI();
    }

    update(playerPos, delta, playerMoving = false) {
        if (this._phase === 'stunned') {
            this._stunTimer -= delta;
            if (this._stunTimer <= 0) this._phase = 'playing';
            return;
        }

        if (this._phase !== 'playing') return;

        const t = performance.now() / 1000;

        for (const mesh of this._numberObjects) {
            if (!mesh.visible) continue;
            mesh.position.y = mesh.userData.baseY + Math.sin(t * 1.5 + mesh.userData.number * 0.7) * 0.25;
            mesh.lookAt(this.camera.position);
        }

        if (playerMoving) return;

        for (const mesh of this._numberObjects) {
            if (!mesh.visible) continue;
            const dx = playerPos.x - mesh.position.x;
            const dz = playerPos.z - mesh.position.z;
            if (dx * dx + dz * dz < COLLECT_RADIUS * COLLECT_RADIUS) {
                this._collect(mesh);
                return;
            }
        }
    }

    _collect(mesh) {
        mesh.visible = false;
        const num = mesh.userData.number;

        if (this._correctSet.has(num)) {
            this._foundCount++;
            this._flash('rgba(30, 200, 80, 0.3)', 0.8);
            this._updateUI();
            if (this._onCorrect) this._onCorrect();
            if (this._foundCount === this._totalCorrect) this._roundComplete();
        } else {
            this._hearts--;
            this._flash('rgba(220, 30, 30, 0.5)', 0.7);
            this._updateUI();
            if (this._hearts <= 0) {
                this._roundFailed();
            } else {
                this._phase = 'stunned';
                this._stunTimer = STUN_DURATION;
            }
        }
    }

    _roundComplete() {
        this._phase = 'round_complete';
        const lastInCycle = this._remainingPool.length === 0;
        this._bannerEl.textContent = lastInCycle
            ? '🏆 Amazing! You found all the times tables! You\'re a Math Champion!'
            : `🎉 Great job! All multiples of ${this._multiplier} found!`;
        setTimeout(() => this.startRound(), lastInCycle ? 5000 : 2500);
    }

    _roundFailed() {
        this._phase = 'failed';
        this._bannerEl.textContent = `💔 Oh no! Let's try again — find multiples of ${this._multiplier}!`;
        setTimeout(() => this.startRound(this._multiplier), 3000);
    }

    _flash(color, fadeSecs) {
        this._overlayEl.style.transition = 'none';
        this._overlayEl.style.background = color;
        setTimeout(() => {
            this._overlayEl.style.transition = `background ${fadeSecs}s ease-out`;
            this._overlayEl.style.background = 'transparent';
        }, 16);
    }

    _clearNumbers() {
        for (const mesh of this._numberObjects) {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            if (mesh.material.map) mesh.material.map.dispose();
            mesh.material.dispose();
        }
        this._numberObjects = [];
    }

    _createNumberMesh(number) {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        ctx.shadowColor = 'rgba(0,0,0,0.55)';
        ctx.shadowBlur = 18;
        ctx.shadowOffsetY = 7;
        ctx.fillStyle = '#FFD700';
        ctx.beginPath();
        ctx.arc(size / 2, size / 2 - 3, size / 2 - 14, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;

        ctx.strokeStyle = '#A0720A';
        ctx.lineWidth = 12;
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255,250,180,0.7)';
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.arc(size / 2, size / 2 - 3, size / 2 - 24, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#3D2200';
        ctx.font = `bold ${number >= 10 ? 108 : 128}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(number.toString(), size / 2, size / 2 + 2);

        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            alphaTest: 0.5,
            side: THREE.DoubleSide,
        });
        return new THREE.Mesh(new THREE.PlaneGeometry(2.5, 2.5), material);
    }

    _generatePositions(count) {
        const positions = [];
        const MIN_DIST = 7;
        const SPREAD = 36;
        const playerPos = this._getPlayerPos ? this._getPlayerPos() : null;

        for (let i = 0; i < count; i++) {
            let x, z, attempts = 0;
            do {
                x = (Math.random() - 0.5) * SPREAD * 2;
                z = (Math.random() - 0.5) * SPREAD * 2;
                attempts++;
            } while (
                (this.getElevation(x, z) < 0.5 ||
                    positions.some(p => Math.hypot(p.x - x, p.z - z) < MIN_DIST) ||
                    this._treePositions.some(t => Math.hypot(t.x - x, t.z - z) < TREE_EXCLUSION) ||
                    (playerPos && Math.hypot(playerPos.x - x, playerPos.z - z) < PLAYER_EXCLUSION)) &&
                attempts < 100
            );
            positions.push({ x, z });
        }
        return positions;
    }

    _createUI() {
        const ui = document.createElement('div');
        Object.assign(ui.style, {
            position: 'fixed', top: '10px', left: '0', width: '100%',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: '6px', pointerEvents: 'none', userSelect: 'none', zIndex: '100',
        });

        this._bannerEl = document.createElement('div');
        Object.assign(this._bannerEl.style, {
            padding: '10px 24px', borderRadius: '12px',
            background: 'rgba(0,0,0,0.6)', color: 'white',
            fontSize: '26px', fontWeight: 'bold',
            fontFamily: '"Arial Rounded MT Bold", Arial, sans-serif',
            textShadow: '1px 2px 4px rgba(0,0,0,0.9)',
            whiteSpace: 'nowrap',
        });

        this._progressEl = document.createElement('div');
        Object.assign(this._progressEl.style, {
            display: 'flex', alignItems: 'center',
            gap: '6px', padding: '8px 14px', borderRadius: '10px',
            background: 'rgba(0,0,0,0.45)',
        });

        this._heartsEl = document.createElement('div');
        Object.assign(this._heartsEl.style, {
            padding: '4px 16px 6px', borderRadius: '10px',
            fontSize: '26px', background: 'rgba(0,0,0,0.45)',
        });

        ui.appendChild(this._bannerEl);
        ui.appendChild(this._progressEl);
        ui.appendChild(this._heartsEl);
        document.body.appendChild(ui);

        this._overlayEl = document.createElement('div');
        Object.assign(this._overlayEl.style, {
            position: 'fixed', top: '0', left: '0',
            width: '100%', height: '100%',
            pointerEvents: 'none', zIndex: '50', background: 'transparent',
        });
        document.body.appendChild(this._overlayEl);
    }

    _updateUI() {
        this._bannerEl.textContent = `Find all multiples of ${this._multiplier}!`;

        this._progressEl.innerHTML = '';
        for (let i = 0; i < this._totalCorrect; i++) {
            const collected = i < this._foundCount;
            const tile = document.createElement('div');
            Object.assign(tile.style, {
                width: '30px', height: '30px', borderRadius: '6px',
                background: collected ? '#FFD700' : 'rgba(255,255,255,0.15)',
                border: `2px solid ${collected ? '#A0720A' : 'rgba(255,255,255,0.35)'}`,
                boxShadow: collected ? '0 0 10px rgba(255,215,0,0.8)' : 'none',
                transition: 'all 0.3s',
            });
            this._progressEl.appendChild(tile);
        }

        this._heartsEl.textContent =
            '❤️'.repeat(this._hearts) + '🖤'.repeat(MAX_HEARTS - this._hearts);
    }

    _shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }
}
