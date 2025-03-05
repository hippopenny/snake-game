import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test.describe('Snake Game Unit Tests', () => {
  let htmlContent;

  test.beforeAll(async () => {
    // Read the HTML content from snake_game.html
    const filePath = path.resolve(__dirname, '../snake_game.html');
    htmlContent = fs.readFileSync(filePath, 'utf-8');
  });

  test.beforeEach(async ({ page }) => {
    // Set the content of the page to the HTML content
    await page.setContent(htmlContent);
    await page.evaluate(() => {
      // Reset game state before each test
      window.snake = [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }];
      window.direction = 'right';
      window.nextDirection = 'right';
      window.score = 0;
      window.level = 1;
      window.gameRunning = true;
      window.activePowerUp = null;
    });
  });

  test('moveSnake should move the snake to the right', async ({ page }) => {
    await page.evaluate(() => {
      window.moveSnake();
    });
    const snakeHead = await page.evaluate(() => window.snake[0]);
    expect(snakeHead).toEqual({ x: 6, y: 5 });
  });

  test('moveSnake should move the snake up', async ({ page }) => {
    await page.evaluate(() => {
      window.direction = 'up';
      window.nextDirection = 'up';
      window.moveSnake();
    });
    const snakeHead = await page.evaluate(() => window.snake[0]);
    expect(snakeHead).toEqual({ x: 5, y: 4 });
  });

  test('moveSnake should move the snake down', async ({ page }) => {
    await page.evaluate(() => {
      window.direction = 'down';
      window.nextDirection = 'down';
      window.moveSnake();
    });
    const snakeHead = await page.evaluate(() => window.snake[0]);
    expect(snakeHead).toEqual({ x: 5, y: 6 });
  });

  test('moveSnake should move the snake left', async ({ page }) => {
    await page.evaluate(() => {
      window.direction = 'left';
      window.nextDirection = 'left';
      window.moveSnake();
    });
    const snakeHead = await page.evaluate(() => window.snake[0]);
    expect(snakeHead).toEqual({ x: 4, y: 5 });
  });

  test('checkCollisions should return true if snake collides with the wall', async ({ page }) => {
    const collision = await page.evaluate(() => {
      window.snake = [{ x: -1, y: 5 }, { x: 0, y: 5 }];
      return window.checkCollisions();
    });
    expect(collision).toBe(true);
  });

  test('checkCollisions should return true if snake collides with itself', async ({ page }) => {
    const collision = await page.evaluate(() => {
      window.snake = [{ x: 5, y: 5 }, { x: 5, y: 5 }];
      return window.checkCollisions();
    });
    expect(collision).toBe(true);
  });

  test('checkCollisions should return false if snake does not collide with anything', async ({ page }) => {
    const collision = await page.evaluate(() => {
      window.snake = [{ x: 5, y: 5 }, { x: 4, y: 5 }];
      return window.checkCollisions();
    });
    expect(collision).toBe(false);
  });

  test('deactivatePowerUp should deactivate the active power-up', async ({ page }) => {
    await page.evaluate(() => {
      window.activePowerUp = { type: 'speed_boost' };
      window.deactivatePowerUp();
    });
    const activePowerUp = await page.evaluate(() => window.activePowerUp);
    expect(activePowerUp).toBe(null);
  });

  test('gameOver should set gameRunning to false', async ({ page }) => {
    await page.evaluate(() => {
      window.gameRunning = true;
      window.gameOver();
    });
    const gameRunning = await page.evaluate(() => window.gameRunning);
    expect(gameRunning).toBe(false);
  });

  test('updateScoreAndLevel should update the score and level displays', async ({ page }) => {
    await page.evaluate(() => {
      document.body.innerHTML = `<div id="score"></div><div id="level"></div>`;
      window.score = 100;
      window.level = 2;
      window.updateScoreAndLevel();
    });
    const scoreText = await page.locator('#score').textContent();
    const levelText = await page.locator('#level').textContent();
    expect(scoreText).toContain('Score: 100');
    expect(levelText).toContain('Level: 2');
  });
});
