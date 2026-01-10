/**
 * PPO Client
 * Responsible ONLY for calling the PPO inference service
 */

const axios = require("axios");

const PPO_BASE_URL =
  process.env.PPO_BASE_URL || "http://sentinel-core-ppo:8000";

async function callPpoDecision(observation) {
  try {
    const start = Date.now();

    const response = await axios.post(
      `${PPO_BASE_URL}/decide`,
      observation,
      { timeout: 2000 }
    );

    const latencyMs = Date.now() - start;

    return {
      ...response.data,
      transport_latency_ms: latencyMs
    };
  } catch (err) {
    throw new Error(
      `PPO service error: ${err.response?.data?.detail || err.message}`
    );
  }
}

module.exports = {
  callPpoDecision
};
