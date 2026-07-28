import Phaser from 'phaser';
import {
  GAME_WIDTH,
  GAME_HEIGHT,
  NET_X,
  NET_PLAY_HEIGHT,
  COURT,
  COURT_OUTER,
  COURT_DEPTH,
  COURT_DEPTH_OUTER,
  MID_DEPTH,
  SERVE_SPOT,
  HIT_REACH,
  HIT_REACH_Z,
  BLOCK_REACH,
  MAX_TOUCHES,
  PLAYER_SPEED,
  MAX_CHARGE_TIME,
  MIN_CHARGE_POWER,
  MOUSE_HIT_MIN_APEX,
  MOUSE_HIT_MAX_APEX,
  AI,
  DEFAULT_PLAYER,
  TEAM_A_PARTNER_COLOR,
  TEAM_B_COLORS,
} from '../config.js';
import Player from '../entities/Player.js';
import Ball from '../entities/Ball.js';
import Match from '../rules/Match.js';
import Referee from '../ui/Referee.js';
import Court from '../ui/Court.js';
import AIController from '../ai/AIController.js';

const jitter = (m) => Phaser.Math.FloatBetween(-m, m);

export default class GameScene extends Phaser.Scene {
  constructor() {
    super('Game');
  }

  create() {
    new Court(this);

    this.profile = this.registry.get('player') || { ...DEFAULT_PLAYER };
    this.match = new Match();
    this.referee = new Referee(this);

    // Team A: index 0 is the human, index 1 the AI partner. Index order matches
    // Match.serverIndex so serve rotation picks the right player.
    this.human = this._makePlayer({ side: 'left', team: 'A', role: 'back', isHuman: true, tint: this.profile.color });
    this.partner = this._makePlayer({ side: 'left', team: 'A', role: 'front', isHuman: false, tint: TEAM_A_PARTNER_COLOR });
    this.oppBack = this._makePlayer({ side: 'right', team: 'B', role: 'back', isHuman: false, tint: TEAM_B_COLORS[0] });
    this.oppFront = this._makePlayer({ side: 'right', team: 'B', role: 'front', isHuman: false, tint: TEAM_B_COLORS[1] });

    this.players = [this.human, this.partner, this.oppBack, this.oppFront];
    this.teams = { A: [this.human, this.partner], B: [this.oppBack, this.oppFront] };

    this.ball = new Ball(this);
    this.ai = new AIController(this);

    this._buildHud();

    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys('W,A,S,D,SPACE,ESC');
    this.input.keyboard.on('keydown-F', () => this._toggleFullscreen());
    this.input.keyboard.on('keydown-ESC', () => this.scene.start('Menu'));

    this.hitCooldown = 0;
    this.touchState = this._freshTouchState();
    this.phase = 'serve-wait';
    this.rallyLocked = false;
    this.waitingForHumanServe = false;

    this._setupMouse();

    this._updateScoreText();
    this._beginServeFor(this.match.servingTeam);
  }

  _makePlayer({ side, team, role, isHuman, tint }) {
    const bounds = side === 'left' ? COURT.left : COURT.right;
    const p = new Player(this, { x: (bounds.min + bounds.max) / 2, y: MID_DEPTH, side, team, isHuman, bounds, tint });
    p.role = role;
    return p;
  }

  _buildHud() {
    this.scoreText = this.add
      .text(GAME_WIDTH / 2, 10, '', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 5,
      })
      .setOrigin(0.5, 0)
      .setDepth(3000);

    this.hintText = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 6, 'WASD mover  •  Rato: segura=saltar+forca, larga=bater  •  Botao direito=bloquear  •  F ecra inteiro  •  ESC menu', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(3000)
      .setAlpha(0.8);

    this.aimGraphics = this.add.graphics().setDepth(2500);

    // "This is you" marker: a bobbing arrow + name that follows the human.
    this.marker = this.add
      .triangle(0, 0, 0, 0, 12, 0, 6, 10, 0xffe9a8, 1)
      .setStrokeStyle(1.5, 0x000000, 0.85)
      .setDepth(2600);
    this.markerLabel = this.add
      .text(0, 0, this.profile.name, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#ffe9a8',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5, 1)
      .setDepth(2600);
  }

