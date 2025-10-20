// Today: in-memory/localStorage passthrough to EmpireContext.
// Tomorrow: swap to real HTTP calls to FastAPI (keep same methods).

export const empireApi = {
  async chooseFaction({ choose }, faction) {
    choose(faction);
    return { ok: true };
  },

  async award({ award }, tokensDict) {
    award(tokensDict);
    return { ok: true };
  },

  async recordHeist({ record }, result) {
    record(result); // "win" | "loss"
    return { ok: true };
  },
};
