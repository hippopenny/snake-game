/**
 * @jest-environment jsdom
 */

import { test, expect, chromium, Browser, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { WebSocket, Server } from 'mock-socket';

// Mock the WebSocket globally for unit tests
global.WebSocket = WebSocket;

// Load the HTML content
const htmlPath = path.resolve(__dirname, '../snake_game.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

// Helper function to set up the page with the game
async function setupPage(page) {
    await page.setContent(htmlContent);
    await page.addScriptTag({ path: path.resolve(__dirname, '../snake_game.js') });
    await page.evaluate(() => {
        // Reset game state before each test
        window.snake = [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }];
        window.direction = 'right';
        window.nextDirection = 'right';
        window.score = 0;
        window.level = 1;
        window.gameRunning = true;
        window.activePowerUp = null;
        window.foods = [];
        window.players = {};
        window.playerId = 'testPlayer';
        window.initHeatMap(); // Ensure heat map is initialized
    });
}

test.describe('Snake Game Unit Tests', () => {
    let mockServer;

    test.beforeEach(async () => {
        // Set up the mock WebSocket server
        mockServer = new Server('ws://127.0.0.1:8080');
    });

    test.afterEach(() => {
        mockServer.close();
    });

    test('moveSnake should move the snake correctly', async () => {
        // Set up a mock DOM environment
        document.body.innerHTML = htmlContent;
        require('../snake_game.js');

        // Test right movement
        window.snake = [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }];
        window.direction = 'right';
        window.nextDirection = 'right';
        window.moveSnake();
        expect(window.snake[0]).toEqual({ x: 6, y: 5 });

        // Test up movement
        window.snake = [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }];
        window.direction = 'up';
        window.nextDirection = 'up';
        window.moveSnake();
        expect(window.snake[0]).toEqual({ x: 5, y: 4 });

        // Test down movement
        window.snake = [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }];
        window.direction = 'down';
        window.nextDirection = 'down';
        window.moveSnake();
        expect(window.snake[0]).toEqual({ x: 5, y: 6 });

        // Test left movement
        window.snake = [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }];
        window.direction = 'left';
        window.nextDirection = 'left';
        window.moveSnake();
        expect(window.snake[0]).toEqual({ x: 4, y: 5 });
    });

    test('checkCollisions should detect collisions correctly', async () => {
        document.body.innerHTML = htmlContent;
        require('../snake_game.js');

        // Wall collision
        window.snake = [{ x: -1, y: 5 }];
        expect(window.checkCollisions()).toBe(true);
        window.snake = [{ x: 50, y: 5 }];
        expect(window.checkCollisions()).toBe(true);
        window.snake = [{ x: 5, y: -1 }];
        expect(window.checkCollisions()).toBe(true);
        window.snake = [{ x: 5, y: 50 }];
        expect(window.checkCollisions()).toBe(true);

        // Self collision
        window.snake = [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 5, y: 5 }];
        expect(window.checkCollisions()).toBe(true);

        // No collision
        window.snake = [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 5 }];
        expect(window.checkCollisions()).toBe(false);

        // Collision with other player (mocked)
        window.players = {
            otherPlayer: { snake: [{ x: 5, y: 5 }] }
        };
        window.playerId = 'testPlayer';
        window.snake = [{ x: 5, y: 5 }];
        expect(window.checkCollisions()).toBe(true);
    });

    test('updateScoreAndLevel should update DOM elements', () => {
        document.body.innerHTML = `
            <div id="score">Score: 0</div>
            <div id="level">Level: 1</div>
            <canvas id="level-progress"></canvas>
            <div id="next-level-text"></div>
        `;
        require('../snake_game.js');

        window.score = 100;
        window.highestScore = 50;
        window.level = 2;
        window.updateScoreAndLevel();

        expect(document.getElementById('score').textContent).toBe('Score: 100 (Best: 100)');
        expect(document.getElementById('level').textContent).toBe('Level: 2');
    });

    test('deactivatePowerUp should clear power-up state', () => {
        document.body.innerHTML = htmlContent;
        require('../snake_game.js');

        window.activePowerUp = { type: 'speed_boost', expiresAt: Date.now() + 1000 };
        window.gameSpeed = 50; // Set a faster game speed for testing
        window.gameLoop = setInterval(() => { }, window.gameSpeed); // Create a mock gameLoop

        window.deactivatePowerUp();

        expect(window.activePowerUp).toBeNull();
        clearInterval(window.gameLoop); // Ensure the interval is cleared
    });

    test('gameOver should stop the game and update the DOM', () => {
        document.body.innerHTML = htmlContent;
        require('../snake_game.js');

        window.gameRunning = true;
        window.score = 100;
        window.level = 2;
        window.gameLoop = setInterval(() => { }, 100);

        window.gameOver();

        expect(window.gameRunning).toBe(false);
        clearInterval(window.gameLoop);
        expect(document.getElementById('game-over').style.display).toBe('block');
        expect(document.getElementById('final-score').textContent).toBe('Score: 100 (Best: 0)');
        expect(document.getElementById('final-level').textContent).toBe('Level: 2');
    });

    test('hexToRgb should convert hex colors to RGB', () => {
        document.body.innerHTML = htmlContent;
        require('../snake_game.js');

        expect(window.hexToRgb('#FFFFFF')).toBe('255, 255, 255');
        expect(window.hexToRgb('#000000')).toBe('0, 0, 0');
        expect(window.hexToRgb('#FF0000')).toBe('255, 0, 0');
        expect(window.hexToRgb('#00FF00')).toBe('0, 255, 0');
        expect(window.hexToRgb('#0000FF')).toBe('0, 0, 255');
    });

    test('applyMagnetEffect should move food towards the snake', () => {
        document.body.innerHTML = htmlContent;
        require('../snake_game.js');

        // Set up the magnet power-up
        window.activePowerUp = { type: 'magnet' };
        window.POWER_UP_EFFECTS = {
            magnet: { range: 5, attractionStrength: 1 }
        };
        window.snake = [{ x: 5, y: 5 }];
        window.foods = [{ x: 7, y: 5, points: 10 }]; // Food within range

        window.applyMagnetEffect();

        // Check if food has moved closer to the snake
        expect(window.foods[0].x).toBeLessThan(7);
        expect(window.foods[0].y).toBe(5);

        // Test without power-up
        window.activePowerUp = null;
        window.foods = [{ x: 7, y: 5, points: 10 }];
        window.applyMagnetEffect();
        expect(window.foods[0].x).toBe(7); // Food should not move
    });

    test('updateHeatMap should update the heat map array', () => {
        document.body.innerHTML = htmlContent;
        require('../snake_game.js');
        window.initHeatMap();

        window.snake = [{ x: 5, y: 5 }, { x: 6, y: 5 }];
        window.players = {
            otherPlayer: { snake: [{ x: 10, y: 10 }] }
        };
        window.playerId = 'testPlayer';

        window.updateHeatMap();

        expect(window.heatMap[5][5]).toBe(100); // Head of the snake
        expect(window.heatMap[6][5]).toBe(70);  // Body of the snake
        expect(window.heatMap[10][10]).toBe(80); // Other player's head

        // Test decay
        for (let i = 0; i < 10; i++) {
            window.updateHeatMap();
        }
        expect(window.heatMap[5][5]).toBeLessThan(100);
    });

    test('trackBestScore should add and sort scores', () => {
        document.body.innerHTML = htmlContent;
        require('../snake_game.js');
        window.bestScoresData = []; // Initialize the array
        window.MAX_BEST_SCORES = 3;

        window.trackBestScore(5, 5, 20);
        window.trackBestScore(6, 6, 30);
        window.trackBestScore(7, 7, 10);
        window.trackBestScore(8, 8, 40); // This should be truncated

        expect(window.bestScoresData.length).toBe(3);
        expect(window.bestScoresData[0].score).toBe(30);
        expect(window.bestScoresData[1].score).toBe(20);
        expect(window.bestScoresData[2].score).toBe(10);
    });

    test('checkLevelUp should increase level and speed', () => {
        document.body.innerHTML = htmlContent;
        require('../snake_game.js');
        window.level = 1;
        window.score = 50; // Enough to level up
        window.baseGameSpeed = 200;
        window.gameSpeed = 200;
        window.levelThresholds = [0, 50, 100];
        window.gameLoop = null;

        window.checkLevelUp();

        expect(window.level).toBe(2);
        expect(window.gameSpeed).toBeLessThan(window.baseGameSpeed);
    });

    test('updateHungerBar should update the hunger clock', () => {
        document.body.innerHTML = `
            ${htmlContent}
            <div id="heart-container">
                <canvas id="hunger-clock"></canvas>
                <span id="heart-icon"></span>
            </div>
        `;
        require('../snake_game.js');

        window.hungerTimer = 50; // Set a mid-range hunger value
        window.MAX_HUNGER = 100;
        window.updateHungerBar();

        const hungerClock = document.getElementById('hunger-clock');
        const clockCtx = hungerClock.getContext('2d');
        // This is a basic check; more detailed canvas checks would require mocking
        expect(clockCtx).toBeDefined();
    });

    test('showFoodEffect should create DOM elements and trigger animations', () => {
        document.body.innerHTML = htmlContent;
        require('../snake_game.js');

        const food = { x: 5, y: 5, points: 10, color: '#FF0000', powerUp: null };
        window.CELL_SIZE = 10;
        window.showFoodEffect(food);

        const scoreEffect = document.querySelector('div[style*="position: absolute"]');
        expect(scoreEffect).not.toBeNull();
        expect(scoreEffect.textContent).toBe('+10');

        // Test with power-up
        const powerUpFood = { x: 6, y: 6, points: 20, color: '#00FF00', powerUp: 'speed_boost' };
        window.showFoodEffect(powerUpFood);
        const powerUpEffect = document.querySelector('div[style*="position: absolute"]');
        expect(powerUpEffect).not.toBeNull();
        expect(powerUpEffect.textContent).toBe('Speed Boost!');
    });
});