  _setupMouse() {
    this.charging = false;
    this.chargeStart = 0;
    this.input.mouse?.disableContextMenu();

    this.input.on('pointerdown', (pointer) => {
      if (this.phase === 'match-over') return;

      // Right button = block attempt at the net.
      if (pointer.rightButtonDown()) {
        this._tryHumanBlock();
        return;
      }
      if (!pointer.leftButtonDown()) return;

      this.charging = true;
      this.chargeStart = this.time.now;

      // Holding the left button jumps, so serves and attacks are timed: you must
      // meet the ball at the top of the jump. Low balls are dug from the ground.
      if (this._shouldJumpForHit()) this.human.jump(false);
    });

    this.input.on('pointerup', (pointer) => {
      if (!this.charging || pointer.rightButtonReleased()) return;
      this.charging = false;
      this.aimGraphics.clear();
      const held = this.time.now - this.chargeStart;
      const power = Phaser.Math.Clamp(held / (MAX_CHARGE_TIME * 1000), MIN_CHARGE_POWER, 1);
      this._resolveHumanRelease(pointer.worldX, pointer.worldY, power);
    });
  }

  // Jump when serving, or when the ball is high enough that meeting it in the
  // air makes sense; stay grounded to dig a low ball.
  _shouldJumpForHit() {
    if (!this.human.grounded) return false;
    if (this.phase === 'serve-wait' && this.waitingForHumanServe) return true;
    if (this.phase !== 'rally') return false;
    return this.ball.z > 70;
  }

  _tryHumanBlock() {
    const p = this.human;
    if (this.phase !== 'rally' || !p.grounded) return;
    if (Math.abs(p.x - NET_X) > 70) return; // must be near the net to block
    p.jump(true);
  }

  // --- Setup helpers --------------------------------------------------------

  _freshTouchState() {
    return { team: null, count: 0, lastPlayerId: null, lastWasBlock: false };
  }

  _updateScoreText() {
    const m = this.match;
    const you = m.sideOfTeam.A === 'left' ? 'ESQ' : 'DIR';
    this.scoreText.setText(
      `SET ${m.currentSet}   TU(${you}) ${m.setScores.A} - ${m.setScores.B} CPU   |   SETS ${m.setsWon.A}-${m.setsWon.B}`
    );
  }

  // Serve rotation: Match tracks which of the team's two players is up.
  _serverFor(team) {
    return this.teams[team][this.match.serverIndex[team]];
  }

  _boundsForSide(side) {
    return side === 'left' ? COURT.left : COURT.right;
  }

  _placeFormation(servingTeam) {
    for (const player of this.players) {
      const b = player.bounds;
      if (player.role === 'front') {
        player.placeAt(player.side === 'left' ? b.max - 18 : b.min + 18, MID_DEPTH - 30);
      } else {
        const deepX = player.side === 'left' ? b.min + (b.max - b.min) * 0.35 : b.max - (b.max - b.min) * 0.35;
        player.placeAt(deepX, MID_DEPTH + 30);
      }
    }
    const server = this._serverFor(servingTeam);
    const spot = SERVE_SPOT[server.side];
    server.placeAt(spot.x, spot.y);
    return server;
  }

  // --- Serve / rally lifecycle ----------------------------------------------

  _beginServeFor(team) {
    this.phase = 'serve-wait';
    this.rallyLocked = false;
    this.charging = false;
    this.touchState = this._freshTouchState();

    const server = this._placeFormation(team);
    this.ball.reset(server.x, server.y, 75);

    if (server.isHuman) {
      this.waitingForHumanServe = true;
      this.referee.showServePrompt(server.x, server.y - 110, 'Segura o rato\npara servir');
    } else {
      this.waitingForHumanServe = false;
      this.serveTimer = 1.0;
      const who = server === this.partner ? 'O TEU COLEGA SERVE' : 'ADVERSARIO SERVE';
      this.referee.showBanner(who, 700);
    }
  }

  _launchAiServe(team) {
    const server = this._serverFor(team);
    const [tx, ty] = this._openCourtTarget(team);
    this.ball.launchTo(tx, ty, 165);
    this.ball.lastHitSide = server.side;
    this.ball.lastHitTeam = team;
    server.triggerAction('playerSmash', 0.4);
    this.phase = 'rally';
    this.referee.flashBubble(this.ball.x, this.ball.y - 165);
  }

  // --- Scoring / faults ------------------------------------------------------

  _fault(team, message) {
    if (this.rallyLocked) return;
    this.rallyLocked = true;
    this._awardPoint(this.match.otherTeam(team), message);
  }

