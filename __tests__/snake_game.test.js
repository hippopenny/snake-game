import { jest } from '@jest/globals';
import { chromium } from 'playwright';
import { createServer } from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Snake Game Tests', () => {
  let browser;
  let page;
  let httpServer;
  let consoleMessages = [];

  beforeAll(async () => {
    jest.setTimeout(30000);

    // Start HTTP server
    httpServer = createServer((req, res) => {
      console.log(`Request for: ${req.url}`);
      const filePath = req.url === '/' ? '/snake_game.html' : req.url;
      if (filePath.includes('snake_game.html') || filePath.includes('snake_game.js')) {
        const fullPath = path.join(__dirname, '..', filePath);
        const contentType = filePath.endsWith('.html') ? 'text/html' : 'application/javascript';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(fullPath).pipe(res);
      }
    }).listen(3000);
    console.log('Server started');
    // Launch browser
    browser = await chromium.launch({
      headless: false,      
      args: ['--no-sandbox'],
      slowMo: 100 });
  });

  beforeEach(async () => {
    page = await browser.newPage();
    page.on('console', msg => {
      consoleMessages.push(msg.text());
    });
    await page.goto('http://localhost:3000/snake_game.html');
    await page.waitForFunction(() => {
      return window.snake !== undefined && 
             window.gameRunning !== undefined;
    });
  });

  afterEach(async () => {
    if (page && !page.isClosed()) {
      await page.close();
    }
  });

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
    if (httpServer) {
      httpServer.close();
    }
  });

  test('should initialize game correctly', async () => {
    const initialSnake = await page.evaluate(() => window.snake);
    expect(initialSnake[0]).toEqual({ x: 5, y: 5 });
    
    const gameRunning = await page.evaluate(() => window.gameRunning);
    expect(gameRunning).toBe(false);
  });

  test('should start game when clicking start button', async () => {
    await page.click('#start-btn');
    const gameRunning = await page.evaluate(() => window.gameRunning);
    expect(gameRunning).toBe(true);
  });
 
  test('should move snake in response to arrow keys', async () => {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(250);
    
    const newSnake = await page.evaluate(() => window.snake);
    const initialSnake = [{ x: 5, y: 5 }];
    expect(newSnake[0].x).toBeGreaterThan(initialSnake[0].x);
  });
 
  test('should update score when eating food', async () => {
    const initialScore = await page.evaluate(() => window.score);
     
    await page.evaluate(() => {
      const headPos = window.snake[0];
      window.foods = [{ x: headPos.x + 1, y: headPos.y, points: 10 }];
    });

    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(250);
    
    const newScore = await page.evaluate(() => window.score);
    expect(newScore).toBeGreaterThan(initialScore);
  });
 
  test('should end game on wall collision', async () => {
    // Move snake to wall
    await page.evaluate(() => {
      window.snake = [{ x: -1, y: 5 }];
      window.checkCollisions();
    });

    const gameRunning = await page.evaluate(() => window.gameRunning);
    expect(gameRunning).toBe(false);
  });
 
  test('should end game on self collision', async () => {
     
    await page.evaluate(() => {
      window.snake = [
        { x: 5, y: 5 },
        { x: 5, y: 6 },
        { x: 5, y: 7 },
        { x: 5, y: 5 } // Head collides with tail
      ];
      window.checkCollisions();
    });

    const gameRunning = await page.evaluate(() => window.gameRunning);
    expect(gameRunning).toBe(false);
  });
 
  test('should update level when reaching score threshold', async () => {
    const initialLevel = await page.evaluate(() => window.level);
     
    await page.evaluate(() => {
      window.score = 50; // Score needed for level 2
      window.updateScoreAndLevel();
    });

    const newLevel = await page.evaluate(() => window.level);
    expect(newLevel).toBeGreaterThan(initialLevel);
  });
 
  test('should show game over screen on collision', async () => {
     
    await page.evaluate(() => {
      window.gameOver('collision');
    });

    const gameOverVisible = await page.isVisible('#game-over');
    expect(gameOverVisible).toBe(true);
  });
 
  test('should toggle minimap visibility', async () => {
    const initialVisibility = await page.evaluate(() => window.minimapVisible);
     
    await page.keyboard.press('M');
    
    const newVisibility = await page.evaluate(() => window.minimapVisible);
    expect(newVisibility).not.toBe(initialVisibility);
  });

  test('should handle WebSocket connection', async () => {
    await page.waitForTimeout(1000);
    const wsMessages = consoleMessages.filter(msg => 
      msg.includes('WebSocket connection established'));
    expect(wsMessages.length).toBeGreaterThan(0);
  });
});
// Add these tests to snake_game.test.js

