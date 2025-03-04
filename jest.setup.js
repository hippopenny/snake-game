document.body.innerHTML = `
  <div id="start-btn"></div>
  <div id="start-screen"></div>
  <div id="game-over"></div>
  <div id="level-up"></div>
  <div id="score"></div>
  <div id="level"></div>
  <div id="speed"></div>
  <div id="players-count"></div>
  <div id="final-score"></div>
  <div id="final-level"></div>
  <div id="new-level"></div>
  <canvas id="minimap"></canvas>
  <button id="minimap-toggle"></button>
  <canvas id="bestscores"></canvas>
  <button id="bestscores-toggle"></button>
  <canvas id="game-canvas"></canvas>
`;

global.WebSocket = require('ws');