  _awardPoint(team, message) {
    const result = this.match.awardPoint(team);
    this._updateScoreText();
    this.referee.showBanner(message, 900);

    if (result.matchOver) {
      this.phase = 'match-over';
      this.time.delayedCall(950, () => {
        const won = team === 'A';
        this.referee.showBanner(won ? 'GANHASTE O JOGO!\nESPACO para jogar de novo' : 'PERDESTE O JOGO\nESPACO para tentar de novo', 999999);
      });
      return;
    }

    if (result.sideSwitch) this._applySideSwitch();

    if (result.setWon) {
      this.time.delayedCall(950, () => {
        this.referee.showBanner(team === 'A' ? 'GANHASTE O SET!' : 'PERDESTE O SET', 1400);
      });
    }

    this.time.delayedCall(result.setWon ? 2400 : 950, () => {
      if (this.match.matchOver) return;
      this._beginServeFor(this.match.servingTeam);
    });
  }

  _applySideSwitch() {
    for (const player of this.players) {
      const side = this.match.sideOfTeam[player.team];
      player.setSide(side, this._boundsForSide(side));
    }
    this.time.delayedCall(300, () => this.referee.showBanner('TROCA DE CAMPO!', 1000));
  }

  _handleLanding(side) {
    if (this.rallyLocked) return;
    this.rallyLocked = true;
    this.phase = 'point-sequence';

    this.ball.playImpact();
    const b = this.ball;
    const inBounds =
      b.x >= COURT_OUTER.min && b.x <= COURT_OUTER.max &&
      b.y >= COURT_DEPTH_OUTER.min && b.y <= COURT_DEPTH_OUTER.max;

    this.time.delayedCall(300, () => {
      this.ball.playRoll();
      this.time.delayedCall(520, () => {
        if (inBounds) {
          const landedTeam = this.match.teamAtSide(side);
          const winner = this.match.otherTeam(landedTeam);
          this._awardPoint(winner, winner === 'A' ? 'PONTO TEU!' : 'PONTO ADVERSARIO');
        } else {
          const faultTeam = this.ball.lastHitTeam || this.match.teamAtSide(side);
          this._awardPoint(this.match.otherTeam(faultTeam), 'BOLA FORA!');
        }
      });
    });
  }

  // --- Touch rules ------------------------------------------------------------

  _checkTouchLegality(player, team, forceBlock = false) {
    // A block only counts as a block at the net against a high ball.
    const isBlockTouch =
      (forceBlock || player.blocking) &&
      this.ball.z > NET_PLAY_HEIGHT - 25 &&
      Math.abs(player.x - NET_X) < 70 &&
      Math.abs(this.ball.x - NET_X) < 80;

    if (!isBlockTouch) {
      if (this.touchState.team === team && this.touchState.count >= MAX_TOUCHES) {
        this._fault(team, `${MAX_TOUCHES + 1} TOQUES!`);
        return { ok: false };
      }
      if (
        this.touchState.team === team &&
        this.touchState.lastPlayerId === player.id &&
        !this.touchState.lastWasBlock
      ) {
        this._fault(team, 'DOIS TOQUES!');
        return { ok: false };
      }
    }
    return { ok: true, isBlockTouch };
  }

  _registerTouch(player, team, isBlockTouch) {
    if (isBlockTouch) {
      this.touchState.lastWasBlock = true;
      this.touchState.lastPlayerId = player.id;
      this.touchState.team = team;
    } else {
      this.touchState.team = team;
      this.touchState.count += 1;
      this.touchState.lastPlayerId = player.id;
      this.touchState.lastWasBlock = false;
    }
  }

  _withinReach(player, reach = HIT_REACH) {
    const flat = Math.hypot(this.ball.x - player.x, this.ball.y - player.y);
    const dz = Math.abs(this.ball.z - player.handHeight);
    return flat < reach && dz < HIT_REACH_Z;
  }

  // AI contact resolution (the human contacts via mouse instead).
  _tryHits(dt) {
    if (this.hitCooldown > 0) {
      this.hitCooldown -= dt;
      return;
    }
    const team = this.match.teamAtSide(this.ball.x < NET_X ? 'left' : 'right');
    for (const player of this.teams[team]) {
      if (player.isHuman) continue;
      const reach = player.blocking ? BLOCK_REACH : HIT_REACH;
      if (!this._withinReach(player, reach)) continue;

      const legality = this._checkTouchLegality(player, team);
      if (!legality.ok) return;
      this._performAiHit(player, team, legality.isBlockTouch);
      return;
    }
  }

