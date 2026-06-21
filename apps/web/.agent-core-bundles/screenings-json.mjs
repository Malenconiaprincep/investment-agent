var __getOwnPropNames = Object.getOwnPropertyNames;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// ../../node_modules/.pnpm/dotenv@17.4.2/node_modules/dotenv/lib/main.js
var require_main = __commonJS({
  "../../node_modules/.pnpm/dotenv@17.4.2/node_modules/dotenv/lib/main.js"(exports, module) {
    var fs = __require("fs");
    var path4 = __require("path");
    var os = __require("os");
    var crypto2 = __require("crypto");
    var TIPS = [
      "\u25C8 encrypted .env [www.dotenvx.com]",
      "\u25C8 secrets for agents [www.dotenvx.com]",
      "\u2301 auth for agents [www.vestauth.com]",
      "\u2318 custom filepath { path: '/custom/path/.env' }",
      "\u2318 enable debugging { debug: true }",
      "\u2318 override existing { override: true }",
      "\u2318 suppress logs { quiet: true }",
      "\u2318 multiple files { path: ['.env.local', '.env'] }"
    ];
    function _getRandomTip() {
      return TIPS[Math.floor(Math.random() * TIPS.length)];
    }
    function parseBoolean(value) {
      if (typeof value === "string") {
        return !["false", "0", "no", "off", ""].includes(value.toLowerCase());
      }
      return Boolean(value);
    }
    function supportsAnsi() {
      return process.stdout.isTTY;
    }
    function dim(text) {
      return supportsAnsi() ? `\x1B[2m${text}\x1B[0m` : text;
    }
    var LINE = /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/mg;
    function parse(src) {
      const obj = {};
      let lines = src.toString();
      lines = lines.replace(/\r\n?/mg, "\n");
      let match;
      while ((match = LINE.exec(lines)) != null) {
        const key = match[1];
        let value = match[2] || "";
        value = value.trim();
        const maybeQuote = value[0];
        value = value.replace(/^(['"`])([\s\S]*)\1$/mg, "$2");
        if (maybeQuote === '"') {
          value = value.replace(/\\n/g, "\n");
          value = value.replace(/\\r/g, "\r");
        }
        obj[key] = value;
      }
      return obj;
    }
    function _parseVault(options) {
      options = options || {};
      const vaultPath = _vaultPath(options);
      options.path = vaultPath;
      const result = DotenvModule.configDotenv(options);
      if (!result.parsed) {
        const err = new Error(`MISSING_DATA: Cannot parse ${vaultPath} for an unknown reason`);
        err.code = "MISSING_DATA";
        throw err;
      }
      const keys = _dotenvKey(options).split(",");
      const length = keys.length;
      let decrypted;
      for (let i = 0; i < length; i++) {
        try {
          const key = keys[i].trim();
          const attrs = _instructions(result, key);
          decrypted = DotenvModule.decrypt(attrs.ciphertext, attrs.key);
          break;
        } catch (error) {
          if (i + 1 >= length) {
            throw error;
          }
        }
      }
      return DotenvModule.parse(decrypted);
    }
    function _warn(message) {
      console.error(`\u26A0 ${message}`);
    }
    function _debug(message) {
      console.log(`\u2506 ${message}`);
    }
    function _log(message) {
      console.log(`\u25C7 ${message}`);
    }
    function _dotenvKey(options) {
      if (options && options.DOTENV_KEY && options.DOTENV_KEY.length > 0) {
        return options.DOTENV_KEY;
      }
      if (process.env.DOTENV_KEY && process.env.DOTENV_KEY.length > 0) {
        return process.env.DOTENV_KEY;
      }
      return "";
    }
    function _instructions(result, dotenvKey) {
      let uri;
      try {
        uri = new URL(dotenvKey);
      } catch (error) {
        if (error.code === "ERR_INVALID_URL") {
          const err = new Error("INVALID_DOTENV_KEY: Wrong format. Must be in valid uri format like dotenv://:key_1234@dotenvx.com/vault/.env.vault?environment=development");
          err.code = "INVALID_DOTENV_KEY";
          throw err;
        }
        throw error;
      }
      const key = uri.password;
      if (!key) {
        const err = new Error("INVALID_DOTENV_KEY: Missing key part");
        err.code = "INVALID_DOTENV_KEY";
        throw err;
      }
      const environment = uri.searchParams.get("environment");
      if (!environment) {
        const err = new Error("INVALID_DOTENV_KEY: Missing environment part");
        err.code = "INVALID_DOTENV_KEY";
        throw err;
      }
      const environmentKey = `DOTENV_VAULT_${environment.toUpperCase()}`;
      const ciphertext = result.parsed[environmentKey];
      if (!ciphertext) {
        const err = new Error(`NOT_FOUND_DOTENV_ENVIRONMENT: Cannot locate environment ${environmentKey} in your .env.vault file.`);
        err.code = "NOT_FOUND_DOTENV_ENVIRONMENT";
        throw err;
      }
      return { ciphertext, key };
    }
    function _vaultPath(options) {
      let possibleVaultPath = null;
      if (options && options.path && options.path.length > 0) {
        if (Array.isArray(options.path)) {
          for (const filepath of options.path) {
            if (fs.existsSync(filepath)) {
              possibleVaultPath = filepath.endsWith(".vault") ? filepath : `${filepath}.vault`;
            }
          }
        } else {
          possibleVaultPath = options.path.endsWith(".vault") ? options.path : `${options.path}.vault`;
        }
      } else {
        possibleVaultPath = path4.resolve(process.cwd(), ".env.vault");
      }
      if (fs.existsSync(possibleVaultPath)) {
        return possibleVaultPath;
      }
      return null;
    }
    function _resolveHome(envPath) {
      return envPath[0] === "~" ? path4.join(os.homedir(), envPath.slice(1)) : envPath;
    }
    function _configVault(options) {
      const debug = parseBoolean(process.env.DOTENV_CONFIG_DEBUG || options && options.debug);
      const quiet = parseBoolean(process.env.DOTENV_CONFIG_QUIET || options && options.quiet);
      if (debug || !quiet) {
        _log("loading env from encrypted .env.vault");
      }
      const parsed = DotenvModule._parseVault(options);
      let processEnv = process.env;
      if (options && options.processEnv != null) {
        processEnv = options.processEnv;
      }
      DotenvModule.populate(processEnv, parsed, options);
      return { parsed };
    }
    function configDotenv(options) {
      const dotenvPath = path4.resolve(process.cwd(), ".env");
      let encoding = "utf8";
      let processEnv = process.env;
      if (options && options.processEnv != null) {
        processEnv = options.processEnv;
      }
      let debug = parseBoolean(processEnv.DOTENV_CONFIG_DEBUG || options && options.debug);
      let quiet = parseBoolean(processEnv.DOTENV_CONFIG_QUIET || options && options.quiet);
      if (options && options.encoding) {
        encoding = options.encoding;
      } else {
        if (debug) {
          _debug("no encoding is specified (UTF-8 is used by default)");
        }
      }
      let optionPaths = [dotenvPath];
      if (options && options.path) {
        if (!Array.isArray(options.path)) {
          optionPaths = [_resolveHome(options.path)];
        } else {
          optionPaths = [];
          for (const filepath of options.path) {
            optionPaths.push(_resolveHome(filepath));
          }
        }
      }
      let lastError;
      const parsedAll = {};
      for (const path5 of optionPaths) {
        try {
          const parsed = DotenvModule.parse(fs.readFileSync(path5, { encoding }));
          DotenvModule.populate(parsedAll, parsed, options);
        } catch (e) {
          if (debug) {
            _debug(`failed to load ${path5} ${e.message}`);
          }
          lastError = e;
        }
      }
      const populated = DotenvModule.populate(processEnv, parsedAll, options);
      debug = parseBoolean(processEnv.DOTENV_CONFIG_DEBUG || debug);
      quiet = parseBoolean(processEnv.DOTENV_CONFIG_QUIET || quiet);
      if (debug || !quiet) {
        const keysCount = Object.keys(populated).length;
        const shortPaths = [];
        for (const filePath of optionPaths) {
          try {
            const relative = path4.relative(process.cwd(), filePath);
            shortPaths.push(relative);
          } catch (e) {
            if (debug) {
              _debug(`failed to load ${filePath} ${e.message}`);
            }
            lastError = e;
          }
        }
        _log(`injected env (${keysCount}) from ${shortPaths.join(",")} ${dim(`// tip: ${_getRandomTip()}`)}`);
      }
      if (lastError) {
        return { parsed: parsedAll, error: lastError };
      } else {
        return { parsed: parsedAll };
      }
    }
    function config(options) {
      if (_dotenvKey(options).length === 0) {
        return DotenvModule.configDotenv(options);
      }
      const vaultPath = _vaultPath(options);
      if (!vaultPath) {
        _warn(`you set DOTENV_KEY but you are missing a .env.vault file at ${vaultPath}`);
        return DotenvModule.configDotenv(options);
      }
      return DotenvModule._configVault(options);
    }
    function decrypt(encrypted, keyStr) {
      const key = Buffer.from(keyStr.slice(-64), "hex");
      let ciphertext = Buffer.from(encrypted, "base64");
      const nonce = ciphertext.subarray(0, 12);
      const authTag = ciphertext.subarray(-16);
      ciphertext = ciphertext.subarray(12, -16);
      try {
        const aesgcm = crypto2.createDecipheriv("aes-256-gcm", key, nonce);
        aesgcm.setAuthTag(authTag);
        return `${aesgcm.update(ciphertext)}${aesgcm.final()}`;
      } catch (error) {
        const isRange = error instanceof RangeError;
        const invalidKeyLength = error.message === "Invalid key length";
        const decryptionFailed = error.message === "Unsupported state or unable to authenticate data";
        if (isRange || invalidKeyLength) {
          const err = new Error("INVALID_DOTENV_KEY: It must be 64 characters long (or more)");
          err.code = "INVALID_DOTENV_KEY";
          throw err;
        } else if (decryptionFailed) {
          const err = new Error("DECRYPTION_FAILED: Please check your DOTENV_KEY");
          err.code = "DECRYPTION_FAILED";
          throw err;
        } else {
          throw error;
        }
      }
    }
    function populate(processEnv, parsed, options = {}) {
      const debug = Boolean(options && options.debug);
      const override = Boolean(options && options.override);
      const populated = {};
      if (typeof parsed !== "object") {
        const err = new Error("OBJECT_REQUIRED: Please check the processEnv argument being passed to populate");
        err.code = "OBJECT_REQUIRED";
        throw err;
      }
      for (const key of Object.keys(parsed)) {
        if (Object.prototype.hasOwnProperty.call(processEnv, key)) {
          if (override === true) {
            processEnv[key] = parsed[key];
            populated[key] = parsed[key];
          }
          if (debug) {
            if (override === true) {
              _debug(`"${key}" is already defined and WAS overwritten`);
            } else {
              _debug(`"${key}" is already defined and was NOT overwritten`);
            }
          }
        } else {
          processEnv[key] = parsed[key];
          populated[key] = parsed[key];
        }
      }
      return populated;
    }
    var DotenvModule = {
      configDotenv,
      _configVault,
      _parseVault,
      config,
      decrypt,
      parse,
      populate
    };
    module.exports.configDotenv = DotenvModule.configDotenv;
    module.exports._configVault = DotenvModule._configVault;
    module.exports._parseVault = DotenvModule._parseVault;
    module.exports.config = DotenvModule.config;
    module.exports.decrypt = DotenvModule.decrypt;
    module.exports.parse = DotenvModule.parse;
    module.exports.populate = DotenvModule.populate;
    module.exports = DotenvModule;
  }
});

// ../../node_modules/.pnpm/dotenv@17.4.2/node_modules/dotenv/lib/env-options.js
var require_env_options = __commonJS({
  "../../node_modules/.pnpm/dotenv@17.4.2/node_modules/dotenv/lib/env-options.js"(exports, module) {
    var options = {};
    if (process.env.DOTENV_CONFIG_ENCODING != null) {
      options.encoding = process.env.DOTENV_CONFIG_ENCODING;
    }
    if (process.env.DOTENV_CONFIG_PATH != null) {
      options.path = process.env.DOTENV_CONFIG_PATH;
    }
    if (process.env.DOTENV_CONFIG_QUIET != null) {
      options.quiet = process.env.DOTENV_CONFIG_QUIET;
    }
    if (process.env.DOTENV_CONFIG_DEBUG != null) {
      options.debug = process.env.DOTENV_CONFIG_DEBUG;
    }
    if (process.env.DOTENV_CONFIG_OVERRIDE != null) {
      options.override = process.env.DOTENV_CONFIG_OVERRIDE;
    }
    if (process.env.DOTENV_CONFIG_DOTENV_KEY != null) {
      options.DOTENV_KEY = process.env.DOTENV_CONFIG_DOTENV_KEY;
    }
    module.exports = options;
  }
});

// ../../node_modules/.pnpm/dotenv@17.4.2/node_modules/dotenv/lib/cli-options.js
var require_cli_options = __commonJS({
  "../../node_modules/.pnpm/dotenv@17.4.2/node_modules/dotenv/lib/cli-options.js"(exports, module) {
    var re = /^dotenv_config_(encoding|path|quiet|debug|override|DOTENV_KEY)=(.+)$/;
    module.exports = function optionMatcher(args) {
      const options = args.reduce(function(acc, cur) {
        const matches = cur.match(re);
        if (matches) {
          acc[matches[1]] = matches[2];
        }
        return acc;
      }, {});
      if (!("quiet" in options)) {
        options.quiet = "true";
      }
      return options;
    };
  }
});

// ../../node_modules/.pnpm/dotenv@17.4.2/node_modules/dotenv/config.js
(function() {
  require_main().config(
    Object.assign(
      {},
      require_env_options(),
      require_cli_options()(process.argv)
    )
  );
})();

// ../../packages/agent-core/src/cli/screenings-json.ts
import { readFileSync as readFileSync2 } from "node:fs";

// ../../packages/agent-core/src/data/screening/compare.ts
function sectorKey(name) {
  return name.trim().toLowerCase();
}
function candidateKey(symbol) {
  return symbol.trim();
}
function compareScreeningSessions(base, target) {
  const baseSectorKeys = new Set(base.sectors.map((s) => sectorKey(s.name)));
  const targetSectorKeys = new Set(
    target.sectors.map((s) => sectorKey(s.name))
  );
  const baseCandidateKeys = new Set(
    base.candidates.map((c) => candidateKey(c.symbol))
  );
  const targetCandidateKeys = new Set(
    target.candidates.map((c) => candidateKey(c.symbol))
  );
  return {
    base: {
      id: base.id,
      query: base.query,
      createdAt: base.createdAt
    },
    target: {
      id: target.id,
      query: target.query,
      createdAt: target.createdAt
    },
    sectors: {
      added: target.sectors.filter(
        (s) => !baseSectorKeys.has(sectorKey(s.name))
      ),
      removed: base.sectors.filter(
        (s) => !targetSectorKeys.has(sectorKey(s.name))
      ),
      kept: base.sectors.filter(
        (s) => targetSectorKeys.has(sectorKey(s.name))
      )
    },
    candidates: {
      added: target.candidates.filter(
        (c) => !baseCandidateKeys.has(candidateKey(c.symbol))
      ),
      removed: base.candidates.filter(
        (c) => !targetCandidateKeys.has(candidateKey(c.symbol))
      ),
      kept: base.candidates.filter(
        (c) => targetCandidateKeys.has(candidateKey(c.symbol))
      )
    }
  };
}

// ../../packages/agent-core/src/data/market/cache.ts
var store = /* @__PURE__ */ new Map();
function getCached(key) {
  const entry = store.get(key);
  if (!entry) return void 0;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return void 0;
  }
  return entry.value;
}
function setCached(key, value, ttlMs) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

// ../../packages/agent-core/src/lib/retry.ts
var DEFAULT_SHOULD_RETRY = (error) => {
  if (error instanceof Error) {
    return /timeout|ECONNRESET|ENOTFOUND|429|503/i.test(error.message);
  }
  return false;
};
async function retryWithBackoff(fn, options = {}) {
  const {
    maxAttempts = 3,
    baseDelayMs = 300,
    maxDelayMs = 3e3,
    shouldRetry = DEFAULT_SHOULD_RETRY
  } = options;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetry(error, attempt)) {
        throw error;
      }
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

// ../../packages/agent-core/src/lib/safe-fetch.ts
var DEFAULT_ALLOWED_HOSTS = [
  "api.deepseek.com",
  "geocoding-api.open-meteo.com",
  "api.open-meteo.com"
];
async function safeFetch(url, init, options = {}) {
  const {
    timeoutMs = 1e4,
    allowedHosts = DEFAULT_ALLOWED_HOSTS,
    retries = 2
  } = options;
  const parsed = new URL(url);
  if (!allowedHosts.includes(parsed.hostname)) {
    throw new Error(
      `Host not allowed: ${parsed.hostname}. Allowed: ${allowedHosts.join(", ")}`
    );
  }
  return retryWithBackoff(
    async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          ...init,
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} for ${url}`);
        }
        return response;
      } finally {
        clearTimeout(timer);
      }
    },
    { maxAttempts: retries + 1 }
  );
}

// ../../packages/agent-core/src/data/market/free/eastmoney.ts
var TTL_MS = {
  snapshot: 30 * 60 * 1e3,
  profile: 24 * 60 * 60 * 1e3,
  financial: 24 * 60 * 60 * 1e3,
  announcements: 6 * 60 * 60 * 1e3,
  news: 60 * 60 * 1e3,
  industry: 24 * 60 * 60 * 1e3
};

// ../../packages/agent-core/src/data/market/free/tencent.ts
var TTL_MS2 = 60 * 60 * 1e3;
function toTencentCode(symbol) {
  const code = symbol.trim();
  if (code.startsWith("6")) return `sh${code}`;
  if (code.startsWith("0") || code.startsWith("3")) return `sz${code}`;
  if (code.startsWith("8") || code.startsWith("4")) return `bj${code}`;
  throw new Error(`\u65E0\u6CD5\u8BC6\u522B\u4EA4\u6613\u6240: ${symbol}`);
}
async function fetchDailyKlines(symbol, days) {
  const cacheKey = `tx:kline:${symbol}:${days}`;
  const cached = getCached(cacheKey);
  if (cached) return { quotes: cached, cached: true };
  const txCode = toTencentCode(symbol);
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${txCode},day,,,${days},qfq`;
  const response = await safeFetch(url, void 0, {
    allowedHosts: ["web.ifzq.gtimg.cn"]
  });
  const json = await response.json();
  const rows = json.data?.[txCode]?.qfqday ?? [];
  if (rows.length === 0) {
    throw new Error(`\u6682\u65E0\u884C\u60C5\u6570\u636E: ${symbol}`);
  }
  const quotes = mapKlines(rows);
  setCached(cacheKey, quotes, TTL_MS2);
  return { quotes, cached: false };
}
function mapKlines(rows) {
  return rows.map(([tradeDate, open, close, high, low, vol]) => {
    const openNum = Number(open);
    const closeNum = Number(close);
    return {
      tradeDate: tradeDate.replace(/-/g, ""),
      open: Number.isFinite(openNum) ? openNum : null,
      high: Number.isFinite(Number(high)) ? Number(high) : null,
      low: Number.isFinite(Number(low)) ? Number(low) : null,
      close: Number.isFinite(closeNum) ? closeNum : null,
      pctChg: Number.isFinite(openNum) && openNum > 0 ? Number(((closeNum - openNum) / openNum * 100).toFixed(2)) : null,
      vol: Number.isFinite(Number(vol)) ? Number(vol) : null,
      amount: null
    };
  }).reverse();
}

// ../../packages/agent-core/src/data/market/types.ts
var MARKET_DISCLAIMER = "\u6570\u636E\u6765\u81EA\u4E1C\u65B9\u8D22\u5BCC/\u817E\u8BAF\u516C\u5F00\u63A5\u53E3\uFF0C\u4EC5\u4F9B\u5B66\u4E60\u7814\u7A76\uFF0C\u4E0D\u6784\u6210\u6295\u8D44\u5EFA\u8BAE\u3002\u63A5\u53E3\u975E\u5B98\u65B9\u6388\u6743\uFF0C\u8BF7\u63A7\u5236\u8BF7\u6C42\u9891\u7387\u3002";

// ../../packages/agent-core/src/data/market/meta.ts
function buildMeta(dataSource, cached) {
  return {
    dataSource,
    asOf: (/* @__PURE__ */ new Date()).toISOString(),
    cached,
    disclaimer: MARKET_DISCLAIMER
  };
}

// ../../packages/agent-core/src/data/market/symbols.ts
function toTsCode(symbol) {
  const code = symbol.trim().toUpperCase();
  if (code.includes(".")) {
    return code;
  }
  if (!/^\d{6}$/.test(code)) {
    throw new Error(`\u65E0\u6548\u80A1\u7968\u4EE3\u7801: ${symbol}\uFF0C\u9700\u8981 6 \u4F4D\u6570\u5B57`);
  }
  if (code.startsWith("6")) return `${code}.SH`;
  if (code.startsWith("0") || code.startsWith("3")) return `${code}.SZ`;
  if (code.startsWith("8") || code.startsWith("4")) return `${code}.BJ`;
  throw new Error(`\u65E0\u6CD5\u8BC6\u522B\u4EA4\u6613\u6240\u540E\u7F00: ${symbol}`);
}
function toSymbol(tsCode) {
  return tsCode.split(".")[0] ?? tsCode;
}

// ../../packages/agent-core/src/data/market/services.ts
async function getDailyQuote(symbol, days = 5) {
  const tsCode = toTsCode(symbol);
  const code = toSymbol(tsCode);
  const { quotes, cached } = await fetchDailyKlines(code, days);
  const withPct = quotes.map((quote, index) => {
    const prev = quotes[index + 1];
    const pctChg = prev?.close && quote.close ? Number(((quote.close - prev.close) / prev.close * 100).toFixed(2)) : quote.pctChg;
    return { ...quote, pctChg };
  });
  const latest = withPct[0];
  return {
    tsCode,
    quotes: withPct,
    latestClose: latest?.close ?? null,
    latestPctChg: latest?.pctChg ?? null,
    ...buildMeta("tencent", cached)
  };
}

// ../../packages/agent-core/src/data/screening/backtest.ts
function parseTradeDate(tradeDate) {
  const y = tradeDate.slice(0, 4);
  const m = tradeDate.slice(4, 6);
  const d = tradeDate.slice(6, 8);
  return /* @__PURE__ */ new Date(`${y}-${m}-${d}T00:00:00+08:00`);
}
function findBaselineQuote(quotes, screenedAt) {
  const target = new Date(screenedAt).getTime();
  let best = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const quote of quotes) {
    if (quote.close == null) continue;
    const delta = Math.abs(parseTradeDate(quote.tradeDate).getTime() - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = quote;
    }
  }
  return best;
}
function sortQuotesAsc(quotes) {
  return [...quotes].filter((quote) => quote.close != null).sort(
    (a, b) => parseTradeDate(a.tradeDate).getTime() - parseTradeDate(b.tradeDate).getTime()
  );
}
function findHoldEndQuote(quotes, baseline, holdDays) {
  const sorted = sortQuotesAsc(quotes);
  const baselineIndex = sorted.findIndex(
    (quote) => quote.tradeDate === baseline.tradeDate
  );
  if (baselineIndex < 0) return null;
  const endIndex = baselineIndex + holdDays;
  if (endIndex >= sorted.length) {
    return sorted.at(-1) ?? null;
  }
  return sorted[endIndex] ?? null;
}
function computeKlineDaysNeeded(screenedAt, holdDays = 0) {
  const elapsedCalendarDays = Math.max(
    1,
    Math.ceil(
      (Date.now() - new Date(screenedAt).getTime()) / (24 * 60 * 60 * 1e3)
    )
  );
  const tradingEstimate = Math.ceil(elapsedCalendarDays * 5 / 7);
  return Math.min(Math.max(tradingEstimate + 15, holdDays + 15, 30), 250);
}
async function computeScreeningBacktest(input) {
  const holdDays = input.holdDays ?? 0;
  const mode = holdDays > 0 ? "fixed" : "to-today";
  const klineDays = computeKlineDaysNeeded(input.screenedAt, holdDays);
  const results = [];
  for (const candidate of input.candidates) {
    try {
      const data = await getDailyQuote(candidate.symbol, klineDays);
      const baseline = findBaselineQuote(data.quotes, input.screenedAt);
      const baselineClose = baseline?.close ?? null;
      const endQuote = mode === "to-today" ? {
        tradeDate: data.quotes[0]?.tradeDate ?? null,
        close: data.latestClose
      } : baseline ? findHoldEndQuote(data.quotes, baseline, holdDays) : null;
      const latestClose = endQuote?.close ?? null;
      const latestDate = endQuote?.tradeDate ?? null;
      let returnPct = null;
      if (baselineClose != null && latestClose != null && baselineClose > 0) {
        returnPct = Number(
          ((latestClose - baselineClose) / baselineClose * 100).toFixed(2)
        );
      }
      results.push({
        symbol: candidate.symbol,
        name: candidate.name,
        baselineDate: baseline?.tradeDate ?? null,
        baselineClose,
        latestDate,
        latestClose,
        returnPct,
        holdDays: mode === "fixed" ? holdDays : 0
      });
    } catch (error) {
      results.push({
        symbol: candidate.symbol,
        name: candidate.name,
        baselineDate: null,
        baselineClose: null,
        latestDate: null,
        latestClose: null,
        returnPct: null,
        holdDays,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  const validReturns = results.map((item) => item.returnPct).filter((value) => value != null);
  const avgReturnPct = validReturns.length > 0 ? Number(
    (validReturns.reduce((sum, value) => sum + value, 0) / validReturns.length).toFixed(2)
  ) : null;
  return {
    screeningId: input.screeningId,
    screenedAt: input.screenedAt,
    holdDays,
    mode,
    computedAt: (/* @__PURE__ */ new Date()).toISOString(),
    candidates: results,
    avgReturnPct
  };
}

// ../../packages/agent-core/src/data/screening/store.ts
import { createClient } from "@libsql/client";

// ../../packages/agent-core/src/data/libsql-config.ts
import { mkdirSync as mkdirSync2 } from "node:fs";
import path2 from "node:path";

// ../../packages/agent-core/src/mastra/config/paths.ts
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
var PACKAGE_NAME = "@investment-agent/agent-core";
function resolvePackageRoot() {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    const pkgPath = path.join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.name === PACKAGE_NAME) {
          return dir;
        }
      } catch {
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}
var packageRoot = resolvePackageRoot();
var DATA_DIR = path.join(packageRoot, "src/data");
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

// ../../packages/agent-core/src/data/libsql-config.ts
function vercelDataDir() {
  const dir = path2.join("/tmp", "investment-agent-data");
  mkdirSync2(dir, { recursive: true });
  return dir;
}
function fileDbUrl(filename) {
  if (process.env.VERCEL) {
    return `file:${path2.join(vercelDataDir(), filename)}`;
  }
  return `file:${path2.join(DATA_DIR, filename)}`;
}
function getPrimaryLibsqlOptions(filename = "research-reports.db") {
  const remoteUrl = process.env.LIBSQL_URL?.trim();
  if (remoteUrl) {
    const authToken = process.env.LIBSQL_AUTH_TOKEN?.trim();
    return authToken ? { url: remoteUrl, authToken } : { url: remoteUrl };
  }
  return { url: fileDbUrl(filename) };
}

// ../../packages/agent-core/src/data/screening/store.ts
var client = null;
var migrated = false;
async function getDb() {
  if (!client) {
    client = createClient(getPrimaryLibsqlOptions());
  }
  if (!migrated) {
    await client.batch([
      `CREATE TABLE IF NOT EXISTS screening_sessions (
        id TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        sectors TEXT NOT NULL,
        candidates TEXT NOT NULL,
        rotation_summary TEXT NOT NULL,
        hot_news TEXT NOT NULL DEFAULT '[]',
        hot_themes TEXT NOT NULL DEFAULT '[]',
        mode TEXT NOT NULL DEFAULT 'auto',
        passed INTEGER NOT NULL DEFAULT 0,
        elapsed_ms INTEGER,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS committee_sessions (
        id TEXT PRIMARY KEY,
        screening_session_id TEXT,
        candidates TEXT NOT NULL,
        memo TEXT NOT NULL,
        passed INTEGER NOT NULL DEFAULT 0,
        elapsed_ms INTEGER,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_screening_sessions_created_at
        ON screening_sessions(created_at DESC)`
    ]);
    await ensureScreeningSessionColumns(client);
    await ensureCommitteeSessionColumns(client);
    migrated = true;
  }
  return client;
}
async function ensureScreeningSessionColumns(db) {
  const alters = [
    `ALTER TABLE screening_sessions ADD COLUMN hot_news TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE screening_sessions ADD COLUMN hot_themes TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE screening_sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'auto'`
  ];
  for (const sql of alters) {
    try {
      await db.execute(sql);
    } catch {
    }
  }
}
async function ensureCommitteeSessionColumns(db) {
  const alters = [
    `ALTER TABLE committee_sessions ADD COLUMN trade_plans TEXT NOT NULL DEFAULT '[]'`
  ];
  for (const sql of alters) {
    try {
      await db.execute(sql);
    } catch {
    }
  }
}
function mapScreeningRow(row) {
  return {
    id: String(row.id),
    query: String(row.query),
    sectors: JSON.parse(String(row.sectors)),
    candidates: JSON.parse(
      String(row.candidates)
    ),
    rotationSummary: String(row.rotation_summary),
    hotNews: JSON.parse(String(row.hot_news ?? "[]")),
    hotThemes: JSON.parse(String(row.hot_themes ?? "[]")),
    mode: row.mode === "manual" ? "manual" : "auto",
    passed: Boolean(row.passed),
    elapsedMs: row.elapsed_ms == null ? null : Number(row.elapsed_ms),
    createdAt: String(row.created_at)
  };
}
function mapScreeningSummary(row) {
  const sectors = JSON.parse(String(row.sectors));
  const candidates = JSON.parse(
    String(row.candidates)
  );
  return {
    id: String(row.id),
    query: String(row.query),
    hotThemes: JSON.parse(String(row.hot_themes ?? "[]")),
    mode: row.mode === "manual" ? "manual" : "auto",
    passed: Boolean(row.passed),
    elapsedMs: row.elapsed_ms == null ? null : Number(row.elapsed_ms),
    createdAt: String(row.created_at),
    sectorCount: sectors.length,
    candidateCount: candidates.length
  };
}
async function getScreeningSession(id) {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM screening_sessions WHERE id = ?`,
    args: [id]
  });
  if (result.rows.length === 0) return null;
  return mapScreeningRow(result.rows[0]);
}
async function listScreeningSessions(options = {}) {
  const db = await getDb();
  const limit = options.limit ?? 50;
  const result = await db.execute({
    sql: `SELECT id, query, sectors, candidates, hot_themes, mode, passed, elapsed_ms, created_at
          FROM screening_sessions
          ORDER BY created_at DESC
          LIMIT ?`,
    args: [limit]
  });
  return result.rows.map(
    (row) => mapScreeningSummary(row)
  );
}
async function getCommitteeSessionByScreeningId(screeningSessionId) {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM committee_sessions
          WHERE screening_session_id = ?
          ORDER BY created_at DESC
          LIMIT 1`,
    args: [screeningSessionId]
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: String(row.id),
    screeningSessionId: row.screening_session_id == null ? null : String(row.screening_session_id),
    candidates: JSON.parse(String(row.candidates)),
    memo: String(row.memo),
    tradePlans: JSON.parse(
      String(row.trade_plans ?? "[]")
    ),
    passed: Boolean(row.passed),
    elapsedMs: row.elapsed_ms == null ? null : Number(row.elapsed_ms),
    createdAt: String(row.created_at)
  };
}

// ../../packages/agent-core/src/data/feedback/store.ts
import { createClient as createClient2 } from "@libsql/client";
var client2 = null;
var migrated2 = false;
async function getDb2() {
  if (!client2) {
    client2 = createClient2(getPrimaryLibsqlOptions());
  }
  if (!migrated2) {
    await client2.execute(`
      CREATE TABLE IF NOT EXISTS user_feedback (
        id TEXT PRIMARY KEY,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        rating INTEGER NOT NULL,
        comment TEXT,
        created_at TEXT NOT NULL
      )
    `);
    await client2.execute(`
      CREATE INDEX IF NOT EXISTS idx_user_feedback_target
        ON user_feedback(target_type, target_id)
    `);
    migrated2 = true;
  }
  return client2;
}
async function getFeedbackSummary(targetType, targetId) {
  const db = await getDb2();
  const result = await db.execute({
    sql: `SELECT * FROM user_feedback
          WHERE target_type = ? AND target_id = ?
          ORDER BY created_at DESC`,
    args: [targetType, targetId]
  });
  const rows = result.rows;
  let up = 0;
  let down = 0;
  let latest = null;
  for (const row of rows) {
    const rating = Number(row.rating);
    if (rating > 0) up += 1;
    else down += 1;
    if (!latest) {
      latest = {
        id: String(row.id),
        targetType: row.target_type,
        targetId: String(row.target_id),
        rating: rating > 0 ? 1 : -1,
        comment: row.comment == null ? null : String(row.comment),
        createdAt: String(row.created_at)
      };
    }
  }
  return { up, down, latest };
}

// ../../packages/agent-core/src/eval/report-store.ts
import path3 from "node:path";
var REPORT_PATH = path3.join(DATA_DIR, "eval-latest.json");
function getEvalReportPath() {
  return REPORT_PATH;
}

// ../../packages/agent-core/src/cli/screenings-json.ts
async function main() {
  const command = process.argv[2];
  const arg1 = process.argv[3];
  const arg2 = process.argv[4];
  if (command === "list") {
    const sessions = await listScreeningSessions({ limit: 100 });
    process.stdout.write(JSON.stringify(sessions));
    return;
  }
  if (command === "get" && arg1) {
    const session = await getScreeningSession(arg1);
    if (!session) {
      process.stderr.write(`Screening session not found: ${arg1}`);
      process.exit(1);
    }
    const [committee, feedback] = await Promise.all([
      getCommitteeSessionByScreeningId(arg1),
      getFeedbackSummary("screening", arg1)
    ]);
    process.stdout.write(JSON.stringify({ ...session, committee, feedback }));
    return;
  }
  if (command === "compare" && arg1 && arg2) {
    const [base, target] = await Promise.all([
      getScreeningSession(arg1),
      getScreeningSession(arg2)
    ]);
    if (!base || !target) {
      process.stderr.write("Screening session not found");
      process.exit(1);
    }
    process.stdout.write(
      JSON.stringify(compareScreeningSessions(base, target))
    );
    return;
  }
  if (command === "backtest" && arg1) {
    const session = await getScreeningSession(arg1);
    if (!session) {
      process.stderr.write(`Screening session not found: ${arg1}`);
      process.exit(1);
    }
    const holdArg = process.argv[4];
    const holdDays = !holdArg || holdArg === "auto" || holdArg === "0" ? 0 : Number(holdArg);
    const result = await computeScreeningBacktest({
      screeningId: session.id,
      screenedAt: session.createdAt,
      candidates: session.candidates,
      holdDays: Number.isFinite(holdDays) && holdDays >= 0 ? holdDays : 0
    });
    process.stdout.write(JSON.stringify(result));
    return;
  }
  if (command === "eval-report") {
    try {
      const raw = readFileSync2(getEvalReportPath(), "utf-8");
      process.stdout.write(raw);
    } catch {
      process.stdout.write("null");
    }
    return;
  }
  process.stderr.write(
    "Usage: screenings-json.ts list | get <id> | compare <a> <b> | backtest <id> [days] | eval-report"
  );
  process.exit(1);
}
main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(message);
  process.exit(1);
});
