const isModuleContext = typeof module !== 'undefined' && module.exports;

const ECOLOGITS_CONSTANTS = {
  ENERGY_ALPHA: 8.91e-5,
  ENERGY_BETA: 1.43e-3,
  LATENCY_ALPHA: 8.02e-4,
  LATENCY_BETA: 2.23e-2,
  PUE: 1.2,
  GPU_MEMORY: 80,
  SERVER_POWER_WITHOUT_GPU: 1,
  INSTALLED_GPUS: 8,
  GPU_BITS: 4,
  WORLD_EMISSION_FACTOR: 0.418
};

const GPT5_PARAMS = {
  TOTAL_PARAMS: 300e9,
  ACTIVE_PARAMS: 60e9,
  ACTIVE_PARAMS_BILLIONS: 60,
  ACTIVATION_RATIO: 0.2,
  ACTIVE_PARAMS_MIN: 30e9,
  ACTIVE_PARAMS_MAX: 90e9
};

function calculateEnergyAndEmissions(outputTokens, method = 'community') {
  const {
    ENERGY_ALPHA,
    ENERGY_BETA,
    LATENCY_ALPHA,
    LATENCY_BETA,
    PUE,
    GPU_MEMORY,
    SERVER_POWER_WITHOUT_GPU,
    INSTALLED_GPUS,
    GPU_BITS,
    WORLD_EMISSION_FACTOR
  } = ECOLOGITS_CONSTANTS;

  const { TOTAL_PARAMS, ACTIVE_PARAMS, ACTIVE_PARAMS_BILLIONS, ACTIVATION_RATIO } = GPT5_PARAMS;

  const energyPerToken = ENERGY_ALPHA * ACTIVE_PARAMS_BILLIONS + ENERGY_BETA;
  const memoryRequired = 1.2 * TOTAL_PARAMS * GPU_BITS / 8;
  const numGPUs = Math.ceil(memoryRequired / (GPU_MEMORY * 1e9));
  const latencyPerToken = LATENCY_ALPHA * ACTIVE_PARAMS_BILLIONS + LATENCY_BETA;
  const totalLatency = outputTokens * latencyPerToken;
  const gpuEnergy = outputTokens * energyPerToken * numGPUs;
  const serverEnergyWithoutGPU = totalLatency * SERVER_POWER_WITHOUT_GPU * numGPUs / INSTALLED_GPUS / 3600 * 1000;
  const serverEnergy = serverEnergyWithoutGPU + gpuEnergy;
  const totalEnergy = PUE * serverEnergy;
  const minEnergy = 0.01;
  const normalizedEnergy = Math.max(totalEnergy, minEnergy);
  const co2Emissions = normalizedEnergy * WORLD_EMISSION_FACTOR;

  return {
    numGPUs,
    totalEnergy: normalizedEnergy,
    co2Emissions,
    modelDetails: {
      totalParams: TOTAL_PARAMS / 1e9,
      activeParams: ACTIVE_PARAMS / 1e9,
      activationRatio: ACTIVATION_RATIO,
      method: 'community'
    }
  };
}

function getEnergyPerToken() {
  const { ENERGY_ALPHA, ENERGY_BETA } = ECOLOGITS_CONSTANTS;
  const { ACTIVE_PARAMS_BILLIONS } = GPT5_PARAMS;
  return ENERGY_ALPHA * ACTIVE_PARAMS_BILLIONS + ENERGY_BETA;
}

function getNumGPUs() {
  const { GPU_MEMORY, GPU_BITS } = ECOLOGITS_CONSTANTS;
  const { TOTAL_PARAMS } = GPT5_PARAMS;
  const memoryRequired = 1.2 * TOTAL_PARAMS * GPU_BITS / 8;
  return Math.ceil(memoryRequired / (GPU_MEMORY * 1e9));
}

if (typeof window !== 'undefined') {
  window.ECOLOGITS_CONSTANTS = ECOLOGITS_CONSTANTS;
  window.GPT5_PARAMS = GPT5_PARAMS;
  window.calculateEnergyAndEmissions = calculateEnergyAndEmissions;
  window.getEnergyPerToken = getEnergyPerToken;
  window.getNumGPUs = getNumGPUs;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ECOLOGITS_CONSTANTS,
    GPT5_PARAMS,
    calculateEnergyAndEmissions,
    getEnergyPerToken,
    getNumGPUs
  };
}