  _performAiHit(player, team, isBlockTouch) {
    this._registerTouch(player, team, isBlockTouch);
    const count = this.touchState.count;
    const partner = this.teams[team].find((p) => p.id !== player.id);

    if (isBlockTouch || count >= MAX_TOUCHES) {
      const [tx, ty] = this._openCourtTarget(team);
      this.ball.launchTo(tx, ty, AI.spikeApex + jitter(15));
      player.triggerAction(isBlockTouch ? 'playerBlock' : 'playerSmash', 0.4);
    } else if (count === 1) {
      // Dig towards the partner so they can set.
      this.ball.launchTo(partner.x + jitter(AI.aimError), partner.y + jitter(AI.aimError), AI.digApex);
      player.triggerAction('playerReception', 0.35);
    } else {
      // Set: loft near the net for the partner to attack.
      const setX = player.side === 'left'
        ? Math.min(partner.x + 34, player.bounds.max - 6)
        : Math.max(partner.x - 34, player.bounds.min + 6);
      this.ball.launchTo(setX, partner.y, AI.setApex);
      player.triggerAction('playerReception', 0.35);
    }
    this._finishHit(player, team);
  }

  _finishHit(player, team) {
    this.ball.lastHitSide = player.side;
    this.ball.lastHitTeam = team;
    this.hitCooldown = 0.16;
    this.referee.flashBubble(this.ball.x, this.ball.y - this.ball.z - 22);
  }

