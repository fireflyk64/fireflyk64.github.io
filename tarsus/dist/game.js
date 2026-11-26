/*
Copyright (c) 2024 by the Alexander Reiter Horn and Albert Sung.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/
import { P2PGame } from "./p2p-client.js";
import * as P from "./protocol.js";
////////////// Setup the Window //////////////////
const canvas = document.createElement("canvas");
document.body.style.overflow = "hidden"; // hide scroll bars
canvas.id = "drawArea";
canvas.setAttribute("style", "background-color:#000008;bottom:0;right:0;z-index:100;position:fixed");
const origWidth = 640;
const origHeight = 480;
// fill the window by default; F10 toggles back to the classic 640x480
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
canvas.tabIndex = 0;
const ctx = canvas.getContext("2d");
const existingCanvas = document.getElementById(canvas.id);
if (existingCanvas && existingCanvas.parentElement) {
    existingCanvas.parentElement.removeChild(existingCanvas);
}
document.body.appendChild(canvas);
canvas.focus();
const K_SCALE = .0025;
// Pirates only open fire when the target could plausibly see them (just past
// the 640x480 screen corner) and lose interest entirely at long range.
const NPC_SHOOT_RANGE = 500;
const NPC_DISENGAGE_RANGE = 3000;
// Press L within this distance of a base to dock (repair + invulnerable).
const DOCK_RANGE = 170;
// Off-duty pirates patrol a circle of this radius around their home base.
const NPC_LOITER_RADIUS = 600;
// Pirate cruise speed as a fraction of a player's max: fast enough to pressure
// a trader near a base, slow enough that a straight-line run always escapes.
const NPC_CRUISE = 0.35;
const boom_urls = ["https://graphics.stanford.edu/~danielh/sprites/boom/01.png", "https://graphics.stanford.edu/~danielh/sprites/boom/02.png", "https://graphics.stanford.edu/~danielh/sprites/boom/03.png", "https://graphics.stanford.edu/~danielh/sprites/boom/04.png", "https://graphics.stanford.edu/~danielh/sprites/boom/05.png", "https://graphics.stanford.edu/~danielh/sprites/boom/06.png", "https://graphics.stanford.edu/~danielh/sprites/boom/07.png", "https://graphics.stanford.edu/~danielh/sprites/boom/08.png", "https://graphics.stanford.edu/~danielh/sprites/boom/09.png", "https://graphics.stanford.edu/~danielh/sprites/boom/10.png", "https://graphics.stanford.edu/~danielh/sprites/boom/11.png", "https://graphics.stanford.edu/~danielh/sprites/boom/12.png", "https://graphics.stanford.edu/~danielh/sprites/boom/13.png", "https://graphics.stanford.edu/~danielh/sprites/boom/14.png",];
function square(x) {
    return x * x;
}
function dist(x, y, i, j) {
    return Math.sqrt(square(x - i) + square(y - j));
}
function popListPosition(x, position) {
    x[position] = x[x.length - 1];
    x.pop();
    return (x);
}
function popList2Position(x, position) {
    for (let i = 0; i < x.length; i++) {
        let lastIndex = x[i].length - 1;
        x[i][position] = x[i][lastIndex];
        x[i].pop();
    }
}
function tick() {
}
/////////////// The camera /////////////////////
class Camera {
    constructor() {
        this.cameraX = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        this.cameraY = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    }
    update(cameraX, cameraY) {
        this.cameraX.push(cameraX);
        this.cameraY.push(cameraY);
        this.cameraX.shift();
        this.cameraY.shift();
    }
}
////////////////// stars ///////////////////////
class Stars {
    createstar() {
        var x = Math.round(Math.random() * canvas.width) + camera.cameraX[0];
        var y = Math.round(Math.random() * canvas.height) + camera.cameraY[0];
        this.starsX.push(x);
        this.starsY.push(y);
    }
    constructor(imageUrl) {
        this.starsX = [];
        this.starsY = [];
        this.sprite = [];
        this.size = 0.75;
        for (var i = 0; i < imageUrl.length; i++) {
            let image = new Image();
            image.src = imageUrl[i];
            this.sprite.push(image);
        }
        for (var i = 0; i < 100 / 640 / 480 * canvas.width * canvas.height; i++) {
            this.createstar();
        }
    }
    draw(camera) {
        for (var i = 0; i < this.starsX.length; i++) {
            ctx.save();
            var x = this.starsX[i] - camera.cameraX[0] + canvas.width / 2;
            var y = this.starsY[i] - camera.cameraY[0] + canvas.height / 2;
            x = x % canvas.width;
            y = y % canvas.height;
            if (x < 0) {
                x = x + canvas.width;
            }
            if (y < 0) {
                y = y + canvas.height;
            }
            ctx.translate(x, y);
            const spriteIndex = i % this.sprite.length;
            ctx.drawImage(this.sprite[spriteIndex], 0, 0, this.sprite[spriteIndex].width, this.sprite[spriteIndex].height, -this.sprite[spriteIndex].width / 2 * this.size, -this.sprite[spriteIndex].height / 2 * this.size, this.sprite[spriteIndex].width * this.size, this.sprite[spriteIndex].height * this.size);
            ctx.restore();
        }
    }
}
class Asteroids {
    createasteroid() {
        var x = Math.round(Math.random() * canvas.width * 2) + camera.cameraX[0];
        var y = Math.round(Math.random() * canvas.height * 2) + camera.cameraY[0];
        this.asteroidsX.push(x);
        this.asteroidsY.push(y);
    }
    constructor(imageURL) {
        this.asteroidsX = [];
        this.asteroidsY = [];
        this.size = 1;
        let image = new Image();
        image.src = imageURL;
        this.sprite = image;
        for (var i = 0; i < 15; i++) {
            this.createasteroid();
        }
    }
    draw(camera) {
        for (var i = 0; i < this.asteroidsX.length; i++) {
            ctx.save();
            var x = this.asteroidsX[i] - camera.cameraX[0] + canvas.width / 2;
            var y = this.asteroidsY[i] - camera.cameraY[0] + canvas.height / 2;
            if (x < -canvas.width / 2) {
                this.asteroidsX[i] += canvas.width * 2;
            }
            if (y < -canvas.height / 2) {
                this.asteroidsY[i] += canvas.height * 2;
            }
            if (x > 3 * canvas.width / 2) {
                this.asteroidsX[i] -= canvas.width * 2;
            }
            if (y > 3 * canvas.height / 2) {
                this.asteroidsY[i] -= canvas.height * 2;
            }
            ctx.translate(x, y);
            ctx.drawImage(this.sprite, 0, 0, this.sprite.width, this.sprite.height, -this.sprite.width / 2 * this.size, this.sprite.height * this.size, this.sprite.height * this.size, this.sprite.height * this.size);
            ctx.restore();
        }
    }
}
//boomsprites"https://graphics.stanford.edu/~danielh/sprites/boom/01.png"
class Boom {
    constructor(spriteUrls) {
        this.boomX = [];
        this.boomY = [];
        this.boomFrame = [];
        this.size = 1;
        this.boomImages = [];
        for (var i = 0; i < spriteUrls.length; i++) {
            let image = new Image();
            image.src = spriteUrls[i];
            this.boomImages.push(image);
        }
    }
    createBoom(x, y) {
        this.boomX.push(x);
        this.boomY.push(y);
        this.boomFrame.push(0);
    }
    update() {
        for (var i = 0; this.boomX.length > i; i++) {
            this.boomFrame[i]++;
            if (this.boomFrame[i] >= this.boomImages.length) {
                popList2Position([this.boomX, this.boomY, this.boomFrame], i);
                i--;
            }
        }
    }
    draw(camera) {
        for (var i = 0; this.boomX.length > i; i++) {
            ctx.save();
            ctx.translate(this.boomX[i] - camera.cameraX[0] + canvas.width / 2, this.boomY[i] - camera.cameraY[0] + canvas.height / 2);
            ctx.drawImage(this.boomImages[this.boomFrame[i]], 0, 0, this.boomImages[this.boomFrame[i]].width, this.boomImages[this.boomFrame[i]].height, -this.boomImages[this.boomFrame[i]].width / 2 * this.size, -this.boomImages[this.boomFrame[i]].height / 2 * this.size, this.boomImages[this.boomFrame[i]].width * this.size, this.boomImages[this.boomFrame[i]].height * this.size);
            ctx.restore();
        }
    }
}
/////////// lazzzzers!!! ///////////
// Every laser gets an id unique to this client so peers can refer to it in
// damage messages (and so a hit is only counted once).
let laserIdCounter = 0;
function nextLaserId() {
    laserIdCounter = (laserIdCounter + 1) & 0xffff;
    return laserIdCounter;
}
class Lasers {
    createlaser(entity, x, y, xVelocity, yVelocity) {
        this.laserX.push(x);
        this.laserY.push(y);
        this.laserVelocityX.push(xVelocity);
        this.laserVelocityY.push(yVelocity);
        this.laserStartX.push(x);
        this.laserStartY.push(y);
        this.laserId.push(nextLaserId());
        this.laserEntityStartId.push(entity);
    }
    constructor(imageUrl) {
        this.laserX = [];
        this.laserY = [];
        this.laserStartX = [];
        this.laserStartY = [];
        this.laserId = [];
        this.laserDamage = 5;
        this.velocity = 5500 * K_SCALE;
        this.damageArea2 = 8.875;
        this.damageArea1 = 17.75 * 3;
        this.laserVelocityX = [];
        this.laserVelocityY = [];
        this.laserEntityStartId = [];
        this.sprite = [];
        this.size = 0.25;
        this.allProperties = [this.laserX, this.laserY, this.laserVelocityX, this.laserVelocityY, this.laserStartX, this.laserStartY, this.laserId, this.laserEntityStartId];
        for (var i = 0; i < imageUrl.length; i++) {
            let image = new Image();
            image.src = imageUrl[i];
            this.sprite.push(image);
        }
    }
    update() {
        for (var i = this.laserX.length - 1; i >= 0; i--) {
            if (dist(this.laserStartX[i], this.laserStartY[i], this.laserX[i], this.laserY[i]) > 3500) {
                let lastIndex = this.laserX.length - 1;
                for (var j = 0; j < this.allProperties.length; j++) {
                    this.allProperties[j][i] = this.allProperties[j][lastIndex];
                    this.allProperties[j].pop();
                }
            }
        }
        for (var i = 0; i < this.laserX.length; i++) {
            this.laserX[i] += this.laserVelocityX[i];
            this.laserY[i] += this.laserVelocityY[i];
        }
    }
    draw(camera) {
        for (var i = 0; i < this.laserX.length; i++) {
            ctx.save();
            var x = this.laserX[i] - camera.cameraX[0] + canvas.width / 2;
            var y = this.laserY[i] - camera.cameraY[0] + canvas.height / 2;
            ctx.translate(x, y);
            const spriteIndex = i % this.sprite.length;
            ctx.drawImage(this.sprite[spriteIndex], 0, 0, this.sprite[spriteIndex].width, this.sprite[spriteIndex].height, -this.sprite[spriteIndex].width / 2 * this.size, -this.sprite[spriteIndex].height / 2 * this.size, this.sprite[spriteIndex].width * this.size, this.sprite[spriteIndex].height * this.size);
            ctx.restore();
        }
    }
}
function toRadians(degrees) {
    return degrees * Math.PI / 180;
}
//////////// Setup the Ship///////////////////
class Ship {
    constructor(imageUrl, x, y) {
        this.lastShot = 0;
        this.shotEnergyCost = 10;
        this.maxSetSpeed = 113470 / 64 * K_SCALE;
        this.maxAfterburnerVelocity = 164200 / 64 * K_SCALE;
        this.afterburnerAcceleration = 100;
        this.acceleration = 80;
        this.setSpeed = 0;
        this.maxEnergy = 300;
        this.energy = 300;
        this.energyRegeneration = 2;
        this.xVelocity = 0;
        this.yVelocity = 0;
        this.size = 0.75;
        this.shieldRegeneration = 1 / 30;
        this.shieldRegenerationcost = 1 / 20;
        this.shieldsMax = 200;
        this.shields = 200;
        this.spacePressed = false;
        this.tabPressed = false;
        this.upPressed = false;
        this.downPressed = false;
        this.leftPressed = false;
        this.rightPressed = false;
        this.alive = true; // only ever false for the local player in multiplayer
        this.docked = false; // parked at a base: invulnerable, repairing (local player only)
        this.npcId = 0; // wire id when this ship is a host-simulated pirate
        this.npcSprite = 0; // index into P.PIRATE_SPRITES when this is a pirate
        this.homeBase = 0; // bases[] index a pirate loiters around when off duty
        this.speedFactor = 1; // pirate cruise-speed multiplier (varies by hull)
        this.lastHitBy = null; // owner of the last laser that hit us (bounty credit)
        this.x = 320;
        this.y = 240;
        this.shieldTime = 0;
        this.angle = 0;
        this.angleSpeed = 0;
        let image = new Image();
        image.src = imageUrl;
        this.sprite = image;
        image = new Image();
        image.src = "https://graphics.stanford.edu/~danielh/sprites/shield.png";
        this.spriteShield = image;
        if (x !== undefined) {
            this.x = x;
        }
        if (y !== undefined) {
            this.y = y;
        }
    }
    curMaxSpeed() {
        if (this.tabPressed) {
            return this.maxAfterburnerVelocity;
        }
        else {
            return this.maxSetSpeed;
        }
    }
    getSpeed() {
        return Math.sqrt((this.xVelocity * this.xVelocity) + (this.yVelocity * this.yVelocity));
    }
    getDirectionX() {
        return Math.cos(toRadians(this.angle));
    }
    getDirectionY() {
        return Math.sin(toRadians(this.angle));
    }
    getLeftDirectionX() {
        return Math.cos(toRadians(this.angle + 90));
    }
    getLeftDirectionY() {
        return Math.sin(toRadians(this.angle + 90));
    }
    getRightDirectionX() {
        return Math.cos(toRadians(this.angle - 90));
    }
    getRightDirectionY() {
        return Math.sin(toRadians(this.angle - 90));
    }
    getBackDirectionX() {
        return Math.cos(toRadians(this.angle - 180));
    }
    getBackDirectionY() {
        return Math.sin(toRadians(this.angle - 180));
    }
    draw(camera) {
        ctx.save();
        ctx.translate(this.x - camera.cameraX[0] + canvas.width / 2, this.y - camera.cameraY[0] + canvas.height / 2);
        ctx.rotate(Math.PI / 2);
        ctx.rotate(toRadians(this.angle));
        ctx.drawImage(this.sprite, 0, 0, this.sprite.width, this.sprite.height, -this.sprite.width / 2 * this.size, -this.sprite.height / 2 * this.size, this.sprite.width * this.size, this.sprite.height * this.size);
        let sizeShield = this.size / 2;
        if (this.shieldTime > 0 && (this.shieldTime % 3 == 1)) {
            ctx.drawImage(this.spriteShield, 0, 0, this.spriteShield.width, this.spriteShield.height, -this.spriteShield.width / 2 * sizeShield, -this.spriteShield.height / 2 * sizeShield, this.spriteShield.width * sizeShield, this.spriteShield.height * sizeShield);
        }
        ctx.restore();
    }
    update() {
        this.shieldTime--;
        let isAlive = true;
        if (this.getSpeed() >= this.curMaxSpeed()) {
            let ratio = this.getSpeed() / this.curMaxSpeed();
            //((player().getSpeed() - player().curMaxSpeed()) / 1.01) + player().curMaxSpeed()
            this.xVelocity /= ratio;
            this.yVelocity /= ratio;
        }
        this.energy += this.energyRegeneration;
        if (this.energy < 0) {
            this.energy = 0;
        }
        if (this.energy > this.maxEnergy) {
            this.energy = this.maxEnergy;
        }
        if (this.energy >= this.shieldRegenerationcost && this.shields < this.shieldsMax) {
            this.energy -= this.shieldRegenerationcost;
            this.shields += this.shieldRegeneration;
        }
        if (this.shields > this.shieldsMax) {
            this.shields = this.shieldsMax;
        }
        this.x += this.xVelocity;
        this.y += this.yVelocity;
        this.angle += this.angleSpeed;
        for (var i = laser.laserX.length - 1; i >= 0; i--) {
            if (dist(laser.laserX[i], laser.laserY[i], this.x, this.y) >= laser.damageArea2 && dist(laser.laserX[i], laser.laserY[i], this.x, this.y) < laser.damageArea1 && laser.laserEntityStartId[i] !== this) {
                this.shields -= 10;
                this.shieldTime = 20;
                this.lastHitBy = laser.laserEntityStartId[i];
                if (0 >= this.shields) {
                    isAlive = false;
                }
                popList2Position(laser.allProperties, i);
            }
        }
        if (isAlive === false) {
            boom.createBoom(this.x, this.y);
        }
        return isAlive;
    }
    steerToward(targetX, targetY, turnRate) {
        let targetAngle = (Math.atan2(targetY - this.y, targetX - this.x) * 180 / Math.PI + 360) % 360;
        //let targetAngle2 = targetAngle+360
        let myAngle = (this.angle + 360) % 360;
        //let myAngle2 = myAngle + 360
        let diff = targetAngle - myAngle;
        if (diff >= 180) {
            diff -= 360;
        }
        if (diff < -180) {
            diff += 360;
        }
        if (diff > 0) {
            this.angle += turnRate;
        }
        else {
            this.angle -= turnRate;
        }
    }
    cruise(throttle) {
        this.xVelocity = this.maxSetSpeed * Math.cos(toRadians(this.angle)) * NPC_CRUISE * this.speedFactor * throttle;
        this.yVelocity = this.maxSetSpeed * Math.sin(toRadians(this.angle)) * NPC_CRUISE * this.speedFactor * throttle;
    }
    /** Combat: chase the target, firing only near its screen. */
    ai(targetX, targetY) {
        this.steerToward(targetX, targetY, 1);
        if (dist(targetX, targetY, this.x, this.y) < NPC_SHOOT_RANGE) {
            shoot(this);
        }
        this.cruise(1);
    }
    /** Incoming fire: break hard off the shot's path, jinking as we go. */
    evade(dirX, dirY, side) {
        const evadeAngle = Math.atan2(dirY, dirX) * 180 / Math.PI + 90 * side;
        this.steerToward(this.x + Math.cos(toRadians(evadeAngle)) * 100, this.y + Math.sin(toRadians(evadeAngle)) * 100, 3);
        this.angle += (Math.random() - 0.5) * 2; // jink
        this.cruise(1);
    }
    /** Off duty: head back to the home base and patrol a lazy circle there. */
    loiter() {
        const b = bases[this.homeBase % bases.length];
        if (dist(b.x, b.y, this.x, this.y) > NPC_LOITER_RADIUS) {
            this.steerToward(b.x, b.y, 1);
        }
        else {
            this.angle += 0.5;
            // after ~25s of patrolling, wander off to haunt a different base, so no
            // trade lane stays permanently safe
            if (Math.random() < 0.0007) {
                this.homeBase = pirateWanderBase();
            }
        }
        this.cruise(0.6);
    }
}
let camera = new Camera();
function player() {
    return ships[0];
}
let ships = [new Ship("https://graphics.stanford.edu/~danielh/sprites/Orion.png", 320, 240), new Ship("https://graphics.stanford.edu/~danielh/sprites/Talon_-_Pirate.png", 300, 120), new Ship("https://graphics.stanford.edu/~danielh/sprites/Talon_-_Pirate.png", 400, 320)];
let boom = new Boom(boom_urls);
let laser = new Lasers(["https://graphics.stanford.edu/~danielh/sprites/BallRed.png"]);
let asteroids = new Asteroids("https://graphics.stanford.edu/~danielh/sprites/Asteroid1.png");
let starList = ["https://graphics.stanford.edu/~danielh/sprites/Star2.png", "https://graphics.stanford.edu/~danielh/sprites/Star2.png", "https://graphics.stanford.edu/~danielh/sprites/Star2.png", "https://graphics.stanford.edu/~danielh/sprites/Star2.png", "https://graphics.stanford.edu/~danielh/sprites/Star5.png", "https://graphics.stanford.edu/~danielh/sprites/Star3.png", "https://graphics.stanford.edu/~danielh/sprites/Star3.png"];
let stars = new Stars(starList);
////////////////// seeded landmarks /////////////////////
// Same fixed seed on every client, so the bases are in the same place for
// everyone with zero network traffic.
const bases = P.generateBases();
const baseSprites = P.BASE_SPRITES.map((name) => {
    const img = new Image();
    img.src = P.SPRITE_BASE + name;
    return img;
});
//////////////// Handle Keyboard ///////////////////////
canvas.onkeydown = function (e) {
    if (e.key == "a" || e.key == "ArrowLeft") {
        player().leftPressed = true;
    }
    if (e.key == "d" || e.key == "ArrowRight") {
        player().rightPressed = true;
    }
    if (e.key == "w" || e.key == "ArrowUp") {
        player().upPressed = true;
    }
    if (e.key == "s" || e.key == "ArrowDown") {
        player().downPressed = true;
    }
    if (e.key == "Tab") {
        player().tabPressed = true;
    }
    if (e.key == " ") {
        player().spacePressed = true;
    }
    if (e.key == "t" || e.key == "T") {
        buyCargo(); // key auto-repeat makes holding T buy quickly
    }
    e.preventDefault();
};
function changeCanvasSize() {
    if (canvas.width == origWidth) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    else {
        canvas.width = origWidth;
        canvas.height = origHeight;
    }
    stars = new Stars(starList);
}
window.addEventListener("resize", () => {
    if (canvas.width !== origWidth) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        stars = new Stars(starList);
    }
});
canvas.onkeyup = function (e) {
    if (e.key == "a" || e.key == "ArrowLeft") {
        player().leftPressed = false;
    }
    if (e.key == "d" || e.key == "ArrowRight") {
        player().rightPressed = false;
    }
    if (e.key == "w" || e.key == "ArrowUp") {
        player().upPressed = false;
    }
    if (e.key == "s" || e.key == "ArrowDown") {
        player().downPressed = false;
    }
    if (e.key == "Tab") {
        player().tabPressed = false;
    }
    if (e.key == " ") {
        player().spacePressed = false;
    }
    if (e.key == "l" || e.key == "L") {
        toggleDock();
    }
    if (e.key == "b" || e.key == "B") {
        setBotMode(!botMode);
    }
    if (e.key == "1" || e.key == "2" || e.key == "3") {
        buyUpgrade(Number(e.key));
    }
    if (e.key == "F10") {
        if (canvas.width == origWidth) {
            canvas.requestFullscreen().then(changeCanvasSize).catch(changeCanvasSize);
        }
        else {
            changeCanvasSize();
            document.exitFullscreen().catch(() => { });
        }
    }
    if (e.key == "F11") {
        if (canvas.style.height != window.innerHeight + "px") {
            canvas.requestFullscreen();
            //canvas.style.width = window.innerWidth + "px";
            canvas.style.height = window.innerHeight + "px";
        }
        else {
            //canvas.style.width = "";
            canvas.style.height = "";
        }
    }
    e.preventDefault();
};
function shoot(ship) {
    if (Date.now() - ship.lastShot > 275 && ship.energy >= ship.shotEnergyCost) {
        ship.energy -= ship.shotEnergyCost;
        let xVelocity = ship.xVelocity + (laser.velocity * (Math.cos(ship.angle * Math.PI / 180)));
        let yVelocity = ship.yVelocity + (laser.velocity * (Math.sin(ship.angle * Math.PI / 180)));
        laser.createlaser(ship, ship.x + ship.getRightDirectionX() * 10, ship.y + ship.getRightDirectionY() * 10, xVelocity, yVelocity);
        laser.createlaser(ship, ship.x + ship.getLeftDirectionX() * 10, ship.y + ship.getLeftDirectionY() * 10, xVelocity, yVelocity);
        ship.lastShot = Date.now();
    }
}
////////////////// multiplayer (lobbylink) //////////////////
// Trust model mirrors DartRoids (../../PROTOCOL.md): everyone simulates and
// broadcasts their own ship + lasers best-effort; the *victim* of a laser hit
// is authoritative for its own shields and reports the hit on the reliable
// channel; the lowest-id connected player hosts the NPC pirates.
const $ = (id) => document.getElementById(id);
const hud = $("hud");
const toastEl = $("toast");
const mpBtn = $("mp");
const mpMenu = $("mpMenu");
let net = null;
let selfSlot = 0;
let myName = "pilot";
let myShipIdx = 0;
let sendSeq = 0;
let npcSeq = 0;
let sendAcc = 0;
let joinedAt = 0;
let wasHost = false;
let deadUntil = 0;
let nextNpcId = 1;
let nextPirateSpawnAt = 0;
let toastUntil = 0;
let myScore = 0; // kills + pirate bounties; broadcast in STATE, kept client-side
let dockedBase = null;
const NPC_TARGET_COUNT = 8; // == protocol MAX_NPCS, the NPC-message cap
// Index-aligned with P.PIRATE_SPRITES: speed scales the cruise velocity,
// heavier hulls carry more shields, and tougher marks pay a bigger bounty.
const PIRATE_STATS = [
    { speed: 1.0, shields: 200, bounty: 55 }, // Talon - Pirate
    { speed: 1.1, shields: 160, bounty: 45 }, // Talon - Retro
    { speed: 1.35, shields: 120, bounty: 60 }, // Demon: fast and fragile
    { speed: 0.9, shields: 260, bounty: 75 }, // Gothri
    { speed: 1.15, shields: 150, bounty: 50 }, // Dralthi
    { speed: 0.6, shields: 420, bounty: 120 }, // Kamekh: slow gunboat
];
function pirateBounty(sprite) {
    return PIRATE_STATS[sprite % PIRATE_STATS.length].bounty;
}
function pirateSprite(idx) {
    return P.SPRITE_BASE + P.PIRATE_SPRITES[idx % P.PIRATE_SPRITES.length];
}
const remotes = new Map();
const remoteNpcs = new Map();
let npcLasers = [];
let npcLasersFrom = -1; // slot the NPC broadcast came from (the host)
let lastNpcRecv = 0;
let npcStateSeq = 0;
let npcStateHasSeq = false;
// Lasers that already hit something, keyed by (owner slot, laser id): never
// damage, and never draw, the same laser twice.
const consumedLasers = new Set();
function laserKey(slot, id) {
    return slot * 0x10000 + id;
}
function consumeLaser(slot, id) {
    consumedLasers.add(laserKey(slot, id));
    if (consumedLasers.size > 512) {
        for (const k of consumedLasers) {
            consumedLasers.delete(k);
            if (consumedLasers.size <= 256)
                break;
        }
    }
}
function netActive() {
    return net !== null;
}
function hostSlot() {
    if (!net)
        return -1;
    let low = selfSlot;
    for (const p of net.players) {
        if (p.occupied && p.connected && p.id < low)
            low = p.id;
    }
    return low;
}
function isHost() {
    return netActive() && hostSlot() === selfSlot;
}
function broadcastReliable(bytes) {
    if (!net)
        return;
    for (const p of net.players) {
        if (p.occupied && p.id !== selfSlot)
            net.sendReliable(p.id, bytes).catch(() => { });
    }
}
function broadcastDamage(d) {
    broadcastReliable(P.encodeDamage(d));
}
function myWireLasers() {
    const out = [];
    for (let i = 0; i < laser.laserX.length; i++) {
        if (laser.laserEntityStartId[i] !== player())
            continue;
        out.push({ id: laser.laserId[i], x: laser.laserX[i], y: laser.laserY[i], vx: laser.laserVelocityX[i], vy: laser.laserVelocityY[i] });
    }
    return out;
}
function npcWireLasers() {
    const out = [];
    for (let i = 0; i < laser.laserX.length; i++) {
        if (laser.laserEntityStartId[i] === player())
            continue;
        out.push({ id: laser.laserId[i], x: laser.laserX[i], y: laser.laserY[i], vx: laser.laserVelocityX[i], vy: laser.laserVelocityY[i] });
    }
    return out;
}
function dieMp(shooterSlot, laserId, npcLaser, boomAlready) {
    const p = player();
    if (!p.alive)
        return;
    p.alive = false;
    deadUntil = performance.now() + P.RESPAWN_DELAY_MS;
    if (!boomAlready)
        boom.createBoom(p.x, p.y);
    broadcastDamage({ died: true, npcLaser, shooterSlot, laserId, shieldsAfter: 0, x: p.x, y: p.y });
    if (cargoUnits > 0) {
        showToast(`your ship was destroyed — ${cargoUnits} ${P.COMMODITIES[cargoType].name} lost to the void`);
        cargoUnits = 0;
        cargoType = -1;
    }
    else {
        showToast("your ship was destroyed — respawning…");
    }
}
//////////// trading ///////////////////
// Buy a commodity at its home base type (T while docked), fly it to the base
// type that wants it, and docking auto-sells the load. Credits and cargo are
// client-side, like scores. Death jettisons the hold — pirates matter.
let credits = P.START_CREDITS;
let cargoType = -1; // index into P.COMMODITIES, -1 = empty hold
let cargoUnits = 0;
/** The commodity sold at this base type, or -1. */
function localCommodity(baseSprite) {
    for (let i = 0; i < P.COMMODITIES.length; i++) {
        if (P.COMMODITIES[i].buyAt === baseSprite)
            return i;
    }
    return -1;
}
function buyCargo() {
    if (!player().docked || !dockedBase)
        return;
    const ci = localCommodity(dockedBase.sprite);
    if (ci < 0)
        return;
    const c = P.COMMODITIES[ci];
    if (cargoUnits > 0 && cargoType !== ci) {
        showToast(`hold carries ${P.COMMODITIES[cargoType].name} — deliver that first`);
        return;
    }
    if (cargoUnits >= cargoCapacity()) {
        showToast("cargo hold is full");
        return;
    }
    if (credits < c.buyPrice) {
        showToast("not enough credits");
        return;
    }
    credits -= c.buyPrice;
    cargoType = ci;
    cargoUnits++;
    showToast(`bought ${c.name} ${cargoUnits}/${cargoCapacity()} — ₡${credits} left`, 1200);
}
/** Sell the hold if this base wants it; returns the toast line for docking. */
function sellCargoAt(b) {
    if (cargoUnits > 0 && P.COMMODITIES[cargoType].sellAt === b.sprite) {
        const c = P.COMMODITIES[cargoType];
        const earned = cargoUnits * c.sellPrice;
        credits += earned;
        const line = `docked at ${b.name} — sold ${cargoUnits} ${c.name} for ₡${earned}`;
        cargoUnits = 0;
        cargoType = -1;
        return line;
    }
    return `docked at ${b.name} — repairing`;
}
//////////// upgrades (bought at Foundries) ///////////////////
// The credit sink: while docked at a Foundry, keys 1/2/3 buy permanent (per
// session) ship upgrades. Client-side, like credits and cargo.
const FOUNDRY = 3; // BASE_SPRITES index of Industrial.png
const HOLD_PRICES = [300, 700, 1500]; // +10 cargo capacity per level
const SHIELD_PRICES = [400, 900, 2000]; // +100 max shields per level
const ENGINE_PRICES = [350, 800, 1800]; // +10% speed and thrust per level
let holdLevel = 0;
let shieldLevel = 0;
let engineLevel = 0;
function cargoCapacity() {
    return P.CARGO_CAPACITY + 10 * holdLevel;
}
function buyUpgrade(track) {
    const p = player();
    if (!p.docked || !dockedBase || dockedBase.sprite !== FOUNDRY)
        return;
    const level = track === 1 ? holdLevel : track === 2 ? shieldLevel : engineLevel;
    const prices = track === 1 ? HOLD_PRICES : track === 2 ? SHIELD_PRICES : ENGINE_PRICES;
    if (level >= prices.length) {
        showToast("that system is fully upgraded");
        return;
    }
    const price = prices[level];
    if (credits < price) {
        showToast(`not enough credits — ₡${price} needed`);
        return;
    }
    credits -= price;
    if (track === 1) {
        holdLevel++;
        showToast(`cargo hold expanded to ${cargoCapacity()} units`);
    }
    else if (track === 2) {
        shieldLevel++;
        p.shieldsMax += 100;
        showToast(`shield capacitor upgraded — max ${p.shieldsMax}`);
    }
    else {
        engineLevel++;
        p.maxSetSpeed *= 1.1;
        p.maxAfterburnerVelocity *= 1.1;
        p.acceleration *= 1.1;
        p.afterburnerAcceleration *= 1.1;
        showToast("engines tuned — +10% speed and thrust");
    }
}
function upgradePromptLine() {
    const p = player();
    const parts = [
        holdLevel < HOLD_PRICES.length ? `[1] hold ${cargoCapacity()}→${cargoCapacity() + 10} ₡${HOLD_PRICES[holdLevel]}` : "[1] hold maxed",
        shieldLevel < SHIELD_PRICES.length ? `[2] shields ${p.shieldsMax}→${p.shieldsMax + 100} ₡${SHIELD_PRICES[shieldLevel]}` : "[2] shields maxed",
        engineLevel < ENGINE_PRICES.length ? `[3] engines +10% ₡${ENGINE_PRICES[engineLevel]}` : "[3] engines maxed",
    ];
    return parts.join("  ·  ");
}
/** The nearest base within docking distance of the player, if any. */
function dockableBase() {
    const p = player();
    let best = null;
    let bestD = Infinity;
    for (const b of bases) {
        const d = dist(b.x, b.y, p.x, p.y);
        if (d < bestD) {
            bestD = d;
            best = b;
        }
    }
    return bestD <= DOCK_RANGE ? best : null;
}
function toggleDock() {
    const p = player();
    if (!p.alive)
        return;
    if (p.docked) {
        p.docked = false;
        dockedBase = null;
        showToast("launched — good hunting");
        return;
    }
    const b = dockableBase();
    if (b) {
        p.docked = true;
        dockedBase = b;
        p.xVelocity = 0;
        p.yVelocity = 0;
        p.angleSpeed = 0;
        p.shieldTime = 0;
        showToast(sellCargoAt(b));
    }
}
function respawnMp() {
    const p = player();
    p.alive = true;
    p.docked = false;
    dockedBase = null;
    p.shields = p.shieldsMax;
    p.energy = p.maxEnergy;
    p.shieldTime = 0;
    p.xVelocity = 0;
    p.yVelocity = 0;
    p.angleSpeed = 0;
    // come back near a landmark so lost pilots can regroup ("meet at Refinery 4")
    const b = bases[Math.floor(Math.random() * bases.length)];
    const ang = Math.random() * Math.PI * 2;
    const d = 150 + Math.random() * 250;
    p.x = b.x + Math.cos(ang) * d;
    p.y = b.y + Math.sin(ang) * d;
}
/** A remote laser hit me: I am authoritative, so damage myself and tell the room. */
function applyRemoteHit(shooterSlot, laserId, npcLaser) {
    const p = player();
    p.shields -= P.LASER_DAMAGE;
    p.shieldTime = 20;
    if (!npcLaser) {
        // remember who to shoot back at (the autopilot holds a 20 s grudge)
        lastAggressor = shooterSlot;
        aggressorUntil = performance.now() + 20000;
    }
    if (p.shields <= 0) {
        dieMp(shooterSlot, laserId, npcLaser, false);
    }
    else {
        broadcastDamage({ died: false, npcLaser, shooterSlot, laserId, shieldsAfter: p.shields, x: p.x, y: p.y });
    }
}
/** Fixed-rate networking work: collisions between wire lasers and local ships. */
function netStep() {
    if (!net)
        return;
    const now = performance.now();
    const p = player();
    for (const r of remotes.values())
        if (r.ship.shieldTime > 0)
            r.ship.shieldTime--;
    for (const n of remoteNpcs.values())
        if (n.ship.shieldTime > 0)
            n.ship.shieldTime--;
    // remote players' lasers vs my ship (docked ships are safe in the hangar)
    if (p.alive && !p.docked) {
        outer: for (const [slot, r] of remotes) {
            const age = Math.min((now - r.lastRecv) / 1000, 0.4);
            for (const l of r.lasers) {
                if (consumedLasers.has(laserKey(slot, l.id)))
                    continue;
                const d = dist(l.x + l.vx * 60 * age, l.y + l.vy * 60 * age, p.x, p.y);
                if (d >= laser.damageArea2 && d < laser.damageArea1) {
                    consumeLaser(slot, l.id);
                    applyRemoteHit(slot, l.id, false);
                    if (!p.alive)
                        break outer;
                }
            }
        }
    }
    // the host's pirate lasers vs my ship (the host's own copy lives in its
    // local pool and is handled by Ship.update there)
    if (p.alive && !p.docked && npcLasersFrom >= 0 && npcLasersFrom !== selfSlot) {
        const age = Math.min((now - lastNpcRecv) / 1000, 0.4);
        for (const l of npcLasers) {
            if (consumedLasers.has(laserKey(npcLasersFrom, l.id)))
                continue;
            const d = dist(l.x + l.vx * 60 * age, l.y + l.vy * 60 * age, p.x, p.y);
            if (d >= laser.damageArea2 && d < laser.damageArea1) {
                consumeLaser(npcLasersFrom, l.id);
                applyRemoteHit(npcLasersFrom, l.id, true);
                if (!p.alive)
                    break;
            }
        }
    }
    // My lasers vs the host's NPCs: retire and report the hit reliably — the
    // report IS the damage path, so it fires on contact, however fresh the shot.
    // My lasers vs remote ships: purely cosmetic retirement, and only once the
    // laser has flown long enough (> one send interval) to have been broadcast;
    // eating it at birth would mean the victim — the damage authority — never
    // receives it, making point-blank shots do nothing.
    for (let i = laser.laserX.length - 1; i >= 0; i--) {
        if (laser.laserEntityStartId[i] !== p)
            continue;
        const lx = laser.laserX[i], ly = laser.laserY[i];
        let hit = false;
        if (!isHost()) {
            for (const [id, n] of remoteNpcs) {
                const d = dist(lx, ly, n.px, n.py);
                if (d >= laser.damageArea2 && d < laser.damageArea1) {
                    hit = true;
                    n.ship.shieldTime = 20; // predict the flash; the host applies the damage
                    const h = hostSlot();
                    if (h >= 0 && h !== selfSlot)
                        net.sendReliable(h, P.encodeNpcDamage(id, P.LASER_DAMAGE)).catch(() => { });
                    break;
                }
            }
        }
        if (!hit && dist(laser.laserStartX[i], laser.laserStartY[i], lx, ly) > 100) {
            for (const r of remotes.values()) {
                if (!r.alive || r.docked)
                    continue;
                const d = dist(lx, ly, r.px, r.py);
                if (d >= laser.damageArea2 && d < laser.damageArea1) {
                    hit = true;
                    break;
                }
            }
        }
        if (hit)
            popList2Position(laser.allProperties, i);
    }
}
function shortestDeg(d) {
    return ((d % 360) + 540) % 360 - 180;
}
/**
 * Will this laser cross within dodging distance of (sx, sy)? Returns the
 * shot's direction and which side the ship sits on, so it can break away.
 */
