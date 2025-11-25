const isModuleContext = typeof module !== "undefined" && module.exports;

/**
 * FLOP-based energy model (GPT-4o proxy style) replacing the older linear
 * "energy per token" + "latency per token" logic.
 *
 * Units:
 * - Tokens: count
 * - FLOPs: floating point ops
 * - Power: watts
 * - Energy: watt-hours (Wh)
 * - Emissions factor: kgCO2e per kWh
 */
const ECOLOGITS_CONSTANTS = {
  // Datacenter / serving assumptions (representative; not OpenAI-specific)
  PUE: 1.2,

  // GPU/hardware assumptions (representative H100-class)
  GPU_POWER_WATTS: 700,          // W per GPU
  GPU_FLOPS_PER_SEC: 1.979e15,   // FLOP/s per GPU (BF16 peak-ish)
  PREFILL_UTILIZATION: 0.5,      // prefill tends to be more compute-bound
  DECODE_UTILIZATION: 0.1,       // decode tends to be more memory-bound

  // Server overhead (optional add-on)
  // Interpreted as *watts per 8-GPU node* excluding GPU power.
  SERVER_POWER_WITHOUT_GPU_WATTS: 800,

  // Node packing assumption for overhead scaling
  INSTALLED_GPUS_PER_NODE: 8,

  // Memory sizing for estimating numGPUs needed to host the model
  GPU_MEMORY_GB: 80, // H100 80GB class
  GPU_BITS: 4,       // assumed weight quantization bits for residency calc
  MEMORY_OVERHEAD_MULTIPLIER: 1.2, // activation/kv/fragmentation overhead

  // Emissions
  // Interpreted as kgCO2e per kWh (so we convert Wh -> kWh before multiplying)
  WORLD_EMISSION_FACTOR: 0.418
};

/**
 * "GPT-4o proxy" constants (from your notebook-style scaled model idea):
 * - ACTIVE_PARAMS: active non-embedding params used per token (proxy)
 * - ATTENTION_COEFF: a = 4 * L * h_q * d_h (proxy), drives attention FLOPs
 *
 * TOTAL_PARAMS is only used for numGPU memory residency estimation.
 */
const GPT5_PARAMS = {
  // Keep these fields for compatibility with your existing structure,
  // but note: ACTIVE_PARAMS here is set to the proxy's active params.
  TOTAL_PARAMS: 300e9,         // used only to estimate numGPUs (memory residency)
  ACTIVE_PARAMS: 1.0117e11,    // proxy active params (~101B)
  ACTIVE_PARAMS_BILLIONS: 101.17,
  ACTIVATION_RATIO: 0.2,

  // FLOP model constant a = 4*L*h_q*d_h (proxy)
  ATTENTION_COEFF: 2.6351e6
};

/**
 * Estimate FLOPs for prefill and decode given input/output tokens.
 * This mirrors the math you were using:
 *   F_prefill = 2*N_active*Tin + a*Tin^2
 *   F_decode  = 2*N_active*Tout + a*(Tin*Tout + Tout*(Tout-1)/2)
 */
function estimateFlops(inputTokens, outputTokens) {
  const Tin = Math.max(0, Number(inputTokens) || 0);
  const Tout = Math.max(0, Number(outputTokens) || 0);

  const N_active = GPT5_PARAMS.ACTIVE_PARAMS;
  const a = GPT5_PARAMS.ATTENTION_COEFF;

  const F_prefill = 2 * N_active * Tin + a * Tin * Tin;
  const F_decode =
    2 * N_active * Tout +
    a * (Tin * Tout + (Tout * (Tout - 1)) / 2);

  return { F_prefill, F_decode, F_total: F_prefill + F_decode };
}

/**
 * Estimate how many GPUs are needed to *host* the model weights in memory.
 * (Same basic idea as your old code, just clarified units.)
 */
function getNumGPUs() {
  const {
    GPU_MEMORY_GB,
    GPU_BITS,
    MEMORY_OVERHEAD_MULTIPLIER
  } = ECOLOGITS_CONSTANTS;

  const { TOTAL_PARAMS } = GPT5_PARAMS;

  // bytes needed for weights = params * bits/8, with overhead multiplier
  const memoryRequiredBytes =
    MEMORY_OVERHEAD_MULTIPLIER * TOTAL_PARAMS * (GPU_BITS / 8);

  const bytesPerGPU = GPU_MEMORY_GB * 1e9;
  return Math.max(1, Math.ceil(memoryRequiredBytes / bytesPerGPU));
}

