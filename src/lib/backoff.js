const DEFAULT_OPTIONS = {
  retries: 3,
  baseDelayMs: 200,
  maxDelayMs: 2000,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeDelay(attempt, baseDelayMs, maxDelayMs) {
  const exponential = baseDelayMs * 2 ** attempt;
  const capped = Math.min(exponential, maxDelayMs);
  const jitter = Math.random() * capped * 0.2;
  return Math.ceil(capped + jitter);
}

function shouldRetry(error) {
  if (!error) {
    return false;
  }

  if (error.response) {
    const { status } = error.response;
    if (status === 429) {
      return true;
    }
    if (status >= 500 && status < 600) {
      return true;
    }
    return false;
  }

  if (error.code) {
    // retry on transient network errors
    return ['ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(error.code);
  }

  return false;
}

async function withBackoff(asyncFn, options = {}) {
  const { retries, baseDelayMs, maxDelayMs } = { ...DEFAULT_OPTIONS, ...options };

  let attempt = 0;
  while (true) {
    try {
      return await asyncFn(attempt);
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error)) {
        throw error;
      }
      const delay = computeDelay(attempt, baseDelayMs, maxDelayMs);
      await sleep(delay);
      attempt += 1;
    }
  }
}

module.exports = {
  withBackoff,
};
