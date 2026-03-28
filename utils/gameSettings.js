const GameSetting = require("../models/GameSetting");

const SETTINGS_KEY = "escape_the_ghost_runtime";

const DEFAULT_GAME_SETTINGS = {
  features: {
    depositsEnabled: true,
    withdrawalsEnabled: true,
    worldChatEnabled: true
  },
  ghost: {
    lowChance: 50,
    mediumChance: 30,
    highChance: 10,
    extremeChance: 10,
    lowRange: [1, 2],
    mediumRange: [2, 4],
    highRange: [4, 10],
    extremeRange: [10, 30],
    forcedCrashValue: null
  },
  powers: {
    freeze: { label: "Gel", enabled: true, priceUsd: 20, units: 2 },
    shield: { label: "Bouclier", enabled: true, priceUsd: 3, units: 2 },
    second_chance: { label: "Seconde chance", enabled: true, priceUsd: 60, units: 2 },
    vision: { label: "Vision", enabled: true, priceUsd: 10, units: 2 }
  }
};

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_GAME_SETTINGS));
}

function mergeDeep(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return override === undefined ? base : override;
  }

  const output = Array.isArray(base) ? [...base] : { ...(base || {}) };

  Object.keys(override).forEach((key) => {
    const baseValue = output[key];
    const overrideValue = override[key];

    if (
      baseValue &&
      overrideValue &&
      typeof baseValue === "object" &&
      typeof overrideValue === "object" &&
      !Array.isArray(baseValue) &&
      !Array.isArray(overrideValue)
    ) {
      output[key] = mergeDeep(baseValue, overrideValue);
      return;
    }

    output[key] = overrideValue;
  });

  return output;
}

async function getGameSettings() {
  const setting = await GameSetting.findOne({ key: SETTINGS_KEY });
  if (!setting) {
    return cloneDefaults();
  }

  return mergeDeep(cloneDefaults(), setting.value || {});
}

async function saveGameSettings(nextValue, adminId) {
  const mergedValue = mergeDeep(cloneDefaults(), nextValue || {});

  const setting = await GameSetting.findOneAndUpdate(
    { key: SETTINGS_KEY },
    {
      $set: {
        value: mergedValue,
        updatedAt: new Date(),
        ...(adminId ? { updatedBy: adminId } : {})
      },
      $setOnInsert: { createdAt: new Date() }
    },
    { upsert: true, new: true }
  );

  return mergeDeep(cloneDefaults(), setting.value || {});
}

module.exports = {
  SETTINGS_KEY,
  DEFAULT_GAME_SETTINGS,
  getGameSettings,
  saveGameSettings
};