/**
 * Main API: energy + emissions from input/output tokens.
 *
 * Backward-compat:
 * - If called as (outputTokens, method) like your old function,
 *   it assumes inputTokens = 0.
 */
function calculateEnergyAndEmissions(inputTokens, outputTokens, method = "flop_proxy") {
  // Backward-compatible signature: (outputTokens, method?)
  if (typeof outputTokens === "string" || typeof outputTokens === "undefined") {
    method = typeof outputTokens === "string" ? outputTokens : method;
    outputTokens = inputTokens;
    inputTokens = 0;
  }

  const Tin = Math.max(0, Number(inputTokens) || 0);
  const Tout = Math.max(0, Number(outputTokens) || 0);

  const {
    PUE,
    GPU_POWER_WATTS,
    GPU_FLOPS_PER_SEC,
    PREFILL_UTILIZATION,
    DECODE_UTILIZATION,
    SERVER_POWER_WITHOUT_GPU_WATTS,
    INSTALLED_GPUS_PER_NODE,
    WORLD_EMISSION_FACTOR
  } = ECOLOGITS_CONSTANTS;

  const numGPUs = getNumGPUs();

  const { F_prefill, F_decode, F_total } = estimateFlops(Tin, Tout);

  // Time (seconds) assuming perfect scaling across numGPUs
  const t_prefill_sec = F_prefill / (Math.max(1e-9, PREFILL_UTILIZATION) * numGPUs * GPU_FLOPS_PER_SEC);
  const t_decode_sec  = F_decode  / (Math.max(1e-9, DECODE_UTILIZATION)  * numGPUs * GPU_FLOPS_PER_SEC);
  const t_total_sec   = t_prefill_sec + t_decode_sec;

  // GPU energy (Wh): numGPUs * watts * seconds / 3600
  const gpuEnergyWh = (numGPUs * GPU_POWER_WATTS * t_total_sec) / 3600;

  // Optional server (non-GPU) overhead energy:
  // scale by fraction of a node used (numGPUs / INSTALLED_GPUS_PER_NODE)
  const serverOverheadWh =
    (SERVER_POWER_WITHOUT_GPU_WATTS * t_total_sec) / 3600 *
    (numGPUs / INSTALLED_GPUS_PER_NODE);

  // IT energy then facility energy via PUE
  const itEnergyWh = gpuEnergyWh + serverOverheadWh;
  const totalEnergyWh = PUE * itEnergyWh;

  // Prevent returning unrealistically tiny numbers
  const minEnergyWh = 0.01;
  const normalizedEnergyWh = Math.max(totalEnergyWh, minEnergyWh);

  // Emissions: (Wh -> kWh) * (kgCO2e/kWh)
  const co2EmissionsKg = (normalizedEnergyWh / 1000) * WORLD_EMISSION_FACTOR;

  return {
    numGPUs,
    totalEnergy: normalizedEnergyWh, // Wh
    co2Emissions: co2EmissionsKg,    // kgCO2e
    modelDetails: {
      totalParams: GPT5_PARAMS.TOTAL_PARAMS / 1e9,
      activeParams: GPT5_PARAMS.ACTIVE_PARAMS / 1e9,
      activationRatio: GPT5_PARAMS.ACTIVATION_RATIO,
      method,
      flopBreakdown: {
        prefillFlops: F_prefill,
        decodeFlops: F_decode,
        totalFlops: F_total
      }
    }
  };
}

/**
 * Energy per generated token depends on context length (Tin),
 * so this version takes inputTokens and optional outputTokens (default 1).
 */
function getEnergyPerToken(inputTokens = 0, outputTokens = 1) {
  const result = calculateEnergyAndEmissions(inputTokens, outputTokens, "flop_proxy");
  const Tout = Math.max(1, Number(outputTokens) || 1);
  return result.totalEnergy / Tout; // Wh per output token
}

// Browser globals
if (typeof window !== "undefined") {
  window.ECOLOGITS_CONSTANTS = ECOLOGITS_CONSTANTS;
  window.GPT5_PARAMS = GPT5_PARAMS;
  window.calculateEnergyAndEmissions = calculateEnergyAndEmissions;
  window.getEnergyPerToken = getEnergyPerToken;
  window.getNumGPUs = getNumGPUs;
  window.estimateFlops = estimateFlops;
}

// CommonJS exports
if (isModuleContext) {
  module.exports = {
    ECOLOGITS_CONSTANTS,
    GPT5_PARAMS,
    calculateEnergyAndEmissions,
    getEnergyPerToken,
    getNumGPUs,
    estimateFlops
  };
}
