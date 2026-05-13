/****************************************************
 * SURF / CERT MATURITY MODULE
 * Sandbox + Strength Gate + Portfolio Decision
 * Live Protection + Allocation Limits
 ****************************************************/

const SURF_CONFIG = {
  mode: "SANDBOX", // SANDBOX or LIVE

  maxCoinsReviewed: 20,
  minQualifiedCoins: 3,

  sandboxMinBalance: 100,
  sandboxMaxBalance: 100000,

  liveRequiresSecretCode: true,
  liveSecretCode: "SURF-LIVE-2026",

  limits: {
    maxTradeAmount: 250,
    maxDailyAllocation: 1000,
    maxWeeklyAllocation: 3000,
    maxActiveCoins: 5,
    maxLossPercent: 5,
    maxDrawdownPercent: 10
  }
};

function evaluateCoinStrength(coin) {
  const { deep_dd, vol_high, whale, breakout } = coin;
  const passedCount = [deep_dd, vol_high, whale, breakout].filter(Boolean).length;

  let stage = "IDLE";
  let action = "SKIP";
  let shouldRemove = false;
  let reason = "";

  if (deep_dd && vol_high && whale && breakout) {
    stage = "GO";
    action = "BUY";
    reason = "All strength signals confirmed.";
  } else if ((deep_dd && vol_high) || (whale && breakout)) {
    stage = "READY";
    action = "PREP";
    reason = "Strong paired confirmation detected.";
  } else if (vol_high || breakout) {
    stage = "WATCH";
    action = "OBSERVE";
    reason = "Early activity detected, but not enough confirmation.";
  } else {
    stage = "IDLE";
    action = "SKIP";
    shouldRemove = true;
    reason = "Insufficient strength signals.";
  }

  return {
    ...coin,
    stage,
    action,
    shouldRemove,
    passedCount,
    reason
  };
}

function getPortfolioDecision(results) {
  const approvedCoins = results.filter(r => !r.shouldRemove);
  const removedCoins = results.filter(r => r.shouldRemove);

  const goCount = approvedCoins.filter(r => r.stage === "GO").length;
  const readyCount = approvedCoins.filter(r => r.stage === "READY").length;

  if (approvedCoins.length === 0) {
    return {
      decision: "WAIT",
      recommendation: "Do not allocate.",
      reason: "No coins passed the strength test.",
      approvedCoins,
      removedCoins
    };
  }

  if (approvedCoins.length < SURF_CONFIG.minQualifiedCoins) {
    return {
      decision: "WAIT",
      recommendation: "Do not force allocation.",
      reason: `Only ${approvedCoins.length} coin(s) passed. Minimum required is ${SURF_CONFIG.minQualifiedCoins}.`,
      approvedCoins,
      removedCoins
    };
  }

  if (goCount >= 2) {
    return {
      decision: "EXECUTE",
      recommendation: "Allocation may proceed inside approved limits.",
      reason: "Multiple high-confidence coins passed the strength gate.",
      approvedCoins,
      removedCoins
    };
  }

  if (readyCount >= SURF_CONFIG.minQualifiedCoins) {
    return {
      decision: "PREPARE",
      recommendation: "Prepare, but do not rush execution.",
      reason: "Enough coins are forming strong setups, but confirmation is not complete.",
      approvedCoins,
      removedCoins
    };
  }

  return {
    decision: "WATCH",
    recommendation: "Observe only.",
    reason: "Some coins passed, but the portfolio field is not strong enough.",
    approvedCoins,
    removedCoins
  };
}

function validateSandboxBalance(balance) {
  if (balance < SURF_CONFIG.sandboxMinBalance) {
    return {
      valid: false,
      reason: `Sandbox balance must be at least $${SURF_CONFIG.sandboxMinBalance}.`
    };
  }

  if (balance > SURF_CONFIG.sandboxMaxBalance) {
    return {
      valid: false,
      reason: `Sandbox balance cannot exceed $${SURF_CONFIG.sandboxMaxBalance}.`
    };
  }

  return {
    valid: true,
    reason: "Sandbox balance accepted."
  };
}

function validateLiveAccess(secretCode) {
  if (SURF_CONFIG.mode !== "LIVE") {
    return {
      allowed: true,
      reason: "Sandbox mode does not require live access."
    };
  }

  if (!SURF_CONFIG.liveRequiresSecretCode) {
    return {
      allowed: true,
      reason: "Live access code not required."
    };
  }

  if (secretCode !== SURF_CONFIG.liveSecretCode) {
    return {
      allowed: false,
      reason: "Live access denied. Secret code is incorrect."
    };
  }

  return {
    allowed: true,
    reason: "Live access approved."
  };
}

function checkAllocationLimits({ amount, dailyAllocated, weeklyAllocated, activeCoins }) {
  if (amount > SURF_CONFIG.limits.maxTradeAmount) {
    return {
      allowed: false,
      reason: `Trade exceeds max trade amount of $${SURF_CONFIG.limits.maxTradeAmount}.`
    };
  }

  if (dailyAllocated + amount > SURF_CONFIG.limits.maxDailyAllocation) {
    return {
      allowed: false,
      reason: `Trade exceeds daily allocation limit of $${SURF_CONFIG.limits.maxDailyAllocation}.`
    };
  }

  if (weeklyAllocated + amount > SURF_CONFIG.limits.maxWeeklyAllocation) {
    return {
      allowed: false,
      reason: `Trade exceeds weekly allocation limit of $${SURF_CONFIG.limits.maxWeeklyAllocation}.`
    };
  }

  if (activeCoins > SURF_CONFIG.limits.maxActiveCoins) {
    return {
      allowed: false,
      reason: `Too many active coins. Max allowed is ${SURF_CONFIG.limits.maxActiveCoins}.`
    };
  }

  return {
    allowed: true,
    reason: "Allocation is inside approved limits."
  };
}

function runSurfCertCycle({
  coins,
  balance,
  requestedTradeAmount = 0,
  dailyAllocated = 0,
  weeklyAllocated = 0,
  secretCode = ""
}) {
  const reviewedCoins = coins
    .slice(0, SURF_CONFIG.maxCoinsReviewed)
    .map(evaluateCoinStrength);

  const portfolioDecision = getPortfolioDecision(reviewedCoins);

  const sandboxCheck =
    SURF_CONFIG.mode === "SANDBOX"
      ? validateSandboxBalance(balance)
      : { valid: true, reason: "Live balance mode." };

  const liveCheck = validateLiveAccess(secretCode);

  const allocationCheck = checkAllocationLimits({
    amount: requestedTradeAmount,
    dailyAllocated,
    weeklyAllocated,
    activeCoins: portfolioDecision.approvedCoins.length
  });

  const canProceed =
    portfolioDecision.decision === "EXECUTE" &&
    sandboxCheck.valid &&
    liveCheck.allowed &&
    allocationCheck.allowed;

  return {
    mode: SURF_CONFIG.mode,

    totalReviewed: reviewedCoins.length,
    totalApproved: portfolioDecision.approvedCoins.length,
    totalRemoved: portfolioDecision.removedCoins.length,

    decision: portfolioDecision.decision,
    recommendation: portfolioDecision.recommendation,
    reason: portfolioDecision.reason,

    canProceed,

    sandboxCheck,
    liveCheck,
    allocationCheck,

    approvedCoins: portfolioDecision.approvedCoins,
    removedCoins: portfolioDecision.removedCoins,
    reviewedCoins
  };
}
