const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Load the HTML file content
const html = fs.readFileSync(path.resolve(__dirname, '../snake_game.html'), 'utf8');

describe('Snake Game UI Tests', () => {
    let browser;
    let page;

    beforeAll(async () => {
        browser = await chromium.launch();
    });

    afterAll(async () => {
        await browser.close();
    });

    beforeEach(async () => {
        page = await browser.newPage();
        // Load the HTML content into the page
        await page.setContent(html);
        // Expose a mock WebSocket to the page
        await page.addInitScript(() => {
            window.WebSocket = class MockWebSocket {
                constructor(url) {
                    this.url = url;
                    this.readyState = MockWebSocket.CONNECTING;
                    this.onopen = () => {};
                    this.onmessage = () => {};
                    this.onclose = () => {};
                    this.onerror = () => {};
                    // Simulate connection after a short delay
                    setTimeout(() => {
                        this.readyState = MockWebSocket.OPEN;
                        this.onopen();
                    }, 50);
                }

                send(data) {
                    // Mock sending data.  In a real test, you might want to
                    // store this data and check it later, or trigger a fake
                    // onmessage event.
                    console.log("MockWebSocket sent:", data);
                }

                close() {
                    this.readyState = MockWebSocket.CLOSED;
                    this.onclose();
                }

                static CONNECTING = 0;
                static OPEN = 1;
                static CLOSING = 2;
                static CLOSED = 3;
            };
        });
        // Load the JavaScript file
        await page.addScriptTag({ path: path.resolve(__dirname, '../snake_game.js') });
    });

    afterEach(async () => {
        await page.close();
    });

    test('should display the start screen', async () => {
        const startScreen = await page.$('#start-screen');
        expect(await startScreen.isVisible()).toBe(true);
    });

    test('should start the game when start button is clicked', async () => {
        await page.click('#start-btn');
        const gameCanvas = await page.$('#game-canvas');
        expect(await gameCanvas.isVisible()).toBe(true);
        // Check if gameRunning is set to true
        const gameRunning = await page.evaluate(() => gameRunning);
        expect(gameRunning).toBe(true);
    });

    test('should initialize the snake', async () => {
        await page.click('#start-btn');
        const snake = await page.evaluate(() => snake);
        expect(snake).toBeDefined();
        expect(snake.length).toBeGreaterThan(0);
    });

    test('should move the snake', async () => {
        await page.click('#start-btn');
        const initialSnake = await page.evaluate(() => snake);
        const initialHeadX = initialSnake[0].x;
        const initialHeadY = initialSnake[0].y;

        // Simulate pressing the right arrow key
        await page.keyboard.press('ArrowRight');
        // Wait for the game loop to run (adjust timeout as needed)
        await page.waitForTimeout(250); // Wait longer than baseGameSpeed

        const newSnake = await page.evaluate(() => snake);
        const newHeadX = newSnake[0].x;
        const newHeadY = newSnake[0].y;

        // Check if the snake has moved in the expected direction
        expect(newHeadX).toBeGreaterThan(initialHeadX);
        expect(newHeadY).toBe(initialHeadY);
    });

    test('should update score and level displays', async () => {
        await page.click('#start-btn');
        // Simulate eating food (increase score)
        await page.evaluate(() => {
            score = 10;
            updateScoreAndLevel();
        });

        const scoreText = await page.innerText('#score');
        expect(scoreText).toContain('Score: 10');

        // Simulate level up
        await page.evaluate(() => {
            score = 50; // Assuming level 2 threshold is 50
            checkLevelUp();
        });

        const levelText = await page.innerText('#level');
        expect(levelText).toContain('Level: 2');
    });

    test('should handle game over', async () => {
        await page.click('#start-btn');

        // Simulate game over
        await page.evaluate(() => {
            gameOver();
        });

        const gameOverScreen = await page.$('#game-over');
        expect(await gameOverScreen.isVisible()).toBe(true);

        // Check if gameRunning is set to false
        const gameRunning = await page.evaluate(() => gameRunning);
        expect(gameRunning).toBe(false);
    });

    test('should restart the game', async () => {
        await page.click('#start-btn');
        await page.evaluate(() => gameOver()); // Simulate game over
        await page.click('#restart-btn');
        const gameCanvas = await page.$('#game-canvas');
        expect(await gameCanvas.isVisible()).toBe(true);
        const gameRunning = await page.evaluate(() => gameRunning);
        expect(gameRunning).toBe(true);
    });

    test('should toggle the minimap', async () => {
        await page.click('#start-btn');
        // Initial state
        let minimapVisible = await page.evaluate(() => minimapVisible);
        expect(minimapVisible).toBe(true);

        // Toggle off
        await page.click('#minimap-toggle');
        minimapVisible = await page.evaluate(() => minimapVisible);
        expect(minimapVisible).toBe(false);

        // Toggle on
        await page.click('#minimap-toggle');
        minimapVisible = await page.evaluate(() => minimapVisible);
        expect(minimapVisible).toBe(true);
    });
});