  // Aim at the opponent court point furthest from their defenders.
  _openCourtTarget(team) {
    const oppTeam = this.match.otherTeam(team);
    const oppSide = this.match.sideOfTeam[oppTeam];
    const xRange = oppSide === 'left'
      ? [COURT_OUTER.min + 20, NET_X - 30]
      : [NET_X + 30, COURT_OUTER.max - 20];
    const yRange = [COURT_DEPTH.min + 16, COURT_DEPTH.max - 16];
    const opps = this.teams[oppTeam];

    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i <= 2; i++) {
      for (let j = 0; j <= 2; j++) {
        const x = Phaser.Math.Linear(xRange[0], xRange[1], i / 2);
        const y = Phaser.Math.Linear(yRange[0], yRange[1], j / 2);
        const score = Math.min(...opps.map((o) => Math.hypot(o.x - x, o.y - y)));
        if (score > bestScore) {
          bestScore = score;
          best = [x + jitter(AI.aimError), y + jitter(AI.aimError)];
        }
      }
    }
    return best;
  }

  // --- Human control ----------------------------------------------------------

  _handleHuman(player) {
    let vx = 0;
    let vy = 0;
    if (this.cursors.left.isDown || this.keys.A.isDown) vx -= 1;
    if (this.cursors.right.isDown || this.keys.D.isDown) vx += 1;
    if (this.cursors.up.isDown || this.keys.W.isDown) vy -= 1;
    if (this.cursors.down.isDown || this.keys.S.isDown) vy += 1;
    const len = Math.hypot(vx, vy) || 1;
    player.setInputVelocity((vx / len) * PLAYER_SPEED, (vy / len) * PLAYER_SPEED);
  }

  _updateMarker() {
    const p = this.human;
    const bob = Math.sin(this.time.now / 220) * 3;
    const topY = p.y - p.z - 52 + bob;
    this.marker.setPosition(p.x - 6, topY);
    this.markerLabel.setPosition(p.x, topY - 2);
  }

  _drawAim() {
    this.aimGraphics.clear();
    if (!this.charging || this.phase === 'match-over') return;

    const pointer = this.input.activePointer;
    const p = this.human;
    const held = this.time.now - this.chargeStart;
    const power = Phaser.Math.Clamp(held / (MAX_CHARGE_TIME * 1000), MIN_CHARGE_POWER, 1);

    const oy = p.y - p.z - 24;
    this.aimGraphics.lineStyle(1, 0xffffff, 0.45);
    this.aimGraphics.lineBetween(p.x, oy, pointer.worldX, pointer.worldY);

    // Target reticle.
    this.aimGraphics.lineStyle(2, 0xffe9a8, 0.95);
    this.aimGraphics.strokeCircle(pointer.worldX, pointer.worldY, 7);
    this.aimGraphics.fillStyle(0xffe9a8, 0.9);
    this.aimGraphics.fillCircle(pointer.worldX, pointer.worldY, 2);

    // Power bar over the head.
    const bw = 36;
    const bx = p.x - bw / 2;
    const by = p.y - p.z - 66;
    this.aimGraphics.fillStyle(0x000000, 0.55);
    this.aimGraphics.fillRect(bx - 1, by - 1, bw + 2, 6);
    this.aimGraphics.fillStyle(power > 0.66 ? 0xff5252 : 0x66d96b, 1);
    this.aimGraphics.fillRect(bx, by, bw * power, 4);
  }

  _resolveHumanRelease(targetX, targetY, power) {
    const apex = Phaser.Math.Linear(MOUSE_HIT_MAX_APEX, MOUSE_HIT_MIN_APEX, power);
    const p = this.human;

    // Serve.
    if (this.phase === 'serve-wait' && this.waitingForHumanServe) {
      this.waitingForHumanServe = false;
      this.referee.hideServePrompt();
      this.ball.x = p.x;
      this.ball.y = p.y;
      this.ball.z = Math.max(p.handHeight, 80);
      this.ball.launchTo(targetX, targetY, apex);
      p.triggerAction('playerSmash', 0.4);
      this.phase = 'rally';
      this.ball.lastHitSide = p.side;
      this.ball.lastHitTeam = p.team;
      this.referee.flashBubble(this.ball.x, this.ball.y - this.ball.z - 22);
      return;
    }

    if (this.phase !== 'rally' || this.hitCooldown > 0) return;
    if (p.side !== (this.ball.x < NET_X ? 'left' : 'right')) return;

    const reach = p.blocking ? BLOCK_REACH : HIT_REACH;
    if (!this._withinReach(p, reach)) return; // whiff - mistimed

    const legality = this._checkTouchLegality(p, p.team);
    if (!legality.ok) return;

    this._registerTouch(p, p.team, legality.isBlockTouch);
    this.ball.launchTo(targetX, targetY, apex);
    // Grounded low contact reads as a dig; airborne/hard contact as a spike.
    p.triggerAction(p.grounded && power < 0.55 ? 'playerReception' : 'playerSmash', 0.35);
    this._finishHit(p, p.team);
  }

  _toggleFullscreen() {
    if (this.scale.isFullscreen) this.scale.stopFullscreen();
    else this.scale.startFullscreen();
  }

  // --- Main loop --------------------------------------------------------------

  update(time, deltaMs) {
    const dt = Math.min(deltaMs / 1000, 1 / 30);

    if (this.phase === 'match-over') {
      this._updateMarker();
      if (this.keys.SPACE.isDown) {
        this.match.reset();
        this.referee.hideBanner();
        this._updateScoreText();
        this._beginServeFor(this.match.servingTeam);
      }
      return;
    }

    this._drawAim();
    this._updateMarker();
    this.ai.update(dt);

    for (const player of this.players) {
      if (player.isHuman) this._handleHuman(player);
      player.update(dt);
    }

    // Human block contact: resolved on touch while airborne blocking, so a good
    // block redirects the ball straight back without needing a click.
    if (this.phase === 'rally' && this.human.blocking && this.hitCooldown <= 0 && this._withinReach(this.human, BLOCK_REACH)) {
      const legality = this._checkTouchLegality(this.human, this.human.team, true);
      if (legality.ok) {
        this._registerTouch(this.human, this.human.team, legality.isBlockTouch);
        const [tx, ty] = this._openCourtTarget(this.human.team);
        this.ball.launchTo(tx, ty, 120);
        this.human.triggerAction('playerBlock', 0.4);
        this._finishHit(this.human, this.human.team);
        this.referee.showBanner('BLOQUEIO!', 600);
      }
    }

    if (this.phase === 'serve-wait') {
      if (!this.waitingForHumanServe) {
        this.serveTimer -= dt;
        if (this.serveTimer <= 0) this._launchAiServe(this.match.servingTeam);
      }
      return;
    }

    if (this.phase !== 'rally') return;

    const events = this.ball.update(dt);
    this._tryHits(dt);

    if (events.crossed) this.touchState = this._freshTouchState();

    if (events.netFault) {
      this._fault(this.match.teamAtSide(events.netFault), 'BOLA NA REDE!');
      return;
    }
    if (events.landed) this._handleLanding(events.landed);
  }
}