describe('Snake Drawing Tests', () => {
    let mockCtx;
    
    beforeEach(async () => {
        await page.evaluate(() => {
            // Mock canvas context
            const mockCtx = {
                fillStyle: '',
                strokeStyle: '',
                lineWidth: 0,
                calls: [],
                beginPath() { this.calls.push('beginPath'); },
                moveTo(x, y) { this.calls.push(['moveTo', x, y]); },
                lineTo(x, y) { this.calls.push(['lineTo', x, y]); },
                fill() { this.calls.push('fill'); },
                stroke() { this.calls.push('stroke'); },
                arc(x, y, r, s, e) { this.calls.push(['arc', x, y, r, s, e]); },
                closePath() { this.calls.push('closePath'); }
            };
            
            // Store original context
            window.originalCtx = window.ctx;
            window.ctx = mockCtx;
            
            // Reset game state
            window.snake = [{x: 5, y: 5}, {x: 4, y: 5}];
            window.activePowerUp = null;
            window.CELL_SIZE = 10;
        });
    });

    afterEach(async () => {
        await page.evaluate(() => {
            // Restore original context
            window.ctx = window.originalCtx;
        });
    });
 
    test('should draw basic snake without power-ups', async () => {
         
        const drawCalls = await page.evaluate(() => {
            window.drawSnake(window.snake, true);
            return window.ctx.calls;
        });

        expect(drawCalls).toContain('beginPath');
        expect(drawCalls).toContain('fill');
        expect(drawCalls.length).toBeGreaterThan(0);
    });
 
    test('should draw snake with speed boost power-up', async () => {
         
        await page.evaluate(() => {
            window.activePowerUp = {
                type: 'speed_boost',
                expiresAt: Date.now() + 5000
            };
        });

        await page.click('#start-btn');
        
        const powerUpColor = await page.evaluate(() => {
            window.drawSnake(window.snake, true);
            return window.ctx.fillStyle;
        });

        expect(powerUpColor).toBe('#00BCD4'); // Speed boost color
    });
 
    test('should draw snake with invincibility power-up', async () => {
         
        await page.evaluate(() => {
            window.activePowerUp = {
                type: 'invincibility',
                expiresAt: Date.now() + 5000
            };
        });

        await page.click('#start-btn');

        const shadowProps = await page.evaluate(() => {
            window.drawSnake(window.snake, true);
            return {
                color: window.ctx.shadowColor,
                blur: window.ctx.shadowBlur
            };
        });

        expect(shadowProps.color).toBe('#9C27B0');
        expect(shadowProps.blur).toBe(20);
    });
 
    test('should draw opponent snake differently', async () => {
         
        const colors = await page.evaluate(() => {
            // Draw player snake
            window.drawSnake(window.snake, true);
            const playerColor = window.ctx.fillStyle;
            
            // Draw opponent snake
            window.drawSnake(window.snake, false);
            const opponentColor = window.ctx.fillStyle;
            
            return { playerColor, opponentColor };
        });

        expect(colors.playerColor).not.toBe(colors.opponentColor);
    });
 
    test('should draw snake head decorations', async () => {
         
        const decorationCalls = await page.evaluate(() => {
            window.drawSnake(window.snake, true);
            return window.ctx.calls.filter(call => 
                Array.isArray(call) && call[0] === 'arc' && call[3] < 1
            );
        });

        // Should have at least 2 eye decorations
        expect(decorationCalls.length).toBeGreaterThanOrEqual(2);
    });
 
    test('should draw magnet power-up orbits', async () => {
         
        await page.evaluate(() => {
            window.activePowerUp = {
                type: 'magnet',
                expiresAt: Date.now() + 5000
            };
        });

        await page.click('#start-btn');

        const orbitCalls = await page.evaluate(() => {
            window.drawSnake(window.snake, true);
            return window.ctx.calls.filter(call => 
                Array.isArray(call) && call[0] === 'arc'
            );
        });

        // Should have multiple orbit particle drawings
        expect(orbitCalls.length).toBeGreaterThan(5);
    });
});