function laserThreat(sx, sy, lx, ly, lvx, lvy) {
    const rx = sx - lx;
    const ry = sy - ly;
    if (rx * rx + ry * ry > 500 * 500)
        return null;
    const sp = Math.hypot(lvx, lvy);
    if (sp < 0.001)
        return null;
    if (rx * lvx + ry * lvy < 0)
        return null; // flying away from the ship
    const miss = (lvx * ry - lvy * rx) / sp; // signed miss distance off the path
    if (Math.abs(miss) > 80)
        return null;
    return { dirX: lvx / sp, dirY: lvy / sp, side: miss >= 0 ? 1 : -1 };
}
/** First incoming laser threatening this ship (local pool + remote shots). */
function laserThreatTo(ship) {
    for (let i = 0; i < laser.laserX.length; i++) {
        if (laser.laserEntityStartId[i] === ship)
            continue;
        const t = laserThreat(ship.x, ship.y, laser.laserX[i], laser.laserY[i], laser.laserVelocityX[i], laser.laserVelocityY[i]);
        if (t)
            return t;
    }
    if (!netActive())
        return null;
    const now = performance.now();
    for (const [slot, r] of remotes) {
        const age = Math.min((now - r.lastRecv) / 1000, 0.4);
        for (const l of r.lasers) {
            if (consumedLasers.has(laserKey(slot, l.id)))
                continue;
            const t = laserThreat(ship.x, ship.y, l.x + l.vx * 60 * age, l.y + l.vy * 60 * age, l.vx, l.vy);
            if (t)
                return t;
        }
    }
    return null;
}
/** Dead-reckon to the latest snapshot and ease the rendered pose toward it. */
function easeRemote(r, dt, now) {
    const age = Math.min((now - r.lastRecv) / 1000, 0.4);
    const tx = r.x + r.vx * 60 * age;
    const ty = r.y + r.vy * 60 * age;
    const ta = r.angle + r.angleSpeed * 60 * age;
    const k = Math.min(1, dt * 12);
    r.px += (tx - r.px) * k;
    r.py += (ty - r.py) * k;
    r.pa += shortestDeg(ta - r.pa) * k;
}
function spawnPirate() {
    // pirates haunt the trade lanes: spawn at (and loiter around) a random base
    const home = Math.floor(Math.random() * bases.length);
    const anchor = bases[home];
    const ang = Math.random() * Math.PI * 2;
    const d = 300 + Math.random() * 300;
    const idx = Math.floor(Math.random() * P.PIRATE_SPRITES.length);
    const stats = PIRATE_STATS[idx % PIRATE_STATS.length];
    const pirate = new Ship(pirateSprite(idx), anchor.x + Math.cos(ang) * d, anchor.y + Math.sin(ang) * d);
    pirate.npcId = nextNpcId++ & 0xff;
    pirate.npcSprite = idx;
    pirate.homeBase = home;
    pirate.speedFactor = stats.speed;
    pirate.shieldsMax = stats.shields;
    pirate.shields = stats.shields;
    ships.push(pirate);
}
/** I am now the lowest-id player: adopt the NPCs I last saw (or spawn fresh). */
function becomeHost(now) {
    for (const [id, n] of remoteNpcs) {
        const stats = PIRATE_STATS[n.sprite % PIRATE_STATS.length];
        const pirate = new Ship(pirateSprite(n.sprite), n.px, n.py);
        pirate.npcId = id;
        pirate.npcSprite = n.sprite;
        pirate.homeBase = Math.floor(Math.random() * bases.length); // not on the wire; any base will do
        pirate.speedFactor = stats.speed;
        pirate.shieldsMax = stats.shields;
        pirate.angle = n.pa;
        pirate.xVelocity = n.vx;
        pirate.yVelocity = n.vy;
        pirate.shields = n.shields;
        ships.push(pirate);
        if (id >= nextNpcId)
            nextNpcId = id + 1;
    }
    remoteNpcs.clear();
    npcLasers = [];
    while (ships.length - 1 < NPC_TARGET_COUNT)
        spawnPirate();
    nextPirateSpawnAt = now + 10000;
    showToast("you are hosting the pirates now");
}
/** A lower-id player owns the NPCs now: drop my local pirates and their lasers. */
function resignHost() {
    ships.splice(1);
    for (let i = laser.laserX.length - 1; i >= 0; i--) {
        if (laser.laserEntityStartId[i] !== player())
            popList2Position(laser.allProperties, i);
    }
}
function sendState() {
    if (!net)
        return;
    const pl = player();
    net.broadcastBestEffort(P.encodeState({
        seq: sendSeq++ & 0xffff,
        alive: pl.alive,
        flash: pl.shieldTime > 0,
        docked: pl.docked,
        x: pl.x, y: pl.y,
        angle: pl.angle, angleSpeed: pl.angleSpeed,
        vx: pl.xVelocity, vy: pl.yVelocity,
        shields: pl.shields,
        score: myScore,
        ship: myShipIdx,
        lasers: myWireLasers(),
        name: myName,
    }));
}
function sendNpc() {
    if (!net)
        return;
    const shipsOut = [];
    for (let i = 1; i < ships.length; i++) {
        const s = ships[i];
        shipsOut.push({ id: s.npcId, flash: s.shieldTime > 0, sprite: s.npcSprite, x: s.x, y: s.y, angle: s.angle, vx: s.xVelocity, vy: s.yVelocity, shields: s.shields });
    }
    net.broadcastBestEffort(P.encodeNpc({ seq: npcSeq++ & 0xffff, ships: shipsOut, lasers: npcWireLasers() }));
}
/** Per-render-frame networking: leadership, easing, timeouts, respawn, sends. */
function netFrame(dt) {
    if (!net)
        return;
    const now = performance.now();
    // Leadership: a fresh joiner waits HOST_GRACE_MS so an existing host's NPC
    // broadcast can arrive and be adopted instead of spawning a parallel world.
    const hosting = isHost() && now - joinedAt > P.HOST_GRACE_MS;
    if (hosting && !wasHost)
        becomeHost(now);
    if (!hosting && wasHost)
        resignHost();
    wasHost = hosting;
    if (hosting && ships.length - 1 < NPC_TARGET_COUNT && now >= nextPirateSpawnAt) {
        spawnPirate();
        nextPirateSpawnAt = now + 10000;
    }
    for (const [slot, r] of remotes) {
        if (now - r.lastRecv > P.REMOTE_TIMEOUT_MS) {
            remotes.delete(slot);
            continue;
        }
        easeRemote(r, dt, now);
    }
    for (const n of remoteNpcs.values())
        easeRemote(n, dt, now);
    if (remoteNpcs.size > 0 && now - lastNpcRecv > P.REMOTE_TIMEOUT_MS)
        remoteNpcs.clear();
    if (!player().alive && now >= deadUntil)
        respawnMp();
    sendAcc += dt;
    if (sendAcc >= 1 / P.SEND_HZ) {
        sendAcc = 0;
        sendState();
        if (hosting)
            sendNpc();
    }
}
function onState(from, s) {
    let r = remotes.get(from);
    if (!r) {
        r = {
            ship: new Ship(P.SPRITE_BASE + P.SHIP_SPRITES[s.ship % P.SHIP_SPRITES.length], s.x, s.y),
            name: s.name, shipIdx: s.ship, alive: s.alive, docked: s.docked, score: s.score,
            x: s.x, y: s.y, angle: s.angle, angleSpeed: s.angleSpeed, vx: s.vx, vy: s.vy,
            px: s.x, py: s.y, pa: s.angle,
            shields: s.shields, lasers: s.lasers, lastRecv: performance.now(), seq: s.seq,
        };
        remotes.set(from, r);
        return;
    }
    if (!P.seqNewer(s.seq, r.seq))
        return;
    r.x = s.x;
    r.y = s.y;
    r.angle = s.angle;
    r.angleSpeed = s.angleSpeed;
    r.vx = s.vx;
    r.vy = s.vy;
    r.alive = s.alive;
    r.docked = s.docked;
    r.score = s.score;
    r.shields = s.shields;
    r.name = s.name;
    r.lasers = s.lasers;
    r.lastRecv = performance.now();
    r.seq = s.seq;
    if (s.flash && r.ship.shieldTime <= 0)
        r.ship.shieldTime = 20;
    if (s.ship !== r.shipIdx) {
        r.shipIdx = s.ship;
        const img = new Image();
        img.src = P.SPRITE_BASE + P.SHIP_SPRITES[s.ship % P.SHIP_SPRITES.length];
        r.ship.sprite = img;
    }
}
function onDamage(from, d) {
    if (d.laserId !== P.NO_ID) {
        consumeLaser(d.shooterSlot, d.laserId); // never draw or re-apply that laser
        if (d.shooterSlot === selfSlot) {
            for (let i = laser.laserX.length - 1; i >= 0; i--) {
                if (laser.laserId[i] === d.laserId) {
                    popList2Position(laser.allProperties, i);
                    break;
                }
            }
        }
    }
    const r = remotes.get(from);
    if (r) {
        r.shields = d.shieldsAfter;
        r.ship.shieldTime = 20;
        if (d.died)
            r.alive = false;
    }
    if (d.died) {
        boom.createBoom(d.x, d.y);
        if (d.shooterSlot === selfSlot && !d.npcLaser) {
            myScore++;
            showToast(`you shot down ${r?.name ?? "a pilot"} — +1`);
        }
    }
}
function onNpcState(from, m) {
    if (from !== hostSlot() || isHost())
        return; // only the current host is authoritative
    if (npcStateHasSeq && from === npcLasersFrom && !P.seqNewer(m.seq, npcStateSeq))
        return;
    npcStateSeq = m.seq;
    npcStateHasSeq = true;
    const now = performance.now();
    const seen = new Set();
    for (const s of m.ships) {
        seen.add(s.id);
        let n = remoteNpcs.get(s.id);
        if (!n) {
            n = {
                ship: new Ship(pirateSprite(s.sprite), s.x, s.y), sprite: s.sprite,
                x: s.x, y: s.y, angle: s.angle, angleSpeed: 0, vx: s.vx, vy: s.vy,
                px: s.x, py: s.y, pa: s.angle,
                shields: s.shields, lastRecv: now,
            };
            remoteNpcs.set(s.id, n);
        }
        else {
            n.x = s.x;
            n.y = s.y;
            n.angle = s.angle;
            n.vx = s.vx;
            n.vy = s.vy;
            n.shields = s.shields;
            n.lastRecv = now;
            if (n.sprite !== s.sprite) {
                n.sprite = s.sprite;
                const img = new Image();
                img.src = pirateSprite(s.sprite);
                n.ship.sprite = img;
            }
        }
        if (s.flash && n.ship.shieldTime <= 0)
            n.ship.shieldTime = 20;
    }
    for (const [id, n] of remoteNpcs) {
        if (!seen.has(id)) {
            boom.createBoom(n.px, n.py); // it was in the last snapshot: it blew up
            remoteNpcs.delete(id);
        }
    }
    npcLasers = m.lasers;
    npcLasersFrom = from;
    lastNpcRecv = now;
}
function onNpcDamage(from, m) {
    if (!isHost() || !net)
        return;
    for (let i = 1; i < ships.length; i++) {
        if (ships[i].npcId === m.npcId) {
            ships[i].shields -= m.damage;
            ships[i].shieldTime = 20;
            if (ships[i].shields <= 0) {
                const sprite = ships[i].npcSprite;
                boom.createBoom(ships[i].x, ships[i].y);
                ships.splice(i, 1);
                // the reporter landed the killing blow: pay the bounty
                net.sendReliable(from, P.encodeNpcKill(m.npcId, sprite)).catch(() => { });
            }
            return;
        }
    }
}
function onNpcKill(m) {
    myScore++;
    credits += pirateBounty(m.sprite);
    showToast(`pirate bounty +1 · ₡${pirateBounty(m.sprite)}`);
}
function onNet(ev) {
    switch (ev.type) {
        case "message": {
            const msg = P.decode(ev.data);
            if (!msg)
                return;
            if (msg.kind === "state")
                onState(ev.from, msg);
            else if (msg.kind === "damage")
                onDamage(ev.from, msg);
            else if (msg.kind === "npc")
                onNpcState(ev.from, msg);
            else if (msg.kind === "npc-damage")
                onNpcDamage(ev.from, msg);
            else if (msg.kind === "npc-kill")
                onNpcKill(msg);
            break;
        }
        case "player-left":
            remotes.delete(ev.playerId);
            showToast(`pilot in slot ${ev.playerId} left`);
            break;
        case "player-joined":
            showToast(`a pilot joined slot ${ev.playerId}`);
            break;
        case "signaling-closed":
            showToast("signaling closed: " + ev.code);
            if (ev.code === "replaced" || ev.code === "session-superseded" || ev.code === "room-expired")
                leaveMp();
            break;
        default:
            break;
    }
}
async function resolveServer(configured) {
    if (configured)
        return configured;
    try {
        const cfg = await (await fetch("./config.json")).json();
        if (cfg.wsUrl)
            return cfg.wsUrl;
    }
    catch {
        /* not served by the Go server; fall through */
    }
    return "https://pqrstuvw.xyz/lobbylink";
}
async function connectMp() {
    const code = $("code").value.trim() || "TARSUS";
    myName = ($("name").value.trim() || "pilot").slice(0, 24);
    const server = await resolveServer($("server").value.trim());
    location.hash = code;
    showToast(`connecting to ${server} …`);
    let g;
    try {
        g = await P2PGame.connect({
            server, code,
            create: { maxPlayers: 16, waitUntilFull: false },
            storageKey: "tarsus-" + code,
            storage: "session",
        });
    }
    catch (err) {
        showToast("connect failed: " + String(err));
        return;
    }
    net = g;
    selfSlot = g.selfId;
    myShipIdx = selfSlot % P.SHIP_SPRITES.length;
    const img = new Image();
    img.src = P.SPRITE_BASE + P.SHIP_SPRITES[myShipIdx];
    player().sprite = img;
    g.onEvent(onNet);
    joinedAt = performance.now();
    wasHost = false;
    deadUntil = 0;
    sendAcc = 0;
    myScore = 0;
    remotes.clear();
    remoteNpcs.clear();
    consumedLasers.clear();
    npcLasers = [];
    npcLasersFrom = -1;
    npcStateHasSeq = false;
    resignHost(); // the NPCs now belong to whoever hosts; drop the local ones
    player().alive = true;
    mpMenu.style.display = "none";
    mpBtn.textContent = "🌐 Leave room";
    canvas.focus();
    showToast(`connected — room ${g.code}, you are slot ${selfSlot}`);
}
function leaveMp() {
    net?.close();
    net = null;
    remotes.clear();
    remoteNpcs.clear();
    npcLasers = [];
    npcLasersFrom = -1;
    wasHost = false;
    player().alive = true;
    hud.textContent = "";
    mpBtn.textContent = "🌐 Multiplayer";
    if (ships.length === 1) {
        // back to single player: give the pilot something to dogfight
        spawnPirate();
        spawnPirate();
    }
    showToast("left the room — flying solo");
    canvas.focus();
}
function showToast(text, ms = 2200) {
    toastEl.textContent = text;
    toastEl.style.display = "block";
    toastUntil = performance.now() + ms;
}
function updateHud() {
    const me = player();
    let status = `score ${myScore} · ₡${credits} · shields ${Math.max(0, Math.round(me.shields))} · energy ${Math.round(me.energy)}`;
    if (cargoUnits > 0) {
        status += ` · ${P.COMMODITIES[cargoType].name} ${cargoUnits}/${cargoCapacity()}`;
    }
    if (!net) {
        hud.textContent = status;
        return;
    }
    let pilots = 1;
    for (const p of net.players) {
        if (p.occupied && p.connected && p.id !== selfSlot)
            pilots++;
    }
    hud.textContent =
        `room ${net.code} · ${pilots} pilot${pilots === 1 ? "" : "s"}${wasHost ? " · ★host" : ""}\n` +
            `${myName} — ${status}`;
}
function initUi() {
    const hashCode = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (hashCode)
        $("code").value = hashCode;
    // ?bot=NAME#ROOM spawns an autopiloted pilot that joins the room on load
    // (give the tab its own window: hidden tabs stop animating, and the bot
    // flies by the animation loop like any other player).
    const botParam = new URLSearchParams(location.search).get("bot");
    if (botParam !== null) {
        const name = botParam && botParam !== "1" ? botParam : "drone-" + Math.floor(Math.random() * 900 + 100);
        $("name").value = name;
        botMode = true;
        void connectMp();
    }
    mpBtn.addEventListener("click", () => {
        if (net) {
            leaveMp();
            return;
        }
        mpMenu.style.display = "flex";
        $("name").focus();
    });
    $("connect").addEventListener("click", () => void connectMp());
    $("cancel").addEventListener("click", () => {
        mpMenu.style.display = "none";
        canvas.focus();
    });
}
//////////// autopilot (bot pilot) ///////////////////
// A player AI that plays the game like a person would: runs trade routes,
// hunts pirates near its path (or anywhere when broke), retreats to a dock
// when the shields get low, and retaliates against players who shoot it.
// Toggle with B, or open the page with ?bot=NAME#ROOM to spawn a bot that
// auto-joins the room. It only drives the local ship's inputs, so on the wire
// a bot is indistinguishable from a person.
let botMode = false;
let lastAggressor = -1; // slot of the last player who shot us
let aggressorUntil = 0;
let botNoDockUntil = 0; // hysteresis so a broke bot doesn't dock-thrash
const BOT_HUNT_RANGE = 1400;
const BOT_RETREAT_SHIELDS = 60;
function nearestBaseOfType(type) {
    let best = null;
    let bestD = Infinity;
    for (const b of bases) {
        if (type >= 0 && b.sprite !== type)
            continue;
        const d = dist(b.x, b.y, player().x, player().y);
        if (d < bestD) {
            bestD = d;
            best = b;
        }
    }
    return best;
}
/** Steer with the normal turn keys; returns the remaining bearing error (deg). */
function botSteer(tx, ty) {
    const p = player();
    const targetAngle = Math.atan2(ty - p.y, tx - p.x) * 180 / Math.PI;
    const diff = shortestDeg(targetAngle - p.angle);
    if (diff > 4)
        p.leftPressed = true;
    else if (diff < -4)
        p.rightPressed = true;
    return diff;
}
function botFlyTo(tx, ty) {
    const p = player();
    const d = dist(tx, ty, p.x, p.y);
    const diff = botSteer(tx, ty);
    // keep thrusting until well inside DOCK_RANGE — a taller cutoff leaves a
    // dead zone where the bot coasts to a stop just out of docking reach
    if (Math.abs(diff) < 40 && d > 120) {
        p.upPressed = true;
        if (d > 900 && Math.abs(diff) < 15)
            p.tabPressed = true;
    }
}
function botAttack(tx, ty, d) {
    const p = player();
    const diff = botSteer(tx, ty);
    if (Math.abs(diff) < 35 && d > 160)
        p.upPressed = true;
    if (d > 1000 && Math.abs(diff) < 15)
        p.tabPressed = true;
    const aimTolerance = Math.atan2(45, Math.max(d, 60)) * 180 / Math.PI;
    if (Math.abs(diff) < aimTolerance && d < 480)
        p.spacePressed = true;
}
function botStep() {
    if (!botMode)
        return;
    const p = player();
    p.leftPressed = p.rightPressed = p.upPressed = p.downPressed = false;
    p.spacePressed = p.tabPressed = false;
    if (!p.alive)
        return;
    const now = performance.now();
    if (p.docked) {
        if (p.shields < p.shieldsMax)
            return; // finish repairs first
        if (dockedBase) {
            const ci = localCommodity(dockedBase.sprite);
            if (botBuyUpgrade())
                return;
            if (ci >= 0 &&
                cargoUnits < cargoCapacity() &&
                (cargoUnits === 0 || cargoType === ci) &&
                credits >= P.COMMODITIES[ci].buyPrice) {
                buyCargo();
                return;
            }
        }
        toggleDock(); // launch
        botNoDockUntil = now + 4000;
        return;
    }
    // survival first: limp to the nearest base and dock
    if (p.shields < BOT_RETREAT_SHIELDS) {
        const safe = nearestBaseOfType(-1);
        if (safe) {
            botFlyTo(safe.x, safe.y);
            if (dist(safe.x, safe.y, p.x, p.y) <= DOCK_RANGE)
                toggleDock();
            return;
        }
    }
    // pick a fight: whoever shot us recently, else a pirate near the flight
    // path — or any pirate at all when we're broke and need bounty money
    let tx = 0, ty = 0, targetD = Infinity;
    if (lastAggressor >= 0 && now < aggressorUntil) {
        const r = remotes.get(lastAggressor);
        if (r && r.alive && !r.docked) {
            const d = dist(r.px, r.py, p.x, p.y);
            if (d < 2000) {
                tx = r.px;
                ty = r.py;
                targetD = d;
            }
        }
    }
    if (targetD === Infinity) {
        // empty hold: hunt for bounties (anywhere, if broke). Carrying cargo:
        // only fight what's directly in the way — deliveries come first.
        const huntRange = cargoUnits > 0 ? 700 :
            credits < 10 ? Infinity :
                BOT_HUNT_RANGE;
        for (const n of remoteNpcs.values()) {
            const d = dist(n.px, n.py, p.x, p.y);
            if (d < huntRange && d < targetD) {
                tx = n.px;
                ty = n.py;
                targetD = d;
            }
        }
        for (let i = 1; i < ships.length; i++) {
            const d = dist(ships[i].x, ships[i].y, p.x, p.y);
            if (d < huntRange && d < targetD) {
                tx = ships[i].x;
                ty = ships[i].y;
                targetD = d;
            }
        }
    }
    if (targetD < Infinity) {
        botAttack(tx, ty, targetD);
        return;
    }
    // otherwise: trade. Deliver the hold, or go shopping at the nearest base.
    const dest = cargoUnits > 0 ? nearestBaseOfType(P.COMMODITIES[cargoType].sellAt) : nearestBaseOfType(-1);
    if (dest) {
        botFlyTo(dest.x, dest.y);
        if (dist(dest.x, dest.y, p.x, p.y) <= DOCK_RANGE && now > botNoDockUntil)
            toggleDock();
    }
}
/** Docked at a Foundry with money to spare: invest in the cheapest upgrade. */
function botBuyUpgrade() {
    if (!dockedBase || dockedBase.sprite !== FOUNDRY)
        return false;
    const options = [];
    if (holdLevel < HOLD_PRICES.length)
        options.push({ track: 1, price: HOLD_PRICES[holdLevel] });
    if (shieldLevel < SHIELD_PRICES.length)
        options.push({ track: 2, price: SHIELD_PRICES[shieldLevel] });
    if (engineLevel < ENGINE_PRICES.length)
        options.push({ track: 3, price: ENGINE_PRICES[engineLevel] });
    options.sort((a, b) => a.price - b.price);
    if (options.length > 0 && credits >= options[0].price + 150) {
        buyUpgrade(options[0].track); // keep a float for the next cargo load
        return true;
    }
    return false;
}
function setBotMode(on) {
    botMode = on;
    if (!on) {
        const p = player();
        p.leftPressed = p.rightPressed = p.upPressed = p.downPressed = false;
        p.spacePressed = p.tabPressed = false;
    }
    showToast(botMode ? "autopilot engaged — press B to take the stick back" : "autopilot off — you have the ship");
}
//////////// remote rendering ///////////////////
function drawRemoteShip(ship, x, y, angle) {
    ship.x = x;
    ship.y = y;
    ship.angle = angle;
    ship.draw(camera);
}
function drawLabel(wx, wy, text, offset = 34) {
    ctx.save();
    // the world context is y-flipped; unflip so the text reads upright
    ctx.translate(wx - camera.cameraX[0] + canvas.width / 2, wy - camera.cameraY[0] + canvas.height / 2 + offset);
    ctx.scale(1, -1);
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillStyle = "rgba(220,230,255,0.8)";
    ctx.textAlign = "center";
    ctx.fillText(text, 0, 0);
    ctx.restore();
}
function drawBases() {
    for (const b of bases) {
        const dx = b.x - camera.cameraX[0];
        const dy = b.y - camera.cameraY[0];
        if (Math.abs(dx) > canvas.width / 2 + 300 || Math.abs(dy) > canvas.height / 2 + 300)
            continue;
        const img = baseSprites[b.sprite];
        ctx.save();
        ctx.translate(dx + canvas.width / 2, dy + canvas.height / 2);
        ctx.drawImage(img, 0, 0, img.width, img.height, -img.width / 2, -img.height / 2, img.width, img.height);
        ctx.restore();
        drawLabel(b.x, b.y, b.name, -Math.max(44, img.height / 2 + 16));
    }
}
/**
 * Point at an off-screen thing (a fellow pilot, the nearest base) with a small
 * arrow pinned to the screen edge — space is vast. No-op when it is on screen.
 */