test.describe('Snake Game Integration Tests', () => {
    let browser;
    let page;

    test.beforeAll(async () => {
        browser = await chromium.launch();
    });

    test.afterAll(async () => {
        await browser.close();
    });

    test.beforeEach(async () => {
        page = await browser.newPage();
        await setupPage(page);
    });

    test.afterEach(async () => {
        await page.close();
    });

    test('should start the game and move the snake', async () => {
        await page.click('#start-btn');
        await page.waitForSelector('#game-canvas', { state: 'visible' });

        // Initial snake position
        let snakeHead = await page.evaluate(() => window.snake[0]);
        expect(snakeHead).toEqual({ x: 5, y: 5 });

        // Move right
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(250); // Wait for game step
        snakeHead = await page.evaluate(() => window.snake[0]);
        expect(snakeHead.x).toBeGreaterThan(5);

        // Move up
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(250);
        snakeHead = await page.evaluate(() => window.snake[0]);
        expect(snakeHead.y).toBeLessThan(5);
    });

    test('should handle game over on collision', async () => {
        await page.click('#start-btn');
        await page.waitForSelector('#game-canvas', { state: 'visible' });

        // Force a collision with the wall
        await page.evaluate(() => {
            window.snake = [{ x: 0, y: 5 }];
            window.direction = 'left';
            window.nextDirection = 'left';
        });
        await page.waitForTimeout(250);

        const gameOverVisible = await page.isVisible('#game-over');
        expect(gameOverVisible).toBe(true);
    });

    test('should update score and level', async () => {
        await page.click('#start-btn');
        await page.waitForSelector('#game-canvas', { state: 'visible' });

        // Increase the score
        await page.evaluate(() => {
            window.score = 100;
            window.level = 2;
            window.updateScoreAndLevel();
        });

        const scoreText = await page.textContent('#score');
        const levelText = await page.textContent('#level');
        expect(scoreText).toContain('Score: 100');
        expect(levelText).toContain('Level: 2');
    });

    test('should connect to the WebSocket server and receive updates', async () => {
        await page.click('#start-btn');
        await page.waitForSelector('#game-canvas', { state: 'visible' });

        const [response] = await Promise.all([
            page.waitForEvent('websocket'), // Wait for the WebSocket connection
        ]);

        expect(response).toBeDefined();
    });

    test('should handle food consumption and power-up activation', async () => {
        await page.click('#start-btn');
        await page.waitForSelector('#game-canvas', { state: 'visible' });

        // Place a speed boost food in front of the snake
        await page.evaluate(() => {
            window.foods = [{ x: 6, y: 5, points: 5, powerUp: 'speed_boost', color: '#00BCD4' }];
            window.snake = [{ x: 5, y: 5 }, { x: 4, y: 5 }];
            window.direction = 'right';
            window.nextDirection = 'right';
        });

        await page.waitForTimeout(500); // Wait for a couple game steps

        // Check if the score increased
        const scoreText = await page.textContent('#score');
        expect(scoreText).toContain('Score: 5');

        // Check if power-up is active
        const powerUpStatusVisible = await page.isVisible('#power-up-status');
        expect(powerUpStatusVisible).toBe(true);
    });

    test('should handle multiple players (mocked)', async () => {
        await page.click('#start-btn');
        await page.waitForSelector('#game-canvas', { state: 'visible' });

        // Simulate another player joining
        await page.evaluate(() => {
            window.players = {
                otherPlayer: { snake: [{ x: 10, y: 10 }], score: 20, level: 1 }
            };
            window.updatePlayersCount();
        });

        const playersCountText = await page.textContent('#players-count');
        expect(playersCountText).toContain('Players: 2'); // Including the current player
    });
});
