import { moveSnake, checkCollisions, updateScoreAndLevel, deactivatePowerUp, gameOver } from '../snake_game.js';
import { jest } from '@jest/globals';

// Mock the necessary global variables and functions
jest.mock('../snake_game.js', () => {
  const originalModule = jest.requireActual('../snake_game.js');
  return {
    ...originalModule,
    socket: {
      readyState: WebSocket.OPEN,
      send: jest.fn()
    },
    GRID_SIZE: 50,
    CELL_SIZE: 10,
    levelThresholds: [0, 50, 100, 150, 200, 300, 400, 500, 600, 800],
    baseGameSpeed: 200,
    MAX_HUNGER: 100,
    POWER_UP_EFFECTS: {
      speed_boost: { speedMultiplier: 2.0 },
      invincibility: {},
      magnet: {}
    },
    document: {
      getElementById: jest.fn((id) => {
        if (id === 'score') return { textContent: '' };
        if (id === 'level') return { textContent: '' };
        return null;
      })
    }
  };
});

describe('Snake Game Unit Tests', () => {
  let snake;
  let players;
  let activePowerUp;
  let score;
  let level;
  let GRID_SIZE;
  let CELL_SIZE;
  let baseGameSpeed;
  let gameSpeed;
  let levelThresholds;
  let socket;
  let MAX_HUNGER;
  let POWER_UP_EFFECTS;

  beforeEach(() => {
    snake = [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }];
    players = {};
    activePowerUp = null;
    score = 0;
    level = 1;
    GRID_SIZE = 50;
    CELL_SIZE = 10;
    baseGameSpeed = 200;
    gameSpeed = baseGameSpeed;
    levelThresholds = [0, 50, 100, 150, 200, 300, 400, 500, 600, 800];
    socket = {
      readyState: WebSocket.OPEN,
      send: jest.fn()
    };
    MAX_HUNGER = 100;
    POWER_UP_EFFECTS = {
      speed_boost: { speedMultiplier: 2.0 },
      invincibility: {},
      magnet: {}
    };
  });

  describe('moveSnake', () => {
    it('should move the snake to the right', () => {
      const initialSnake = [{ x: 5, y: 5 }, { x: 4, y: 5 }];
      moveSnake();
      expect(snake[0]).toEqual({ x: 6, y: 5 });
    });

    it('should move the snake up', () => {
      window.direction = 'up';
      window.nextDirection = 'up';
      const initialSnake = [{ x: 5, y: 5 }, { x: 4, y: 5 }];
      moveSnake();
      expect(snake[0]).toEqual({ x: 5, y: 4 });
    });

    it('should move the snake down', () => {
      window.direction = 'down';
      window.nextDirection = 'down';
      const initialSnake = [{ x: 5, y: 5 }, { x: 4, y: 5 }];
      moveSnake();
      expect(snake[0]).toEqual({ x: 5, y: 6 });
    });

    it('should move the snake left', () => {
      window.direction = 'left';
      window.nextDirection = 'left';
      const initialSnake = [{ x: 5, y: 5 }, { x: 4, y: 5 }];
      moveSnake();
      expect(snake[0]).toEqual({ x: 4, y: 5 });
    });
  });

  describe('checkCollisions', () => {
    it('should return true if snake collides with the wall', () => {
      snake = [{ x: -1, y: 5 }, { x: 0, y: 5 }];
      expect(checkCollisions()).toBe(true);
    });

    it('should return true if snake collides with itself', () => {
      snake = [{ x: 5, y: 5 }, { x: 5, y: 5 }];
      expect(checkCollisions()).toBe(true);
    });

    it('should return false if snake does not collide with anything', () => {
      snake = [{ x: 5, y: 5 }, { x: 4, y: 5 }];
      expect(checkCollisions()).toBe(false);
    });

    it('should return true if snake collides with another player', () => {
      players = {
        'otherPlayer': {
          snake: [{ x: 5, y: 5 }, { x: 6, y: 5 }]
        }
      };
      snake = [{ x: 5, y: 5 }, { x: 4, y: 5 }];
      expect(checkCollisions()).toBe(true);
    });

    it('should return false if invincibility power-up is active', () => {
      window.activePowerUp = { type: 'invincibility' };
      snake = [{ x: -1, y: 5 }, { x: 0, y: 5 }];
      expect(checkCollisions()).toBe(false);
    });
  });

  describe('updateScoreAndLevel', () => {
    it('should update the score and level displays', () => {
      window.score = 100;
      window.level = 2;
      updateScoreAndLevel();
      expect(document.getElementById).toHaveBeenCalledWith('score');
      expect(document.getElementById).toHaveBeenCalledWith('level');
    });
  });

  describe('deactivatePowerUp', () => {
    it('should deactivate the active power-up and reset game speed', () => {
      window.activePowerUp = { type: 'speed_boost' };
      window.gameSpeed = 100;
      deactivatePowerUp();
      expect(window.activePowerUp).toBe(null);
    });
  });

  describe('gameOver', () => {
    it('should set gameRunning to false and send game over message', () => {
      window.gameRunning = true;
      gameOver();
      expect(window.gameRunning).toBe(false);
    });
  });
});