function drawEdgeMarker(wx, wy, color, label) {
    const dx = wx - camera.cameraX[0];
    const dy = wy - camera.cameraY[0];
    const sx = dx + canvas.width / 2;
    const sy = dy + canvas.height / 2;
    const m = 18;
    if (sx >= m && sx <= canvas.width - m && sy >= m && sy <= canvas.height - m)
        return;
    const cx = Math.min(Math.max(sx, m), canvas.width - m);
    const cy = Math.min(Math.max(sy, m), canvas.height - m);
    const ang = Math.atan2(sy - cy, sx - cx);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-6, 5);
    ctx.lineTo(-6, -5);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
    const d = Math.hypot(dx, dy);
    ctx.save();
    ctx.translate(cx - Math.cos(ang) * 16, cy - Math.sin(ang) * 16 - 12);
    ctx.scale(1, -1);
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillStyle = color;
    ctx.textAlign = Math.abs(cx - canvas.width / 2) > canvas.width / 2 - 60 ? (cx < canvas.width / 2 ? "left" : "right") : "center";
    ctx.fillText(`${label} ${(d / 1000).toFixed(1)}k`, 0, 0);
    ctx.restore();
}
function drawCenterText(text, y = 64) {
    ctx.save();
    ctx.translate(canvas.width / 2, y); // flipped coords: y px up from the bottom
    ctx.scale(1, -1);
    ctx.font = "bold 14px system-ui, sans-serif";
    ctx.fillStyle = "#7fe9ff";
    ctx.textAlign = "center";
    ctx.fillText(text, 0, 0);
    ctx.restore();
}
function drawDockPrompt() {
    const p = player();
    if (!p.alive)
        return;
    if (p.docked && dockedBase) {
        let text = `docked at ${dockedBase.name} — L to launch`;
        const ci = localCommodity(dockedBase.sprite);
        if (ci >= 0) {
            const c = P.COMMODITIES[ci];
            text += ` · T to buy ${c.name} (₡${c.buyPrice} → ${P.BASE_TYPE_NAMES[c.sellAt]} pays ₡${c.sellPrice})`;
        }
        drawCenterText(text);
        if (dockedBase.sprite === FOUNDRY)
            drawCenterText(upgradePromptLine(), 40);
        return;
    }
    const b = dockableBase();
    if (b)
        drawCenterText(`press L to dock at ${b.name}`);
}
function drawMarkers() {
    for (const r of remotes.values()) {
        if (r.alive)
            drawEdgeMarker(r.px, r.py, "#7fe9ff", r.name);
    }
    // incoming trouble: pirates within sensor range show up red on the edge
    for (const n of remoteNpcs.values()) {
        if (dist(n.px, n.py, player().x, player().y) < 3000)
            drawEdgeMarker(n.px, n.py, "#ff7a7a", "pirate");
    }
    for (let i = 1; i < ships.length; i++) {
        if (dist(ships[i].x, ships[i].y, player().x, player().y) < 3000)
            drawEdgeMarker(ships[i].x, ships[i].y, "#ff7a7a", "pirate");
    }
    let nearest = null;
    let nearestD = Infinity;
    for (const b of bases) {
        const d = dist(b.x, b.y, player().x, player().y);
        if (d < nearestD) {
            nearestD = d;
            nearest = b;
        }
    }
    if (nearest)
        drawEdgeMarker(nearest.x, nearest.y, "#9fb0da", nearest.name);
}
function drawWireLaser(img, wx, wy) {
    const size = 0.25;
    ctx.save();
    ctx.translate(wx - camera.cameraX[0] + canvas.width / 2, wy - camera.cameraY[0] + canvas.height / 2);
    ctx.drawImage(img, 0, 0, img.width, img.height, -img.width / 2 * size, -img.height / 2 * size, img.width * size, img.height * size);
    ctx.restore();
}
function drawRemoteLasers() {
    const now = performance.now();
    // same red ball everyone sees for their own shots — a laser must look the
    // same on every screen, whoever fired it
    for (const [slot, r] of remotes) {
        const age = Math.min((now - r.lastRecv) / 1000, 0.4);
        for (const l of r.lasers) {
            if (consumedLasers.has(laserKey(slot, l.id)))
                continue;
            drawWireLaser(laser.sprite[0], l.x + l.vx * 60 * age, l.y + l.vy * 60 * age);
        }
    }
    if (npcLasersFrom >= 0 && npcLasersFrom !== selfSlot) {
        const age = Math.min((now - lastNpcRecv) / 1000, 0.4);
        for (const l of npcLasers) {
            if (consumedLasers.has(laserKey(npcLasersFrom, l.id)))
                continue;
            drawWireLaser(laser.sprite[0], l.x + l.vx * 60 * age, l.y + l.vy * 60 * age);
        }
    }
}
//////////// Gameloop ///////////////////////////
/** Where a bored pirate wanders next: usually a base near some pilot. */
function pirateWanderBase() {
    const pilots = [];
    if (player().alive && !player().docked)
        pilots.push({ x: player().x, y: player().y });
    for (const r of remotes.values()) {
        if (r.alive && !r.docked)
            pilots.push({ x: r.px, y: r.py });
    }
    if (pilots.length > 0 && Math.random() < 0.6) {
        const t = pilots[Math.floor(Math.random() * pilots.length)];
        let best = 0;
        let bestD = Infinity;
        for (let i = 0; i < bases.length; i++) {
            const d = dist(bases[i].x, bases[i].y, t.x, t.y);
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        }
        return best;
    }
    return Math.floor(Math.random() * bases.length);
}
function pirateTarget(pirate) {
    if (!netActive()) {
        if (ships[0].docked)
            return null;
        return { x: ships[0].x, y: ships[0].y };
    }
    let best = null;
    let bestD = Infinity;
    if (player().alive && !player().docked) {
        best = { x: player().x, y: player().y };
        bestD = dist(player().x, player().y, pirate.x, pirate.y);
    }
    for (const r of remotes.values()) {
        if (!r.alive || r.docked)
            continue;
        const d = dist(r.px, r.py, pirate.x, pirate.y);
        if (d < bestD) {
            bestD = d;
            best = { x: r.px, y: r.py };
        }
    }
    return best;
}
function step() {
    botStep();
    if (player().alive && !player().docked) {
        if (player().angleSpeed >= 5) {
            player().angleSpeed = 5;
        }
        if (player().angleSpeed <= -5) {
            player().angleSpeed = -5;
        }
        if (player().leftPressed) {
            player().angleSpeed += 0.125;
        }
        if (player().rightPressed) {
            player().angleSpeed -= 0.125;
        }
        if (!player().rightPressed && !player().leftPressed) {
            player().angleSpeed /= 1.05;
        }
        if (!player().tabPressed) {
            if (player().upPressed) {
                player().xVelocity += player().acceleration * K_SCALE * Math.cos(player().angle * Math.PI / 180);
                player().yVelocity += player().acceleration * K_SCALE * Math.sin(player().angle * Math.PI / 180);
            }
            if (player().downPressed) {
                player().xVelocity -= player().acceleration * K_SCALE * Math.cos(player().angle * Math.PI / 180);
                player().yVelocity -= player().acceleration * K_SCALE * Math.sin(player().angle * Math.PI / 180);
            }
        }
        else {
            if (player().upPressed) {
                player().xVelocity += player().afterburnerAcceleration * K_SCALE * Math.cos(player().angle * Math.PI / 180);
                player().yVelocity += player().afterburnerAcceleration * K_SCALE * Math.sin(player().angle * Math.PI / 180);
            }
            if (player().downPressed) {
                player().xVelocity -= player().afterburnerAcceleration * K_SCALE * Math.cos(player().angle * Math.PI / 180);
                player().yVelocity -= player().afterburnerAcceleration * K_SCALE * Math.sin(player().angle * Math.PI / 180);
            }
        }
    }
    const shipBefore = player();
    const shieldsBefore = shipBefore.shields;
    for (let i = ships.length - 1; i >= 0; i--) {
        if (ships[i] !== player()) {
            const t = pirateTarget(ships[i]);
            const engaged = t !== null && dist(t.x, t.y, ships[i].x, ships[i].y) < NPC_DISENGAGE_RANGE;
            const threat = laserThreatTo(ships[i]);
            if (threat) {
                ships[i].evade(threat.dirX, threat.dirY, threat.side);
                // snap off a wild shot mid-juke when the prey is still close
                if (engaged && t && dist(t.x, t.y, ships[i].x, ships[i].y) < NPC_SHOOT_RANGE) {
                    shoot(ships[i]);
                }
            }
            else if (engaged && t) {
                ships[i].ai(t.x, t.y);
            }
            else {
                ships[i].loiter();
            }
        }
        let isAlive = true;
        if (ships[i].alive && !ships[i].docked) {
            isAlive = ships[i].update();
        }
        if (!isAlive) {
            if (netActive() && ships[i] === player()) {
                // a pirate laser from the local pool got me (host only)
                dieMp(selfSlot, P.NO_ID, true, true);
            }
            else {
                if (ships[i] !== player() && ships[i].lastHitBy === player()) {
                    myScore++;
                    credits += pirateBounty(ships[i].npcSprite);
                    showToast(`pirate bounty +1 · ₡${pirateBounty(ships[i].npcSprite)}`);
                }
                ships.splice(i, 1);
            }
        }
    }
    if (player().docked) {
        // repairing and rearming in the hangar
        player().shields = Math.min(player().shieldsMax, player().shields + 2);
        player().energy = Math.min(player().maxEnergy, player().energy + 10);
    }
    if (netActive() && player() === shipBefore && shipBefore.alive && shipBefore.shields <= shieldsBefore - P.LASER_DAMAGE + 1) {
        // a pirate laser from the local pool chipped my shields; tell the room
        broadcastDamage({ died: false, npcLaser: true, shooterSlot: selfSlot, laserId: P.NO_ID, shieldsAfter: shipBefore.shields, x: shipBefore.x, y: shipBefore.y });
    }
    if (player().alive && !player().docked && player().spacePressed) {
        shoot(player());
    }
    if (player().alive && !player().upPressed && !player().downPressed) {
        player().xVelocity /= 1.0395;
        player().yVelocity /= 1.0395;
    }
    laser.update();
    boom.update();
    netStep();
    camera.update(player().x, player().y);
}
function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(0, canvas.height);
    ctx.scale(1, -1);
    stars.draw(camera);
    /// asteroids.draw(camera);
    drawBases();
    laser.draw(camera);
    drawRemoteLasers();
    for (const n of remoteNpcs.values()) {
        drawRemoteShip(n.ship, n.px, n.py, n.pa);
    }
    for (const r of remotes.values()) {
        if (!r.alive)
            continue;
        drawRemoteShip(r.ship, r.px, r.py, r.pa);
        drawLabel(r.px, r.py, r.docked ? `${r.name} · ${r.score} ⚓` : `${r.name} · ${r.score}`);
    }
    for (let i = 0; i < ships.length; i++) {
        if (ships[i].alive)
            ships[i].draw(camera);
    }
    boom.draw(camera);
    drawMarkers();
    drawDockPrompt();
    ctx.restore();
}
// The simulation always steps at 60 Hz regardless of display refresh rate, so
// a 120 Hz laptop and a 60 Hz monitor fly the same physics.
let lastFrameMs = performance.now();
let stepAcc = 0;
function frame() {
    const now = performance.now();
    let dt = (now - lastFrameMs) / 1000;
    lastFrameMs = now;
    if (dt > 0.25)
        dt = 0.25; // tab was hidden; don't fast-forward
    stepAcc += dt;
    let steps = 0;
    while (stepAcc >= P.TICK && steps < 4) {
        step();
        stepAcc -= P.TICK;
        steps++;
    }
    if (steps === 4)
        stepAcc = 0;
    netFrame(dt);
    updateHud();
    if (now > toastUntil)
        toastEl.style.display = "none";
    render();
    requestAnimationFrame(frame);
}
// live handles for debugging and automated tests
window.tarsus = {
    ships, remotes, remoteNpcs, bases, laser, player, netActive, isHost,
    score: () => myScore,
    trade: () => ({ credits, cargoType, cargoUnits, capacity: cargoCapacity(), holdLevel, shieldLevel, engineLevel }),
    grant: (c) => { credits += c; }, // debug/testing
    bot: (on) => setBotMode(on),
    botActive: () => botMode,
};
initUi();
requestAnimationFrame(frame);
