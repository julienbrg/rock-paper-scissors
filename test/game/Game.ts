import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { FhevmInstance } from "fhevmjs/node";
import { ethers } from "hardhat";

import { Game } from "../../types";
import { createInstance } from "../instance";
import { getSigners, initSigners } from "../signers";

describe("Game", function () {
  let game: Game;
  let player1: HardhatEthersSigner;
  let player2: HardhatEthersSigner;
  let nonPlayer: HardhatEthersSigner;
  let contractAddress: string;
  let fhevm: FhevmInstance;

  before(async function () {
    await initSigners();
  });

  beforeEach(async function () {
    const signers = await getSigners();
    player1 = signers.alice;
    player2 = signers.bob;
    nonPlayer = signers.carol;

    const GameFactory = await ethers.getContractFactory("Game");
    game = await GameFactory.deploy(player1.address, player2.address);
    await game.waitForDeployment();
    contractAddress = await game.getAddress();
    fhevm = await createInstance();
  });

  describe("Game initialization", function () {
    it("should initialize with correct players", async function () {
      expect(await game.player1()).to.equal(player1.address);
      expect(await game.player2()).to.equal(player2.address);
      expect(await game.currentRound()).to.equal(1);
      expect(await game.gameOver()).to.equal(false);
      expect(await game.player1Wins()).to.equal(0);
      expect(await game.player2Wins()).to.equal(0);
    });

    it("should return correct initial game state", async function () {
      const [p1Wins, p2Wins, currentRound, gameOver, winner] = await game.getGameState();
      expect(p1Wins).to.equal(0);
      expect(p2Wins).to.equal(0);
      expect(currentRound).to.equal(1);
      expect(gameOver).to.equal(false);
      expect(winner).to.equal(ethers.ZeroAddress);
    });
  });

  describe("Making moves", function () {
    it("should allow valid players to make encrypted moves", async function () {
      const input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1.add8(1); // Rock
      const encryptedMove1 = await input1.encrypt();

      const tx1 = await game.connect(player1).move(encryptedMove1.handles[0], encryptedMove1.inputProof);
      await expect(tx1).to.emit(game, "EncryptedMoveMade").withArgs(player1.address, 1);

      expect(await game.player1HasMoved(1)).to.equal(true);
      expect(await game.player2HasMoved(1)).to.equal(false);

      const input2 = fhevm.createEncryptedInput(contractAddress, player2.address);
      input2.add8(2); // Paper
      const encryptedMove2 = await input2.encrypt();

      const tx2 = await game.connect(player2).move(encryptedMove2.handles[0], encryptedMove2.inputProof);
      await expect(tx2).to.emit(game, "EncryptedMoveMade").withArgs(player2.address, 1);

      expect(await game.player2HasMoved(1)).to.equal(true);
      expect(await game.haveBothPlayersMoved(1)).to.equal(true);
    });

    it("should emit RoundReady when both players have moved", async function () {
      const input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1.add8(1); // Rock
      const encryptedMove1 = await input1.encrypt();

      await game.connect(player1).move(encryptedMove1.handles[0], encryptedMove1.inputProof);

      const input2 = fhevm.createEncryptedInput(contractAddress, player2.address);
      input2.add8(2); // Paper
      const encryptedMove2 = await input2.encrypt();

      await expect(game.connect(player2).move(encryptedMove2.handles[0], encryptedMove2.inputProof))
        .to.emit(game, "RoundReady")
        .withArgs(1);
    });

    it("should reject moves from non-players", async function () {
      const input = fhevm.createEncryptedInput(contractAddress, nonPlayer.address);
      input.add8(1); // Rock
      const encryptedMove = await input.encrypt();

      await expect(game.connect(nonPlayer).move(encryptedMove.handles[0], encryptedMove.inputProof))
        .to.be.revertedWithCustomError(game, "NotAPlayer")
        .withArgs(nonPlayer.address);
    });

    it("should reject duplicate moves from same player in same round", async function () {
      const input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1.add8(1); // Rock
      const encryptedMove1 = await input1.encrypt();

      await game.connect(player1).move(encryptedMove1.handles[0], encryptedMove1.inputProof);

      const input2 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input2.add8(2); // Paper
      const encryptedMove2 = await input2.encrypt();

      await expect(game.connect(player1).move(encryptedMove2.handles[0], encryptedMove2.inputProof))
        .to.be.revertedWithCustomError(game, "AlreadyMoved")
        .withArgs(player1.address, 1);
    });

    it("should reject moves when game is over", async function () {
      // Round 1: Both players make moves, then set result
      const input1Round1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1Round1.add8(1);
      const encryptedMove1Round1 = await input1Round1.encrypt();
      await game.connect(player1).move(encryptedMove1Round1.handles[0], encryptedMove1Round1.inputProof);

      const input2Round1 = fhevm.createEncryptedInput(contractAddress, player2.address);
      input2Round1.add8(3);
      const encryptedMove2Round1 = await input2Round1.encrypt();
      await game.connect(player2).move(encryptedMove2Round1.handles[0], encryptedMove2Round1.inputProof);

      await game.connect(player1).setRoundResult(1, 1); // Player1 wins round 1

      // Round 2: Both players make moves, then set result to end game
      const input1Round2 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1Round2.add8(1);
      const encryptedMove1Round2 = await input1Round2.encrypt();
      await game.connect(player1).move(encryptedMove1Round2.handles[0], encryptedMove1Round2.inputProof);

      const input2Round2 = fhevm.createEncryptedInput(contractAddress, player2.address);
      input2Round2.add8(3);
      const encryptedMove2Round2 = await input2Round2.encrypt();
      await game.connect(player2).move(encryptedMove2Round2.handles[0], encryptedMove2Round2.inputProof);

      await game.connect(player1).setRoundResult(2, 1); // Player1 wins round 2, game is now over

      // Verify game is over
      expect(await game.gameOver()).to.equal(true);

      // Try to make move in next round - should fail
      const input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(1);
      const encryptedMove = await input.encrypt();

      await expect(
        game.connect(player1).move(encryptedMove.handles[0], encryptedMove.inputProof),
      ).to.be.revertedWithCustomError(game, "GameAlreadyOver");
    });
  });

  describe("Getting encrypted moves", function () {
    it("should allow players to view their own encrypted moves", async function () {
      const input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(1); // Rock
      const encryptedMove = await input.encrypt();

      await game.connect(player1).move(encryptedMove.handles[0], encryptedMove.inputProof);

      const retrievedMove = await game.connect(player1).getMyEncryptedMove(1);
      expect(retrievedMove).to.not.equal(0);
    });

    it("should reject viewing encrypted moves from non-players", async function () {
      const input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(1); // Rock
      const encryptedMove = await input.encrypt();

      await game.connect(player1).move(encryptedMove.handles[0], encryptedMove.inputProof);

      await expect(game.connect(nonPlayer).getMyEncryptedMove(1))
        .to.be.revertedWithCustomError(game, "NotAPlayer")
        .withArgs(nonPlayer.address);
    });

    it("should reject viewing encrypted moves if player hasn't moved", async function () {
      await expect(game.connect(player1).getMyEncryptedMove(1)).to.be.revertedWith(
        "Player 1 hasn't moved in this round",
      );
    });
  });

  describe("Setting round results", function () {
    beforeEach(async function () {
      // Both players make moves for round 1
      const input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1.add8(1); // Rock
      const encryptedMove1 = await input1.encrypt();
      await game.connect(player1).move(encryptedMove1.handles[0], encryptedMove1.inputProof);

      const input2 = fhevm.createEncryptedInput(contractAddress, player2.address);
      input2.add8(2); // Paper
      const encryptedMove2 = await input2.encrypt();
      await game.connect(player2).move(encryptedMove2.handles[0], encryptedMove2.inputProof);
    });

    it("should set round result and update wins correctly", async function () {
      await expect(game.connect(player1).setRoundResult(1, 2)).to.emit(game, "RoundCompleted").withArgs(1, 2);

      expect(await game.getRoundResult(1)).to.equal(2);
      expect(await game.player2Wins()).to.equal(1);
      expect(await game.player1Wins()).to.equal(0);
    });

    it("should handle tie results", async function () {
      await game.connect(player1).setRoundResult(1, 3); // Tie

      expect(await game.getRoundResult(1)).to.equal(3);
      expect(await game.player1Wins()).to.equal(0);
      expect(await game.player2Wins()).to.equal(0);
    });

    it("should end game when player reaches 2 wins", async function () {
      await game.connect(player1).setRoundResult(1, 1); // Player1 wins
      expect(await game.gameOver()).to.equal(false);

      // Round 2
      const input1Round2 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1Round2.add8(1);
      const encryptedMove1Round2 = await input1Round2.encrypt();
      await game.connect(player1).move(encryptedMove1Round2.handles[0], encryptedMove1Round2.inputProof);

      const input2Round2 = fhevm.createEncryptedInput(contractAddress, player2.address);
      input2Round2.add8(3);
      const encryptedMove2Round2 = await input2Round2.encrypt();
      await game.connect(player2).move(encryptedMove2Round2.handles[0], encryptedMove2Round2.inputProof);

      await expect(game.connect(player1).setRoundResult(2, 1))
        .to.emit(game, "GameEnded")
        .withArgs(player1.address, 2, 0);

      expect(await game.gameOver()).to.equal(true);
      expect(await game.winner()).to.equal(player1.address);
    });

    it("should reject invalid result values", async function () {
      await expect(game.connect(player1).setRoundResult(1, 0)).to.be.revertedWith("Invalid result");

      await expect(game.connect(player1).setRoundResult(1, 4)).to.be.revertedWith("Invalid result");
    });

    it("should reject setting result twice for same round", async function () {
      await game.connect(player1).setRoundResult(1, 1);

      await expect(game.connect(player1).setRoundResult(1, 2)).to.be.revertedWith("Round already processed");
    });

    it("should reject setting result if both players haven't moved", async function () {
      // Start a new round without both players moving
      await game.connect(player1).setRoundResult(1, 3); // Tie to advance to round 2

      await expect(game.connect(player1).setRoundResult(2, 1)).to.be.revertedWith("Both players must move first");
    });

    it("should reject non-players setting results", async function () {
      await expect(game.connect(nonPlayer).setRoundResult(1, 1)).to.be.revertedWith("Only players can set result");
    });
  });

  describe("Full game scenarios", function () {
    it("should play a complete best-of-3 game", async function () {
      // Round 1: Player 1 wins
      let input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1.add8(1);
      let encryptedMove1 = await input1.encrypt();
      await game.connect(player1).move(encryptedMove1.handles[0], encryptedMove1.inputProof);

      let input2 = fhevm.createEncryptedInput(contractAddress, player2.address);
      input2.add8(3);
      let encryptedMove2 = await input2.encrypt();
      await game.connect(player2).move(encryptedMove2.handles[0], encryptedMove2.inputProof);

      await game.connect(player1).setRoundResult(1, 1);

      const gameState1 = await game.getGameState();
      expect(gameState1[0]).to.equal(1); // player1Wins
      expect(gameState1[1]).to.equal(0); // player2Wins
      expect(gameState1[2]).to.equal(2); // currentRound
      expect(gameState1[3]).to.equal(false); // gameOver

      // Round 2: Player 2 wins
      input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1.add8(3);
      encryptedMove1 = await input1.encrypt();
      await game.connect(player1).move(encryptedMove1.handles[0], encryptedMove1.inputProof);

      input2 = fhevm.createEncryptedInput(contractAddress, player2.address);
      input2.add8(1);
      encryptedMove2 = await input2.encrypt();
      await game.connect(player2).move(encryptedMove2.handles[0], encryptedMove2.inputProof);

      await game.connect(player1).setRoundResult(2, 2);

      const gameState2 = await game.getGameState();
      expect(gameState2[0]).to.equal(1); // player1Wins
      expect(gameState2[1]).to.equal(1); // player2Wins
      expect(gameState2[2]).to.equal(3); // currentRound
      expect(gameState2[3]).to.equal(false); // gameOver

      // Round 3: Player 1 wins and wins the game
      input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1.add8(2);
      encryptedMove1 = await input1.encrypt();
      await game.connect(player1).move(encryptedMove1.handles[0], encryptedMove1.inputProof);

      input2 = fhevm.createEncryptedInput(contractAddress, player2.address);
      input2.add8(1);
      encryptedMove2 = await input2.encrypt();
      await game.connect(player2).move(encryptedMove2.handles[0], encryptedMove2.inputProof);

      await expect(game.connect(player1).setRoundResult(3, 1))
        .to.emit(game, "GameEnded")
        .withArgs(player1.address, 2, 1);

      const finalGameState = await game.getGameState();
      expect(finalGameState[0]).to.equal(2); // player1Wins
      expect(finalGameState[1]).to.equal(1); // player2Wins
      expect(finalGameState[2]).to.equal(3); // currentRound
      expect(finalGameState[3]).to.equal(true); // gameOver
      expect(finalGameState[4]).to.equal(player1.address); // winner
    });

    it("should handle game with ties", async function () {
      // Round 1: Tie
      let input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1.add8(1);
      let encryptedMove1 = await input1.encrypt();
      await game.connect(player1).move(encryptedMove1.handles[0], encryptedMove1.inputProof);

      let input2 = fhevm.createEncryptedInput(contractAddress, player2.address);
      input2.add8(1);
      let encryptedMove2 = await input2.encrypt();
      await game.connect(player2).move(encryptedMove2.handles[0], encryptedMove2.inputProof);

      await game.connect(player1).setRoundResult(1, 3); // Tie

      let gameState = await game.getGameState();
      expect(gameState[0]).to.equal(0); // player1Wins
      expect(gameState[1]).to.equal(0); // player2Wins
      expect(gameState[2]).to.equal(2); // currentRound advances
      expect(gameState[3]).to.equal(false); // gameOver

      // Round 2: Player 1 wins
      input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1.add8(1);
      encryptedMove1 = await input1.encrypt();
      await game.connect(player1).move(encryptedMove1.handles[0], encryptedMove1.inputProof);

      input2 = fhevm.createEncryptedInput(contractAddress, player2.address);
      input2.add8(3);
      encryptedMove2 = await input2.encrypt();
      await game.connect(player2).move(encryptedMove2.handles[0], encryptedMove2.inputProof);

      await game.connect(player1).setRoundResult(2, 1);

      gameState = await game.getGameState();
      expect(gameState[0]).to.equal(1); // player1Wins
      expect(gameState[1]).to.equal(0); // player2Wins

      // Round 3: Player 1 wins again to win the game
      input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1.add8(2);
      encryptedMove1 = await input1.encrypt();
      await game.connect(player1).move(encryptedMove1.handles[0], encryptedMove1.inputProof);

      input2 = fhevm.createEncryptedInput(contractAddress, player2.address);
      input2.add8(1);
      encryptedMove2 = await input2.encrypt();
      await game.connect(player2).move(encryptedMove2.handles[0], encryptedMove2.inputProof);

      await game.connect(player1).setRoundResult(3, 1);

      const finalGameState = await game.getGameState();
      expect(finalGameState[3]).to.equal(true); // gameOver
      expect(finalGameState[4]).to.equal(player1.address); // winner
    });
  });
});
