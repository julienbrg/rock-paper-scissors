import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { Game } from "../../types";

describe("Game", function () {
  let game: Game;
  let player1: HardhatEthersSigner;
  let player2: HardhatEthersSigner;
  let nonPlayer: HardhatEthersSigner;

  beforeEach(async function () {
    [player1, player2, nonPlayer] = await ethers.getSigners();
    const GameFactory = await ethers.getContractFactory("Game");
    game = await GameFactory.deploy(player1.address, player2.address);
    await game.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right players", async function () {
      expect(await game.player1()).to.equal(player1.address);
      expect(await game.player2()).to.equal(player2.address);
    });

    it("Should initialize game state correctly", async function () {
      expect(await game.currentRound()).to.equal(1);
      expect(await game.player1Wins()).to.equal(0);
      expect(await game.player2Wins()).to.equal(0);
      expect(await game.gameOver()).to.equal(false);
      expect(await game.winner()).to.equal(ethers.ZeroAddress);
    });
  });

  describe("Valid Moves", function () {
    it("Should allow player1 to make a valid move", async function () {
      await expect(game.connect(player1).move(1)).to.emit(game, "MoveMade").withArgs(player1.address, 1, 1);

      const [p1Move, p2Move] = await game.getRoundMoves(1);
      expect(p1Move).to.equal(1);
      expect(p2Move).to.equal(0);
    });

    it("Should allow player2 to make a valid move", async function () {
      await expect(game.connect(player2).move(2)).to.emit(game, "MoveMade").withArgs(player2.address, 1, 2);

      const [p1Move, p2Move] = await game.getRoundMoves(1);
      expect(p1Move).to.equal(0);
      expect(p2Move).to.equal(2);
    });

    it("Should process round when both players move", async function () {
      await game.connect(player1).move(1); // Rock

      await expect(game.connect(player2).move(2)) // Paper beats Rock
        .to.emit(game, "RoundCompleted")
        .withArgs(1, 1, 2, player2.address);

      expect(await game.player1Wins()).to.equal(0);
      expect(await game.player2Wins()).to.equal(1);
      expect(await game.currentRound()).to.equal(2);
    });
  });

  describe("Invalid Moves", function () {
    it("Should revert for invalid move values", async function () {
      await expect(game.connect(player1).move(0)).to.be.revertedWithCustomError(game, "InvalidMove").withArgs(0);

      await expect(game.connect(player1).move(4)).to.be.revertedWithCustomError(game, "InvalidMove").withArgs(4);
    });

    it("Should revert when non-player tries to move", async function () {
      await expect(game.connect(nonPlayer).move(1))
        .to.be.revertedWithCustomError(game, "NotAPlayer")
        .withArgs(nonPlayer.address);
    });

    it("Should revert when player tries to move twice in same round", async function () {
      await game.connect(player1).move(1);

      await expect(game.connect(player1).move(2))
        .to.be.revertedWithCustomError(game, "AlreadyMoved")
        .withArgs(player1.address, 1);
    });

    it("Should revert when game is already over", async function () {
      // Play a complete game - player1 wins 2-0
      await game.connect(player1).move(1); // Rock
      await game.connect(player2).move(3); // Scissors - player1 wins round 1

      await game.connect(player1).move(2); // Paper
      await game.connect(player2).move(1); // Rock - player1 wins round 2 and game

      expect(await game.gameOver()).to.equal(true);
      expect(await game.winner()).to.equal(player1.address);

      // Try to make another move
      await expect(game.connect(player1).move(1)).to.be.revertedWithCustomError(game, "GameAlreadyOver");
    });
  });

  describe("Game Logic - Rock Paper Scissors Rules", function () {
    it("Rock should beat Scissors", async function () {
      await game.connect(player1).move(1); // Rock
      await game.connect(player2).move(3); // Scissors

      expect(await game.player1Wins()).to.equal(1);
      expect(await game.player2Wins()).to.equal(0);
    });

    it("Paper should beat Rock", async function () {
      await game.connect(player1).move(2); // Paper
      await game.connect(player2).move(1); // Rock

      expect(await game.player1Wins()).to.equal(1);
      expect(await game.player2Wins()).to.equal(0);
    });

    it("Scissors should beat Paper", async function () {
      await game.connect(player1).move(3); // Scissors
      await game.connect(player2).move(2); // Paper

      expect(await game.player1Wins()).to.equal(1);
      expect(await game.player2Wins()).to.equal(0);
    });

    it("Should handle tie rounds correctly", async function () {
      await expect(game.connect(player1).move(1)) // Rock
        .to.emit(game, "MoveMade")
        .withArgs(player1.address, 1, 1);

      await expect(game.connect(player2).move(1)) // Rock
        .to.emit(game, "RoundCompleted")
        .withArgs(1, 1, 1, ethers.ZeroAddress); // No winner (tie)

      expect(await game.player1Wins()).to.equal(0);
      expect(await game.player2Wins()).to.equal(0);
      expect(await game.currentRound()).to.equal(2); // Moves to next round
    });
  });

  describe("Complete Games", function () {
    it("Should end game when player1 wins 2 rounds", async function () {
      // Round 1: Player1 wins
      await game.connect(player1).move(1); // Rock
      await game.connect(player2).move(3); // Scissors

      // Round 2: Player1 wins and game ends
      await game.connect(player1).move(2); // Paper

      await expect(game.connect(player2).move(1)) // Rock
        .to.emit(game, "GameEnded")
        .withArgs(player1.address, 2, 0);

      expect(await game.gameOver()).to.equal(true);
      expect(await game.winner()).to.equal(player1.address);
      expect(await game.player1Wins()).to.equal(2);
      expect(await game.player2Wins()).to.equal(0);
    });

    it("Should end game when player2 wins 2 rounds", async function () {
      // Round 1: Player2 wins
      await game.connect(player1).move(3); // Scissors
      await game.connect(player2).move(1); // Rock

      // Round 2: Player2 wins and game ends
      await game.connect(player1).move(1); // Rock

      await expect(game.connect(player2).move(2)) // Paper
        .to.emit(game, "GameEnded")
        .withArgs(player2.address, 0, 2);

      expect(await game.gameOver()).to.equal(true);
      expect(await game.winner()).to.equal(player2.address);
      expect(await game.player1Wins()).to.equal(0);
      expect(await game.player2Wins()).to.equal(2);
    });

    it("Should handle complete game with multiple rounds including ties", async function () {
      // Round 1: Tie
      await game.connect(player1).move(1); // Rock
      await game.connect(player2).move(1); // Rock

      // Round 2: Player1 wins
      await game.connect(player1).move(1); // Rock
      await game.connect(player2).move(3); // Scissors

      // Round 3: Tie
      await game.connect(player1).move(2); // Paper
      await game.connect(player2).move(2); // Paper

      // Round 4: Player2 wins
      await game.connect(player1).move(1); // Rock
      await game.connect(player2).move(2); // Paper

      // Round 5: Player1 wins and game ends
      await game.connect(player1).move(3); // Scissors
      await game.connect(player2).move(2); // Paper

      expect(await game.gameOver()).to.equal(true);
      expect(await game.winner()).to.equal(player1.address);
      expect(await game.player1Wins()).to.equal(2);
      expect(await game.player2Wins()).to.equal(1);
    });
  });

  describe("View Functions", function () {
    it("Should return correct game state", async function () {
      const [p1Wins, p2Wins, currentRound, gameOver, winner] = await game.getGameState();

      expect(p1Wins).to.equal(0);
      expect(p2Wins).to.equal(0);
      expect(currentRound).to.equal(1);
      expect(gameOver).to.equal(false);
      expect(winner).to.equal(ethers.ZeroAddress);
    });

    it("Should return correct round moves", async function () {
      await game.connect(player1).move(1);

      let [p1Move, p2Move] = await game.getRoundMoves(1);
      expect(p1Move).to.equal(1);
      expect(p2Move).to.equal(0);

      await game.connect(player2).move(2);

      [p1Move, p2Move] = await game.getRoundMoves(1);
      expect(p1Move).to.equal(1);
      expect(p2Move).to.equal(2);
    });

    it("Should return zero for unplayed rounds", async function () {
      const [p1Move, p2Move] = await game.getRoundMoves(5);
      expect(p1Move).to.equal(0);
      expect(p2Move).to.equal(0);
    });
  });

  describe("Events", function () {
    it("Should emit MoveMade event correctly", async function () {
      await expect(game.connect(player1).move(1)).to.emit(game, "MoveMade").withArgs(player1.address, 1, 1);

      await expect(game.connect(player2).move(2)).to.emit(game, "MoveMade").withArgs(player2.address, 1, 2);
    });

    it("Should emit RoundCompleted event with winner", async function () {
      await game.connect(player1).move(1); // Rock

      await expect(game.connect(player2).move(3)) // Scissors
        .to.emit(game, "RoundCompleted")
        .withArgs(1, 1, 3, player1.address);
    });

    it("Should emit RoundCompleted event with no winner for ties", async function () {
      await game.connect(player1).move(1); // Rock

      await expect(game.connect(player2).move(1)) // Rock
        .to.emit(game, "RoundCompleted")
        .withArgs(1, 1, 1, ethers.ZeroAddress);
    });

    it("Should emit GameEnded event when game finishes", async function () {
      // Win first round
      await game.connect(player1).move(1); // Rock
      await game.connect(player2).move(3); // Scissors

      // Win second round and game
      await game.connect(player1).move(2); // Paper

      await expect(game.connect(player2).move(1)) // Rock
        .to.emit(game, "GameEnded")
        .withArgs(player1.address, 2, 0);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle all possible move combinations", async function () {
      const moves = [1, 2, 3]; // Rock, Paper, Scissors
      const results = [
        [0, 2, 1], // Rock vs [Rock, Paper, Scissors] -> [Tie, Lose, Win]
        [1, 0, 2], // Paper vs [Rock, Paper, Scissors] -> [Win, Tie, Lose]
        [2, 1, 0], // Scissors vs [Rock, Paper, Scissors] -> [Lose, Win, Tie]
      ];

      for (let i = 0; i < moves.length; i++) {
        for (let j = 0; j < moves.length; j++) {
          // Deploy fresh contract for each test
          const GameFactory = await ethers.getContractFactory("Game");
          const testGame = await GameFactory.deploy(player1.address, player2.address);

          await testGame.connect(player1).move(moves[i]);
          await testGame.connect(player2).move(moves[j]);

          const p1Wins = await testGame.player1Wins();
          const p2Wins = await testGame.player2Wins();

          if (results[i][j] === 0) {
            // Tie
            expect(p1Wins).to.equal(0);
            expect(p2Wins).to.equal(0);
          } else if (results[i][j] === 1) {
            // Player 1 wins
            expect(p1Wins).to.equal(1);
            expect(p2Wins).to.equal(0);
          } else {
            // Player 2 wins
            expect(p1Wins).to.equal(0);
            expect(p2Wins).to.equal(1);
          }
        }
      }
    });

    it("Should handle maximum rounds scenario", async function () {
      // Play maximum possible rounds (alternating wins with ties)
      // This could theoretically go on forever with ties, but let's test a reasonable scenario

      // Tie, P1 win, Tie, P2 win, P1 win (5 rounds total)
      const roundMoves = [
        [1, 1], // Tie
        [1, 3], // P1 wins
        [2, 2], // Tie
        [1, 2], // P2 wins
        [3, 2], // P1 wins - game ends
      ];

      for (let i = 0; i < roundMoves.length; i++) {
        await game.connect(player1).move(roundMoves[i][0]);
        await game.connect(player2).move(roundMoves[i][1]);

        if (i < roundMoves.length - 1) {
          expect(await game.gameOver()).to.equal(false);
        }
      }

      expect(await game.gameOver()).to.equal(true);
      expect(await game.winner()).to.equal(player1.address);
      expect(await game.player1Wins()).to.equal(2);
      expect(await game.player2Wins()).to.equal(1);
    });
  });
});
